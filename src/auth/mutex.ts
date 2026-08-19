/**
 * Asynchronous Mutex lock with FIFO queue, timeout support, and cancellation token
 */
export class AsyncMutex {
  private locked = false;
  private queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = [];

  /**
   * Checks if mutex is currently locked
   */
  public isLocked(): boolean {
    return this.locked;
  }

  /**
   * Number of pending waiters in the queue
   */
  public get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Acquires the lock. Returns a release function when acquired.
   * If timeoutMs is provided, rejects if lock cannot be acquired within the timeout.
   */
  public acquire(timeoutMs?: number): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      const entry: {
        resolve: (release: () => void) => void;
        reject: (err: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
      } = {
        resolve,
        reject,
      };

      if (timeoutMs !== undefined && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index !== -1) {
            this.queue.splice(index, 1);
            reject(new Error(`AsyncMutex acquisition timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }

      if (!this.locked) {
        this.locked = true;
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        resolve(this.createReleaseFunction());
      } else {
        this.queue.push(entry);
      }
    });
  }

  /**
   * Executes a callback within the lock, ensuring release is always called.
   */
  public async runExclusive<T>(callback: () => Promise<T> | T, timeoutMs?: number): Promise<T> {
    const release = await this.acquire(timeoutMs);
    try {
      return await callback();
    } finally {
      release();
    }
  }

  /**
   * Cancel all pending waiters with an error
   */
  public cancelAll(reason = 'Mutex queue cancelled'): void {
    const pending = this.queue;
    this.queue = [];
    for (const item of pending) {
      if (item.timer) {
        clearTimeout(item.timer);
      }
      item.reject(new Error(reason));
    }
  }

  private createReleaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) {
          if (next.timer) {
            clearTimeout(next.timer);
          }
          next.resolve(this.createReleaseFunction());
        }
      } else {
        this.locked = false;
      }
    };
  }
}
