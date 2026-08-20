import { describe, it, expect, vi } from 'vitest';
import { TacticalQueryRaceGuard } from '../../src/auth/queryRaceGuard.js';

describe('TacticalQueryRaceGuard', () => {
  it('should monotonically increment sequence IDs and commit the latest query', async () => {
    const guard = new TacticalQueryRaceGuard();

    const h1 = guard.startQuery('test_key');
    expect(h1.queryId).toBe(1);
    expect(h1.isCurrent()).toBe(true);

    const h2 = guard.startQuery('test_key');
    expect(h2.queryId).toBe(2);
    expect(h2.isCurrent()).toBe(true);
    expect(h1.isCurrent()).toBe(false);
    expect(h1.isCancelled()).toBe(true);

    const commit1 = h1.commit({ value: 'old' });
    expect(commit1).toBe(false);

    const commit2 = h2.commit({ value: 'new' });
    expect(commit2).toBe(true);
  });

  it('should isolate concurrency across separate keys', async () => {
    const guard = new TacticalQueryRaceGuard();

    const hRadar = guard.startQuery('radar');
    const hTelemetry = guard.startQuery('telemetry');

    expect(hRadar.queryId).toBe(1);
    expect(hTelemetry.queryId).toBe(2);

    expect(hRadar.isCurrent()).toBe(true);
    expect(hTelemetry.isCurrent()).toBe(true);

    expect(hRadar.commit('radar_ok')).toBe(true);
    expect(hTelemetry.commit('telemetry_ok')).toBe(true);
  });

  it('should executeSafe and discard out-of-order race condition results', async () => {
    const guard = new TacticalQueryRaceGuard();
    const committedValues: string[] = [];

    // Simulate query 1 (takes 50ms)
    const p1 = guard.executeSafe(
      'search',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'FIRST_SLOW_QUERY';
      },
      (res) => {
        committedValues.push(res);
      }
    );

    // Simulate query 2 dispatched 10ms later (takes 10ms)
    await new Promise((resolve) => setTimeout(resolve, 10));
    const p2 = guard.executeSafe(
      'search',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'SECOND_FAST_QUERY';
      },
      (res) => {
        committedValues.push(res);
      }
    );

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1.committed).toBe(false);
    expect(res1.result).toBeNull();

    expect(res2.committed).toBe(true);
    expect(res2.result).toBe('SECOND_FAST_QUERY');

    expect(committedValues).toEqual(['SECOND_FAST_QUERY']);
  });

  it('should trigger AbortSignal on superseded queries', async () => {
    const guard = new TacticalQueryRaceGuard();
    let aborted = false;

    const h1 = guard.startQuery('search');
    h1.signal.addEventListener('abort', () => {
      aborted = true;
    });

    guard.startQuery('search'); // triggers abort on h1
    expect(aborted).toBe(true);
    expect(h1.signal.aborted).toBe(true);
  });

  it('should drain and abort all in-flight queries instantly upon session drain', () => {
    const abortedKeys: string[] = [];
    const guard = new TacticalQueryRaceGuard({
      onQueryAborted: (id, key) => {
        abortedKeys.push(key);
      },
    });

    const h1 = guard.startQuery('radar');
    const h2 = guard.startQuery('poi');

    expect(guard.hasInFlight()).toBe(true);
    expect(guard.getActiveCount()).toBe(2);

    guard.drain('USER_LOGOUT');

    expect(guard.hasInFlight()).toBe(false);
    expect(guard.getActiveCount()).toBe(0);
    expect(h1.isCancelled()).toBe(true);
    expect(h2.isCancelled()).toBe(true);
    expect(abortedKeys).toContain('radar');
    expect(abortedKeys).toContain('poi');
  });

  it('should handle timeout when defaultTimeoutMs is specified', async () => {
    const guard = new TacticalQueryRaceGuard({ defaultTimeoutMs: 20 });
    const h = guard.startQuery('timeout_test');

    expect(h.isCurrent()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(h.signal.aborted).toBe(true);
    expect(h.isCancelled()).toBe(true);
  });
});
