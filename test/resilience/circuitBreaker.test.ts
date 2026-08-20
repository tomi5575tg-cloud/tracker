import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../src/resilience/circuitBreaker.js';
import { CircuitOpenError } from '../../src/weld/errors.js';

describe('CircuitBreaker', () => {
  it('stays CLOSED and returns the real result on success', () => {
    const breaker = new CircuitBreaker({ name: 'GNSS', failureThreshold: 2 });
    expect(breaker.execute(() => 42)).toBe(42);
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('re-throws the original error and opens after the failure threshold', () => {
    const breaker = new CircuitBreaker({ name: 'GNSS', failureThreshold: 2, resetTimeoutMs: 60_000 });

    expect(() =>
      breaker.execute(() => {
        throw new Error('no fix');
      })
    ).toThrow('no fix');
    expect(breaker.getState()).toBe('CLOSED');

    expect(() =>
      breaker.execute(() => {
        throw new Error('no fix');
      })
    ).toThrow('no fix');
    expect(breaker.getState()).toBe('OPEN');

    expect(() => breaker.execute(() => 1)).toThrow(CircuitOpenError);
  });

  it('never returns a synthetic success while OPEN', () => {
    const breaker = new CircuitBreaker({ name: 'MAP', failureThreshold: 1, resetTimeoutMs: 60_000 });
    try {
      breaker.execute(() => {
        throw new Error('gpu');
      });
    } catch {
      // original failure recorded
    }
    expect(() => breaker.execute(() => 'ok')).toThrow(CircuitOpenError);
  });
});
