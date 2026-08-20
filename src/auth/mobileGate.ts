import type { UserSession, AuthBoothState } from '../types.js';
import type { AuthLockBooth } from './authBooth.js';
import type {
  MobileBootstrapOptions,
  MobileBootstrapOutcome,
  MobileDeviceContext,
  MobileTokenValidator,
} from './mobileTypes.js';

export interface MobileAuthGateConfig {
  readonly booth: AuthLockBooth;
  readonly deviceContext?: MobileDeviceContext | undefined;
  readonly tokenValidator?: MobileTokenValidator | undefined;
  readonly onAuthStatusChanged?: ((status: MobileBootstrapOutcome) => void) | undefined;
}

export class MobileAuthGate {
  private readonly booth: AuthLockBooth;
  private readonly deviceContext?: MobileDeviceContext | undefined;
  private readonly tokenValidator?: MobileTokenValidator | undefined;
  private readonly onAuthStatusChanged?: ((status: MobileBootstrapOutcome) => void) | undefined;
  private initialized = false;

  constructor(config: MobileAuthGateConfig) {
    this.booth = config.booth;
    this.deviceContext = config.deviceContext;
    this.tokenValidator = config.tokenValidator;
    this.onAuthStatusChanged = config.onAuthStatusChanged;
  }

  /**
   * PANCERNA AUTORYZACJA STARTOWA MOBILKA (Mobile App Startup Bootstrap):
   * 
   * Krok 1: Wymuszenie inicjalizacji Śluzy (odczyt sesji z SecureStorage/LocalStorage).
   * Krok 2: Jeżeli w kabinie brak zapisanej sesji -> wynik UNAUTHENTICATED.
   * Krok 3: Jeżeli sesja istnieje lokalnie:
   *   - Opcja A (dostępny zdalny walidator / sieć):
   *       Weryfikacja tokena i urządzenia (Remote Token Validation).
   *       - Jeśli token ważny: aktualizacja / potwierdzenie sesji w kabinie -> RESTORED.
   *       - Jeśli token nieważny/wygasły: natychmiastowe opróżnienie kabiny i drenaż -> EXPIRED_DRAINED.
   *       - Jeśli błąd sieciowy i włączony tryb offline -> OFFLINE_RESTORED.
   *   - Opcja B (brak zdalnego walidatora):
   *       Przywrócenie lokalnej sesji -> RESTORED.
   */
  public async bootstrap(options: MobileBootstrapOptions = {}): Promise<MobileBootstrapOutcome> {
    const remoteValidator = options.remoteValidator ?? this.tokenValidator;
    const deviceContext = options.deviceContext ?? this.deviceContext;
    const allowOffline = options.allowOfflineRestoration ?? true;

    // Krok 1: Inicjalizacja kabiny
    const existingSession = await this.booth.initialize();

    if (!existingSession) {
      const outcome: MobileBootstrapOutcome = {
        status: 'UNAUTHENTICATED',
        reason: 'NO_STORED_SESSION',
      };
      this.initialized = true;
      this.onAuthStatusChanged?.(outcome);
      return outcome;
    }

    // Krok 2: Jeśli nie ma walidatora zdalnego, przyjmujemy ważną sesję lokalną
    if (!remoteValidator) {
      const outcome: MobileBootstrapOutcome = {
        status: 'RESTORED',
        session: existingSession,
      };
      this.initialized = true;
      this.onAuthStatusChanged?.(outcome);
      return outcome;
    }

    // Krok 3: Walidacja tokena u dostawcy tożsamości / backendu
    try {
      const validation = await remoteValidator.validateToken(
        existingSession.token,
        deviceContext?.deviceId
      );

      if (validation.isValid) {
        // Zaktualizuj sesję jeśli backend zwrócił świeższe dane
        const sessionToKeep = validation.session ?? existingSession;
        if (validation.session) {
          await this.booth.enterBooth(validation.session);
        } else {
          await this.booth.touch();
        }

        const outcome: MobileBootstrapOutcome = {
          status: 'RESTORED',
          session: sessionToKeep,
        };
        this.initialized = true;
        this.onAuthStatusChanged?.(outcome);
        return outcome;
      } else {
        // Token odrzucony (np. wygasł, revoked, inne urządzenie)
        // PANCERNY DRENAŻ - Natychmiastowe wyczyszczenie kabiny
        await this.booth.exitBooth(`REMOTE_VALIDATION_FAILED_${validation.errorCode ?? 'UNKNOWN'}`);

        const outcome: MobileBootstrapOutcome = {
          status: 'EXPIRED_DRAINED',
          reason: validation.errorMessage ?? validation.errorCode ?? 'TOKEN_REJECTED',
        };
        this.initialized = true;
        this.onAuthStatusChanged?.(outcome);
        return outcome;
      }
    } catch (networkError) {
      // W przypadku problemu sieciowego
      if (allowOffline) {
        const outcome: MobileBootstrapOutcome = {
          status: 'OFFLINE_RESTORED',
          session: existingSession,
        };
        this.initialized = true;
        this.onAuthStatusChanged?.(outcome);
        return outcome;
      } else {
        await this.booth.exitBooth('OFFLINE_NOT_PERMITTED');
        const outcome: MobileBootstrapOutcome = {
          status: 'EXPIRED_DRAINED',
          reason: 'NETWORK_ERROR_OFFLINE_DISABLED',
        };
        this.initialized = true;
        this.onAuthStatusChanged?.(outcome);
        return outcome;
      }
    }
  }

  /**
   * Logowanie z poziomu aplikacji mobilnej z zabezpieczeniem metadanymi urządzenia
   */
  public async login(
    credentials: {
      sessionId: string;
      userId: string;
      username: string;
      token: string;
      metadata?: Record<string, unknown> | undefined;
    }
  ): Promise<UserSession> {
    const combinedMetadata = {
      ...(credentials.metadata ?? {}),
      ...(this.deviceContext
        ? {
            deviceId: this.deviceContext.deviceId,
            platform: this.deviceContext.platform,
            appVersion: this.deviceContext.appVersion,
          }
        : {}),
    };

    return this.booth.enterBooth({
      ...credentials,
      metadata: combinedMetadata,
    });
  }

  /**
   * Wylogowanie z aplikacji mobilnej
   */
  public async logout(reason = 'MOBILE_USER_LOGOUT'): Promise<void> {
    await this.booth.exitBooth(reason);
  }

  /**
   * Sprawdza czy autoryzacja mobilna została zainicjalizowana
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Zwraca aktualną sesję
   */
  public getCurrentSession(): UserSession | null {
    return this.booth.getSession();
  }

  /**
   * Zwraca stan kabiny
   */
  public getState(): AuthBoothState {
    return this.booth.getStatus().state;
  }
}
