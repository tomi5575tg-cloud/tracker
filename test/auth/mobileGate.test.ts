import { describe, it, expect, vi } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import { MobileAuthGate } from '../../src/auth/mobileGate.js';
import type { MobileTokenValidator, MobileTokenValidationResult } from '../../src/auth/mobileTypes.js';

describe('MobileAuthGate (Sluza Logowania i Autoryzacja Startowa Mobilka)', () => {
  it('should return UNAUTHENTICATED when starting app with empty storage', async () => {
    const storage = new InMemoryStorageProvider();
    const booth = new AuthLockBooth({ storage });
    const gate = new MobileAuthGate({
      booth,
      deviceContext: { deviceId: 'iphone-15-pro', platform: 'ios', appVersion: '2.4.0' },
    });

    const result = await gate.bootstrap();

    expect(result.status).toBe('UNAUTHENTICATED');
    expect(gate.getCurrentSession()).toBeNull();
    expect(gate.getState()).toBe('EMPTY');
  });

  it('should restore session locally when no remote validator is provided', async () => {
    const storage = new InMemoryStorageProvider();
    storage.setItem(
      '__tracker_auth_session__',
      JSON.stringify({
        sessionId: 'sess-mobile-1',
        userId: 'user-mobile',
        username: 'tomi_mobile',
        token: 'valid-jwt-token',
        loginTimestamp: Date.now(),
        lastActiveTimestamp: Date.now(),
      })
    );

    const booth = new AuthLockBooth({ storage });
    const gate = new MobileAuthGate({ booth });

    const result = await gate.bootstrap();

    expect(result.status).toBe('RESTORED');
    if (result.status === 'RESTORED') {
      expect(result.session.userId).toBe('user-mobile');
    }
    expect(gate.getCurrentSession()?.username).toBe('tomi_mobile');
    expect(gate.getState()).toBe('OCCUPIED');
  });

  it('should validate token with remote backend and restore session upon success', async () => {
    const storage = new InMemoryStorageProvider();
    storage.setItem(
      '__tracker_auth_session__',
      JSON.stringify({
        sessionId: 'sess-mobile-2',
        userId: 'user-remote',
        username: 'remote_user',
        token: 'fresh-token',
        loginTimestamp: Date.now(),
        lastActiveTimestamp: Date.now(),
      })
    );

    const validator: MobileTokenValidator = {
      validateToken: vi.fn().mockResolvedValue({
        isValid: true,
      } as MobileTokenValidationResult),
    };

    const booth = new AuthLockBooth({ storage });
    const gate = new MobileAuthGate({
      booth,
      tokenValidator: validator,
      deviceContext: { deviceId: 'pixel-8', platform: 'android' },
    });

    const result = await gate.bootstrap();

    expect(result.status).toBe('RESTORED');
    expect(validator.validateToken).toHaveBeenCalledWith('fresh-token', 'pixel-8');
    expect(gate.getCurrentSession()?.userId).toBe('user-remote');
  });

  it('should trigger session drain and purge storage if remote validator rejects token (EXPIRED_DRAINED)', async () => {
    const storage = new InMemoryStorageProvider();
    storage.setItem(
      '__tracker_auth_session__',
      JSON.stringify({
        sessionId: 'sess-mobile-expired',
        userId: 'user-expired',
        username: 'expired_user',
        token: 'expired-token',
        loginTimestamp: Date.now(),
        lastActiveTimestamp: Date.now(),
      })
    );

    const drainHook = vi.fn();
    const validator: MobileTokenValidator = {
      validateToken: vi.fn().mockResolvedValue({
        isValid: false,
        errorCode: 'TOKEN_EXPIRED',
        errorMessage: 'The session has expired on server',
      } as MobileTokenValidationResult),
    };

    const booth = new AuthLockBooth({ storage });
    booth.registerDrainHook({ drain: drainHook });

    const gate = new MobileAuthGate({
      booth,
      tokenValidator: validator,
    });

    const result = await gate.bootstrap();

    expect(result.status).toBe('EXPIRED_DRAINED');
    expect(gate.getCurrentSession()).toBeNull();
    expect(gate.getState()).toBe('EMPTY');
    expect(drainHook).toHaveBeenCalledWith(
      'REMOTE_VALIDATION_FAILED_TOKEN_EXPIRED',
      expect.objectContaining({ userId: 'user-expired' })
    );
    expect(storage.getItem('__tracker_auth_session__')).toBeNull();
  });

  it('should fall back to OFFLINE_RESTORED when network fails during startup if offline allowed', async () => {
    const storage = new InMemoryStorageProvider();
    storage.setItem(
      '__tracker_auth_session__',
      JSON.stringify({
        sessionId: 'sess-offline',
        userId: 'user-offline',
        username: 'offline_user',
        token: 'valid-token',
        loginTimestamp: Date.now(),
        lastActiveTimestamp: Date.now(),
      })
    );

    const validator: MobileTokenValidator = {
      validateToken: vi.fn().mockRejectedValue(new Error('Network request failed: unreachable host')),
    };

    const booth = new AuthLockBooth({ storage });
    const gate = new MobileAuthGate({
      booth,
      tokenValidator: validator,
    });

    const result = await gate.bootstrap({ allowOfflineRestoration: true });

    expect(result.status).toBe('OFFLINE_RESTORED');
    expect(gate.getCurrentSession()?.userId).toBe('user-offline');
  });

  it('should inject mobile device context metadata upon login', async () => {
    const storage = new InMemoryStorageProvider();
    const booth = new AuthLockBooth({ storage });
    const gate = new MobileAuthGate({
      booth,
      deviceContext: { deviceId: 'samsung-s24', platform: 'android', appVersion: '3.1.0' },
    });

    const session = await gate.login({
      sessionId: 'sess-s24',
      userId: 'usr-s24',
      username: 'andrzej',
      token: 'jwt-s24',
    });

    expect(session.userId).toBe('usr-s24');
    expect(session.metadata).toEqual({
      deviceId: 'samsung-s24',
      platform: 'android',
      appVersion: '3.1.0',
    });
  });
});
