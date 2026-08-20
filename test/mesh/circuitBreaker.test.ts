import { describe, it, expect, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
} from '../../src/mesh/circuitBreaker.js';
import { CircuitState } from '../../src/mesh/types.js';

describe('CircuitBreaker (Fault-Tolerant Mesh)', () => {
  it('should execute successful actions in CLOSED state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    const result = await breaker.execute(() => 42);

    expect(result).toBe(42);
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.isAvailable()).toBe(true);

    const metrics = breaker.getMetrics();
    expect(metrics.totalCalls).toBe(1);
    expect(metrics.totalSuccesses).toBe(1);
    expect(metrics.totalFailures).toBe(0);
  });

  it('should transition from CLOSED to OPEN after consecutive failures threshold', async () => {
    const stateChanges: Array<{ state: CircuitState; prev: CircuitState }> = [];
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 500 });
    breaker.onStateChange((state, prev) => stateChanges.push({ state, prev }));

    const failingAction = () => {
      throw new Error('Upstream timeout');
    };

    // 1st failure
    await expect(breaker.execute(failingAction)).rejects.toThrow('Upstream timeout');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    // 2nd failure
    await expect(breaker.execute(failingAction)).rejects.toThrow('Upstream timeout');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    // 3rd failure -> trips circuit to OPEN
    await expect(breaker.execute(failingAction)).rejects.toThrow('Upstream timeout');
    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.isAvailable()).toBe(false);

    expect(stateChanges).toEqual([{ state: CircuitState.OPEN, prev: CircuitState.CLOSED }]);

    // Subsequent call should be immediately blocked by CircuitBreakerOpenError
    await expect(breaker.execute(() => 'should not run')).rejects.toThrow(CircuitBreakerOpenError);
  });

  it('should transition to HALF_OPEN after resetTimeout and recover to CLOSED on consecutive successes', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      halfOpenSuccessThreshold: 2,
    });

    // Trip circuit to OPEN
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => {
          throw new Error('Fail');
        });
      } catch {
        // expected
      }
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Advance time past resetTimeoutMs
    vi.advanceTimersByTime(1100);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    expect(breaker.isAvailable()).toBe(true);

    // First success in HALF_OPEN (need 2)
    const res1 = await breaker.execute(() => 'Trial 1');
    expect(res1).toBe('Trial 1');
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Second success in HALF_OPEN -> transitions back to CLOSED
    const res2 = await breaker.execute(() => 'Trial 2');
    expect(res2).toBe('Trial 2');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    vi.useRealTimers();
  });

  it('should immediately snap back to OPEN if a trial call in HALF_OPEN fails', async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      halfOpenSuccessThreshold: 2,
    });

    // Trip circuit to OPEN
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => {
          throw new Error('Fail');
        });
      } catch {
        // expected
      }
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Advance to HALF_OPEN
    vi.advanceTimersByTime(1100);
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    // Trial call fails -> snaps back to OPEN
    await expect(
      breaker.execute(() => {
        throw new Error('Trial failed');
      })
    ).rejects.toThrow('Trial failed');

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    vi.useRealTimers();
  });

  it('should reject with CircuitBreakerTimeoutError when action exceeds callTimeoutMs', async () => {
    const breaker = new CircuitBreaker({ callTimeoutMs: 50 });

    const slowAction = () => new Promise((resolve) => setTimeout(resolve, 200));

    await expect(breaker.execute(slowAction)).rejects.toThrow(CircuitBreakerTimeoutError);
    expect(breaker.getMetrics().totalTimeouts).toBe(1);
    expect(breaker.getMetrics().totalFailures).toBe(1);
  });

  it('should support manual control: forceOpen, forceClosed, reset', () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    breaker.forceOpen();
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.forceClosed();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    breaker.recordFailure();
    expect(breaker.getMetrics().consecutiveFailures).toBe(1);

    breaker.reset();
    expect(breaker.getMetrics().consecutiveFailures).toBe(0);
    expect(breaker.getMetrics().totalCalls).toBe(0);
  });
});
