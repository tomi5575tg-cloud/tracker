import { describe, it, expect, vi } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import type { AuthBoothState, UserSession } from '../../src/types.js';

describe('AuthLockBooth (Sluza Logowania - Zasada Jednej Kabiny)', () => {
  it('should initialize in EMPTY state', async () => {
    const storage = new InMemoryStorageProvider();
    const booth = new AuthLockBooth({ storage });

    await booth.initialize();

    const status = booth.getStatus();
    expect(status.state).toBe('EMPTY');
    expect(status.currentSession).toBeNull();
    expect(booth.getSession()).toBeNull();
  });

  it('should transition through states when entering booth', async () => {
    const storage = new InMemoryStorageProvider();
    const stateHistory: Array<{ state: AuthBoothState; session: UserSession | null }> = [];

    const booth = new AuthLockBooth({
      storage,
      onStateChange: (state, session) => {
        stateHistory.push({ state, session });
      },
    });

    const session = await booth.enterBooth({
      sessionId: 'sess-1',
      userId: 'user-1',
      username: 'tomi',
      token: 'jwt-token-1',
    });

    expect(session.userId).toBe('user-1');
    expect(booth.getSession()?.userId).toBe('user-1');
    expect(booth.getStatus().state).toBe('OCCUPIED');

    // Expected transition: OCCUPYING -> OCCUPIED
    expect(stateHistory.map((h) => h.state)).toEqual(['OCCUPYING', 'OCCUPIED']);
  });

  it('should trigger session drain when a new user enters while booth is occupied (Zasada Jednej Kabiny)', async () => {
    const storage = new InMemoryStorageProvider();
    const drainHook = vi.fn();

    const booth = new AuthLockBooth({ storage });
    booth.registerDrainHook({ drain: drainHook });

    // User 1 enters
    await booth.enterBooth({
      sessionId: 'sess-1',
      userId: 'user-1',
      username: 'user_one',
      token: 'jwt-token-1',
    });

    expect(booth.getSession()?.userId).toBe('user-1');
    expect(drainHook).not.toHaveBeenCalled();

    // User 2 enters -> Must trigger drain of User 1 before User 2 is seated
    const user2Session = await booth.enterBooth({
      sessionId: 'sess-2',
      userId: 'user-2',
      username: 'user_two',
      token: 'jwt-token-2',
    });

    expect(drainHook).toHaveBeenCalledTimes(1);
    expect(drainHook).toHaveBeenCalledWith('SWITCH_USER_OR_RELOGIN', expect.objectContaining({ userId: 'user-1' }));
    expect(user2Session.userId).toBe('user-2');
    expect(booth.getSession()?.userId).toBe('user-2');
  });

  it('should drain and empty booth upon exitBooth', async () => {
    const storage = new InMemoryStorageProvider();
    const drainHook = vi.fn();

    const booth = new AuthLockBooth({ storage });
    booth.registerDrainHook({ drain: drainHook });

    await booth.enterBooth({
      sessionId: 'sess-1',
      userId: 'user-1',
      username: 'tomi',
      token: 'jwt-token-1',
    });

    expect(booth.getStatus().state).toBe('OCCUPIED');

    await booth.exitBooth('USER_CLICKED_LOGOUT');

    expect(drainHook).toHaveBeenCalledWith('USER_CLICKED_LOGOUT', expect.objectContaining({ userId: 'user-1' }));
    expect(booth.getStatus().state).toBe('EMPTY');
    expect(booth.getSession()).toBeNull();
    expect(storage.getItem('__tracker_auth_session__')).toBeNull();
  });

  it('should cancel active session signal when session is drained', async () => {
    const storage = new InMemoryStorageProvider();
    const booth = new AuthLockBooth({ storage });

    await booth.enterBooth({
      sessionId: 'sess-1',
      userId: 'user-1',
      username: 'tomi',
      token: 'jwt-token-1',
    });

    const signal1 = booth.getSessionAbortSignal();
    expect(signal1.aborted).toBe(false);

    await booth.exitBooth('LOGOUT');

    expect(signal1.aborted).toBe(true);

    // New signal for next session is active
    const signal2 = booth.getSessionAbortSignal();
    expect(signal2.aborted).toBe(false);
  });

  it('should maintain booth isolation under high concurrent login race conditions', async () => {
    const storage = new InMemoryStorageProvider();
    const drainHook = vi.fn();
    const booth = new AuthLockBooth({ storage });
    booth.registerDrainHook({ drain: drainHook });

    // Simulate 5 simultaneous login attempts
    const loginPromises = Array.from({ length: 5 }, (_, i) =>
      booth.enterBooth({
        sessionId: `sess-${i}`,
        userId: `user-${i}`,
        username: `user_${i}`,
        token: `token-${i}`,
      })
    );

    await Promise.all(loginPromises);

    // Exactly 1 user remains in the booth
    const finalSession = booth.getSession();
    expect(finalSession).not.toBeNull();
    expect(booth.getStatus().state).toBe('OCCUPIED');
    // All preceding 4 sessions were drained safely
    expect(drainHook).toHaveBeenCalledTimes(4);
  });
});
