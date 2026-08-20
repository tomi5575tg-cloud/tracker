import type { SessionDrainHook } from './drainManager.js';

export type QueryRaceGuardStatus = 'IDLE' | 'EXECUTING' | 'ABORTED' | 'SUPERSEDED' | 'DRAINED';

export interface QueryExecutionHandle<T> {
  readonly queryId: number;
  readonly key: string;
  readonly signal: AbortSignal;
  readonly isCancelled: () => boolean;
  readonly isCurrent: () => boolean;
  readonly registerCleanup: (cleanup: () => void) => void;
  readonly commit: (result: T) => boolean;
}

export interface QueryRaceGuardOptions {
  /**
   * Optional global timeout for any in-flight query (milliseconds)
   */
  readonly defaultTimeoutMs?: number | undefined;
  /**
   * Callback invoked whenever a query is superseded by a newer one
   */
  readonly onQuerySuperseded?: ((queryId: number, key: string) => void) | undefined;
  /**
   * Callback invoked whenever an error or abort occurs
   */
  readonly onQueryAborted?: ((queryId: number, key: string, reason: string) => void) | undefined;
}

/**
 * TacticalQueryRaceGuard:
 * High-performance, bulletproof concurrency guard preventing out-of-order execution,
 * race conditions, stale state overwrite, and memory leaks across spatial and telemetry queries.
 *
 * Key mechanisms:
 * 1. Monotonic Sequence IDs: Every dispatched query gets a strictly increasing integer sequence ID.
 * 2. Scoped Keys: Separate channels (e.g. 'radar_scan', 'route_telemetry', 'poi_search') don't block each other.
 * 3. In-flight AbortController: Automatically triggers abort signals on superseded operations to immediately free network/CPU sockets.
 * 4. Commit Barrier: Only results matching the latest active sequence ID are committed; stale results are safely discarded.
 * 5. Full SessionDrainHook Integration: Drains and cancels all in-flight queries instantly upon session logout or panic drain.
 */
export class TacticalQueryRaceGuard implements SessionDrainHook {
  private readonly options: QueryRaceGuardOptions;
  private sequenceCounter = 0;
  private readonly activeQueries = new Map<
    string,
    {
      queryId: number;
      controller: AbortController;
      cleanups: Array<() => void>;
      timeoutTimer?: ReturnType<typeof setTimeout> | undefined;
    }
  >();
  private isDrained = false;

  constructor(options: QueryRaceGuardOptions = {}) {
    this.options = options;
  }

  /**
   * Starts a protected query execution cycle for a given channel/key.
   * Automatically supersedes and aborts any previously in-flight query on the same key.
   */
  public startQuery<T>(key = 'default'): QueryExecutionHandle<T> {
    if (this.isDrained) {
      this.isDrained = false;
    }

    // 1. Cancel and abort previous in-flight query on the same key
    this.cancelKey(key, 'SUPERSEDED');

    // 2. Increment monotonic sequence ID
    const queryId = ++this.sequenceCounter;
    const controller = new AbortController();
    const cleanups: Array<() => void> = [];

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (this.options.defaultTimeoutMs && this.options.defaultTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        controller.abort(new Error(`Query ${queryId} on key "${key}" timed out after ${this.options.defaultTimeoutMs}ms`));
        this.options.onQueryAborted?.(queryId, key, 'TIMEOUT');
      }, this.options.defaultTimeoutMs);
    }

    const entry = {
      queryId,
      controller,
      cleanups,
      timeoutTimer,
    };

    this.activeQueries.set(key, entry);

    const isCurrent = () => {
      if (this.isDrained) return false;
      const current = this.activeQueries.get(key);
      return current !== undefined && current.queryId === queryId && !controller.signal.aborted;
    };

    const isCancelled = () => {
      return controller.signal.aborted || !isCurrent();
    };

    const registerCleanup = (cleanup: () => void) => {
      cleanups.push(cleanup);
    };

    const commit = (_result: T): boolean => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }

      if (!isCurrent()) {
        // Result is stale or superseded - discard silently
        this.runCleanups(cleanups);
        return false;
      }

      // Query succeeded as current
      this.activeQueries.delete(key);
      this.runCleanups(cleanups);
      return true;
    };

    return {
      queryId,
      key,
      signal: controller.signal,
      isCancelled,
      isCurrent,
      registerCleanup,
      commit,
    };
  }

  /**
   * Executes an asynchronous task safely wrapped with race condition protection.
   * If a newer call with the same key is started while this one is pending,
   * the earlier promise resolves to null / is superseded and its onCommit callback is skipped.
   */
  public async executeSafe<T>(
    key: string,
    task: (signal: AbortSignal, handle: QueryExecutionHandle<T>) => Promise<T>,
    onCommit?: (result: T, handle: QueryExecutionHandle<T>) => void | Promise<void>
  ): Promise<{ committed: boolean; result: T | null; queryId: number }> {
    const handle = this.startQuery<T>(key);

    try {
      if (handle.isCancelled()) {
        return { committed: false, result: null, queryId: handle.queryId };
      }

      const rawResult = await task(handle.signal, handle);

      if (handle.isCancelled()) {
        return { committed: false, result: null, queryId: handle.queryId };
      }

      const committed = handle.commit(rawResult);
      if (committed) {
        if (onCommit) {
          await onCommit(rawResult, handle);
        }
        return { committed: true, result: rawResult, queryId: handle.queryId };
      }

      return { committed: false, result: null, queryId: handle.queryId };
    } catch (err: unknown) {
      if (this.activeQueries.get(key)?.queryId === handle.queryId) {
        const currentEntry = this.activeQueries.get(key);
        if (currentEntry?.timeoutTimer) {
          clearTimeout(currentEntry.timeoutTimer);
        }
        if (currentEntry) {
          this.runCleanups(currentEntry.cleanups);
        }
        this.activeQueries.delete(key);
      }

      const isAbort = (err instanceof Error && err.name === 'AbortError') || handle.signal.aborted;
      if (!isAbort) {
        this.options.onQueryAborted?.(handle.queryId, key, err instanceof Error ? err.message : String(err));
        throw err;
      }

      return { committed: false, result: null, queryId: handle.queryId };
    }
  }

  /**
   * Cancels a specific query key immediately
   */
  public cancelKey(key: string, reason = 'MANUAL_CANCEL'): void {
    const existing = this.activeQueries.get(key);
    if (existing) {
      if (existing.timeoutTimer) {
        clearTimeout(existing.timeoutTimer);
      }
      try {
        existing.controller.abort(new Error(`Query ${existing.queryId} aborted: ${reason}`));
      } catch {
        // Safe disposal
      }
      this.runCleanups(existing.cleanups);
      this.activeQueries.delete(key);

      if (reason === 'SUPERSEDED') {
        this.options.onQuerySuperseded?.(existing.queryId, key);
      } else {
        this.options.onQueryAborted?.(existing.queryId, key, reason);
      }
    }
  }

  /**
   * Returns whether a key currently has an active in-flight query
   */
  public hasInFlight(key?: string): boolean {
    if (key !== undefined) {
      return this.activeQueries.has(key);
    }
    return this.activeQueries.size > 0;
  }

  /**
   * Returns current active query ID for a key
   */
  public getActiveQueryId(key: string): number | null {
    return this.activeQueries.get(key)?.queryId ?? null;
  }

  /**
   * Returns total count of active in-flight queries across all keys
   */
  public getActiveCount(): number {
    return this.activeQueries.size;
  }

  /**
   * PANIC/DRAIN: SessionDrainHook implementation
   * Instantly aborts and drains all active queries across all channels, cleans up timers, and marks state.
   */
  public drain(reason = 'SESSION_DRAIN', _previousSession?: unknown): void {
    this.isDrained = true;
    for (const [key, entry] of this.activeQueries.entries()) {
      if (entry.timeoutTimer) {
        clearTimeout(entry.timeoutTimer);
      }
      try {
        entry.controller.abort(new Error(`Query ${entry.queryId} on key "${key}" drained: ${reason}`));
      } catch {
        // Safe disposal
      }
      this.runCleanups(entry.cleanups);
      this.options.onQueryAborted?.(entry.queryId, key, `DRAIN:${reason}`);
    }
    this.activeQueries.clear();
  }

  public destroy(): void {
    this.drain('DESTROY');
  }

  private runCleanups(cleanups: Array<() => void>): void {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        try {
          fn();
        } catch {
          // Safe cleanup execution
        }
      }
    }
  }
}
