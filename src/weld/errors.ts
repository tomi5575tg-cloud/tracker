/**
 * Explicit failure types for the hardware → cabin pixel weld.
 * Nothing in this layer is allowed to fail silently.
 */

export class CabinEmptyError extends Error {
  override readonly name = 'CabinEmptyError';

  constructor(operation: string) {
    super(`Zasada Jednej Kabiny: cannot ${operation} while AuthLockBooth is empty`);
  }
}

export class OccupantMismatchError extends Error {
  override readonly name = 'OccupantMismatchError';

  constructor(sessionUserId: string, payloadUserId: string) {
    super(
      `Security violation: booth occupant (${sessionUserId}) does not match payload user (${payloadUserId})`
    );
  }
}

export class BlankScreenError extends Error {
  override readonly name = 'BlankScreenError';

  constructor(detail: string) {
    super(`Screen weld failed: emergency surface produced a blank frame (${detail})`);
  }
}

export class CircuitOpenError extends Error {
  override readonly name = 'CircuitOpenError';

  constructor(subsystem: string, failureCount: number) {
    super(`Circuit breaker OPEN for ${subsystem} after ${failureCount} consecutive failures`);
  }
}

export class HardwarePortError extends Error {
  override readonly name = 'HardwarePortError';

  constructor(port: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`${port} port failed: ${message}`);
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}
