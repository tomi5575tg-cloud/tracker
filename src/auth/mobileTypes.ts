import type { UserSession } from '../types.js';

export interface MobileTokenValidationResult {
  readonly isValid: boolean;
  readonly session?: UserSession | undefined;
  readonly errorCode?: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'NETWORK_ERROR' | 'DEVICE_UNAUTHORIZED' | string | undefined;
  readonly errorMessage?: string | undefined;
}

export interface MobileTokenValidator {
  validateToken(token: string, deviceId?: string): Promise<MobileTokenValidationResult>;
}

export interface MobileDeviceContext {
  readonly deviceId: string;
  readonly platform: 'android' | 'ios' | 'web';
  readonly appVersion?: string | undefined;
}

export type MobileBootstrapOutcome =
  | { status: 'RESTORED'; session: UserSession }
  | { status: 'UNAUTHENTICATED'; reason: string }
  | { status: 'OFFLINE_RESTORED'; session: UserSession }
  | { status: 'EXPIRED_DRAINED'; reason: string };

export interface MobileBootstrapOptions {
  readonly deviceContext?: MobileDeviceContext | undefined;
  readonly remoteValidator?: MobileTokenValidator | undefined;
  readonly allowOfflineRestoration?: boolean | undefined;
}
