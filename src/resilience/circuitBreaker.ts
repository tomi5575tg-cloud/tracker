import { CircuitOpenError } from '../weld/errors.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  readonly name: string;
  readonly failureThreshold?: number | undefined;
  readonly resetTimeoutMs?: number | undefined;
  readonly halfOpenMaxCalls?: number | undefined;
}

/**
 * Fail-loud circuit breaker. An OPEN circuit throws CircuitOpenError —
 * it never returns a synthetic success or swallows the original cause.
 */
export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxCalls: number;

  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenCalls = 0;
  private lastError: Error | null = null;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 5000;
    this.halfOpenMaxCalls = config.halfOpenMaxCalls ?? 1;
  }

  public getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  public getFailureCount(): number {
    return this.consecutiveFailures;
  }

  public getLastError(): Error | null {
    return this.lastError;
  }

  public execute<T>(fn: () => T): T {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name, this.consecutiveFailures);
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new CircuitOpenError(this.name, this.consecutiveFailures);
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCalls += 1;
    }

    try {
      const result = fn();
      this.recordSuccess();
      return result;
    } catch (cause) {
      this.recordFailure(cause);
      throw cause;
    }
  }

  public async executeAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name, this.consecutiveFailures);
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new CircuitOpenError(this.name, this.consecutiveFailures);
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCalls += 1;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (cause) {
      this.recordFailure(cause);
      throw cause;
    }
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenCalls = 0;
    this.lastError = null;
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== 'OPEN') {
      return;
    }
    if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.halfOpenCalls = 0;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.halfOpenCalls = 0;
    this.lastError = null;
  }

  private recordFailure(cause: unknown): void {
    this.consecutiveFailures += 1;
    this.lastError = cause instanceof Error ? cause : new Error(String(cause));
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }
}
