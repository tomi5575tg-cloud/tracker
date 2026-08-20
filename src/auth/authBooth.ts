import type { UserSession, AuthBoothState, AuthLockBoothStatus } from '../types.js';
import { AsyncMutex } from './mutex.js';
import { SessionDrainManager, type SessionDrainHook } from './drainManager.js';
import type { StorageProvider } from './storage.js';
import { InMemoryStorageProvider, SafeBrowserStorageProvider } from './storage.js';

export interface AuthLockBoothConfig {
  readonly storage?: StorageProvider | undefined;
  readonly storageKey?: string | undefined;
  readonly mutexTimeoutMs?: number | undefined;
  readonly onStateChange?: ((state: AuthBoothState, session: UserSession | null) => void) | undefined;
  readonly onSessionExpired?: ((session: UserSession) => void) | undefined;
  readonly sessionTtlMs?: number | undefined;
}

export const DEFAULT_AUTH_BOOTH_CONFIG = {
  storageKey: '__tracker_auth_session__',
  mutexTimeoutMs: 10000,
  sessionTtlMs: 0, // 0 means no auto-expiration based on TTL
};

export class AuthLockBooth {
  private readonly mutex = new AsyncMutex();
  private readonly drainManager = new SessionDrainManager();
  private readonly storage: StorageProvider;
  private readonly storageKey: string;
  private readonly mutexTimeoutMs: number;
  private readonly sessionTtlMs: number;
  private readonly onStateChange: ((state: AuthBoothState, session: UserSession | null) => void) | undefined;
  private readonly onSessionExpired: ((session: UserSession) => void) | undefined;

  private state: AuthBoothState = 'EMPTY';
  private currentSession: UserSession | null = null;
  private initialized = false;

  constructor(config: AuthLockBoothConfig = {}) {
    this.storage = config.storage ?? (typeof window !== 'undefined' ? new SafeBrowserStorageProvider() : new InMemoryStorageProvider());
    this.storageKey = config.storageKey ?? DEFAULT_AUTH_BOOTH_CONFIG.storageKey;
    this.mutexTimeoutMs = config.mutexTimeoutMs ?? DEFAULT_AUTH_BOOTH_CONFIG.mutexTimeoutMs;
    this.sessionTtlMs = config.sessionTtlMs ?? DEFAULT_AUTH_BOOTH_CONFIG.sessionTtlMs;
    this.onStateChange = config.onStateChange;
    this.onSessionExpired = config.onSessionExpired;
  }

  /**
   * Returns session drain manager for registering cleanup hooks (e.g. Map route drainage)
   */
  public getDrainManager(): SessionDrainManager {
    return this.drainManager;
  }

  /**
   * Registers a drain hook directly
   */
  public registerDrainHook(hook: SessionDrainHook): () => void {
    return this.drainManager.registerHook(hook);
  }

  /**
   * Gets an AbortSignal tied to current booth session
   */
  public getSessionAbortSignal(): AbortSignal {
    return this.drainManager.getSignal();
  }

  /**
   * Returns current booth status
   */
  public getStatus(): AuthLockBoothStatus {
    return {
      state: this.state,
      currentSession: this.currentSession,
      isLocked: this.mutex.isLocked(),
    };
  }

  /**
   * Initializes booth from persistent storage
   */
  public async initialize(): Promise<UserSession | null> {
    return this.mutex.runExclusive(async () => {
      if (this.initialized) {
        return this.currentSession;
      }

      const raw = await this.storage.getItem(this.storageKey);
      if (raw) {
        try {
          const session = JSON.parse(raw) as UserSession;
          if (this.isSessionValid(session)) {
            this.currentSession = session;
            this.transitionState('OCCUPIED');
          } else {
            await this.storage.removeItem(this.storageKey);
            this.currentSession = null;
            this.transitionState('EMPTY');
          }
        } catch {
          await this.storage.removeItem(this.storageKey);
          this.currentSession = null;
          this.transitionState('EMPTY');
        }
      } else {
        this.currentSession = null;
        this.transitionState('EMPTY');
      }

      this.initialized = true;
      return this.currentSession;
    }, this.mutexTimeoutMs);
  }

  /**
   * ZASADA JEDNEJ KABINY (Śluza Logowania):
   * 
   * Tylko jeden użytkownik/sesja może w danej chwili przejść przez śluzę i rezydować w kabinie.
   * Proces logowania nowego użytkownika:
   * 1. Blokada śluzy (Mutex acquisition) – nikt inny nie może wejść ani modyfikować stanu.
   * 2. Wykrycie istniejącej sesji w kabinie.
   * 3. Jeżeli w kabinie znajduje się sesja (poprzedni użytkownik lub re-login):
   *    - Stan przechodzi w DRAINING.
   *    - Uruchomienie pełnego drenażu sesji (Session Drain), m.in. czyszczenie tras MapLibre,
   *      anulowanie trwających żądań sieciowych, czyszczenie danych tymczasowych.
   *    - Usunięcie poprzedniej sesji z magazynu danych (Storage).
   * 4. Stan przechodzi w OCCUPYING.
   * 5. Ustanowienie nowej sesji, zapis do Storage, aktualizacja znaczników czasu.
   * 6. Stan przechodzi w OCCUPIED.
   * 7. Otwarcie śluzy (Mutex release).
   */
  public async enterBooth(sessionData: Omit<UserSession, 'loginTimestamp' | 'lastActiveTimestamp'> & {
    loginTimestamp?: number | undefined;
    lastActiveTimestamp?: number | undefined;
  }): Promise<UserSession> {
    return this.mutex.runExclusive(async () => {
      const now = Date.now();
      const previousSession = this.currentSession;

      // KROK 1 & 2: Sprawdzenie czy w kabinie jest obecna sesja do zdrenowania
      if (previousSession !== null) {
        this.transitionState('DRAINING');
        await this.drainManager.drain('SWITCH_USER_OR_RELOGIN', previousSession);
        await this.storage.removeItem(this.storageKey);
        this.currentSession = null;
      }

      // KROK 3: Zajmowanie kabiny nową sesją
      this.transitionState('OCCUPYING');

      const newSession: UserSession = {
        sessionId: sessionData.sessionId,
        userId: sessionData.userId,
        username: sessionData.username,
        token: sessionData.token,
        loginTimestamp: sessionData.loginTimestamp ?? now,
        lastActiveTimestamp: sessionData.lastActiveTimestamp ?? now,
        ...(sessionData.role !== undefined ? { role: sessionData.role } : {}),
        ...(sessionData.roles !== undefined ? { roles: sessionData.roles } : {}),
        ...(sessionData.permissions !== undefined ? { permissions: sessionData.permissions } : {}),
        ...(sessionData.tenantId !== undefined ? { tenantId: sessionData.tenantId } : {}),
        ...(sessionData.metadata !== undefined ? { metadata: sessionData.metadata } : {}),
      };

      // Zapis do bezpiecznego magazynu
      await this.storage.setItem(this.storageKey, JSON.stringify(newSession));
      this.currentSession = newSession;

      // KROK 4: Kabina zajęta i w pełni zaryglowana
      this.transitionState('OCCUPIED');

      return newSession;
    }, this.mutexTimeoutMs);
  }

  /**
   * OPUSTOSZENIE KABINY (Wylogowanie / Logout / Drain):
   * 
   * 1. Blokada śluzy (Mutex acquisition)
   * 2. Stan przechodzi w DRAINING
   * 3. Uruchomienie drenażu wszystkich zarejestrowanych zasobów (clearRoute na mapie, anulowanie zapytań)
   * 4. Wyczyszczenie magazynu pamięci
   * 5. Stan przechodzi w EMPTY
   * 6. Zwolnienie śluzy
   */
  public async exitBooth(reason = 'USER_LOGOUT'): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (this.currentSession === null && this.state === 'EMPTY') {
        return;
      }

      const prevSession = this.currentSession;
      this.transitionState('DRAINING');

      // Wywołanie pełnego drenażu
      await this.drainManager.drain(reason, prevSession);
      await this.storage.removeItem(this.storageKey);

      this.currentSession = null;
      this.transitionState('EMPTY');
    }, this.mutexTimeoutMs);
  }

  /**
   * Updates last active timestamp of current session
   */
  public async touch(): Promise<void> {
    await this.mutex.runExclusive(async () => {
      if (!this.currentSession || this.state !== 'OCCUPIED') {
        return;
      }

      const now = Date.now();
      const updated: UserSession = {
        ...this.currentSession,
        lastActiveTimestamp: now,
      };

      this.currentSession = updated;
      await this.storage.setItem(this.storageKey, JSON.stringify(updated));
    }, this.mutexTimeoutMs);
  }

  /**
   * Returns current session or null
   */
  public getSession(): UserSession | null {
    if (!this.currentSession) {
      return null;
    }
    if (!this.isSessionValid(this.currentSession)) {
      // Session has expired based on TTL
      const expired = this.currentSession;
      void this.exitBooth('SESSION_EXPIRED');
      this.onSessionExpired?.(expired);
      return null;
    }
    return this.currentSession;
  }

  /**
   * Checks whether the current user matches the given userId and booth is occupied
   */
  public isAuthorized(userId: string): boolean {
    const session = this.getSession();
    if (!session || this.state !== 'OCCUPIED') {
      return false;
    }
    return session.userId === userId;
  }

  private isSessionValid(session: UserSession): boolean {
    if (this.sessionTtlMs <= 0) {
      return true;
    }
    const age = Date.now() - session.lastActiveTimestamp;
    return age <= this.sessionTtlMs;
  }

  private transitionState(newState: AuthBoothState): void {
    this.state = newState;
    this.onStateChange?.(newState, this.currentSession);
  }
}
