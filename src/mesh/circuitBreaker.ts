import { CircuitState, type CircuitBreakerConfig } from './types.js';

export interface CircuitBreakerMetrics {
  readonly state: CircuitState;
  readonly totalCalls: number;
  readonly totalSuccesses: number;
  readonly totalFailures: number;
  readonly totalTimeouts: number;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly lastFailureTime?: number | undefined;
  readonly lastSuccessTime?: number | undefined;
  readonly lastStateChangeTime: number;
}

export class CircuitBreakerOpenError extends Error {
  public readonly resetTimeoutMs: number;
  public readonly remainingResetTimeMs: number;

  constructor(message: string, resetTimeoutMs: number, remainingResetTimeMs: number) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.resetTimeoutMs = resetTimeoutMs;
    this.remainingResetTimeMs = remainingResetTimeMs;
  }
}

export class CircuitBreakerTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'CircuitBreakerTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private readonly config: Required<CircuitBreakerConfig>;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private totalTimeouts = 0;
  private lastFailureTime?: number | undefined;
  private lastSuccessTime?: number | undefined;
  private lastStateChangeTime: number = Date.now();
  private stateChangeListeners: Array<(state: CircuitState, previousState: CircuitState) => void> = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      resetTimeoutMs: config.resetTimeoutMs ?? 5000,
      halfOpenSuccessThreshold: config.halfOpenSuccessThreshold ?? 2,
      callTimeoutMs: config.callTimeoutMs ?? 5000,
    };
  }

  public getState(): CircuitState {
    this.evaluateStateTransition();
    return this.state;
  }

  public isAvailable(): boolean {
    const currentState = this.getState();
    return currentState === CircuitState.CLOSED || currentState === CircuitState.HALF_OPEN;
  }

  public onStateChange(listener: (state: CircuitState, previousState: CircuitState) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== listener);
    };
  }

  public async execute<T>(action: () => Promise<T> | T, overrideTimeoutMs?: number): Promise<T> {
    this.totalCalls++;
    this.evaluateStateTransition();

    if (this.state === CircuitState.OPEN) {
      const remainingTime = Math.max(
        0,
        this.config.resetTimeoutMs - (Date.now() - this.lastStateChangeTime)
      );
      throw new CircuitBreakerOpenError(
        `Circuit breaker is OPEN. Calls blocked for ${remainingTime}ms`,
        this.config.resetTimeoutMs,
        remainingTime
      );
    }

    const effectiveTimeoutMs = overrideTimeoutMs ?? this.config.callTimeoutMs ?? 5000;

    try {
      const result = await this.executeWithTimeout(action, effectiveTimeoutMs);
      this.recordSuccess();
      return result;
    } catch (err: unknown) {
      this.recordFailure(err);
      throw err;
    }
  }

  private async executeWithTimeout<T>(action: () => Promise<T> | T, timeoutMs: number): Promise<T> {
    if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
      return await action();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.totalTimeouts++;
        reject(new CircuitBreakerTimeoutError(`Operation timed out after ${timeoutMs}ms`, timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve(action()), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public recordSuccess(): void {
    const now = Date.now();
    this.totalSuccesses++;
    this.lastSuccessTime = now;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  public recordFailure(_error?: unknown): void {
    const now = Date.now();
    this.totalFailures++;
    this.lastFailureTime = now;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;

    if (this.state === CircuitState.CLOSED) {
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      // In HALF_OPEN, any failure immediately snaps back to OPEN
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private evaluateStateTransition(): void {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastStateChangeTime;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
  }

  private transitionTo(nextState: CircuitState): void {
    if (this.state === nextState) return;

    const previousState = this.state;
    this.state = nextState;
    this.lastStateChangeTime = Date.now();

    if (nextState === CircuitState.CLOSED) {
      this.consecutiveFailures = 0;
    } else if (nextState === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses = 0;
    }

    for (const listener of this.stateChangeListeners) {
      try {
        listener(nextState, previousState);
      } catch {
        // Suppress listener errors to protect circuit breaker core
      }
    }
  }

  public forceOpen(): void {
    this.transitionTo(CircuitState.OPEN);
  }

  public forceClosed(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.transitionTo(CircuitState.CLOSED);
  }

  public reset(): void {
    this.forceClosed();
    this.totalCalls = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    this.totalTimeouts = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
  }

  public getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.getState(),
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      totalTimeouts: this.totalTimeouts,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastStateChangeTime: this.lastStateChangeTime,
    };
  }

  public getConfig(): Required<CircuitBreakerConfig> {
    return { ...this.config };
  }
}
