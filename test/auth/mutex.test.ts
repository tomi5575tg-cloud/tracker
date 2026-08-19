import { describe, it, expect } from 'vitest';
import { AsyncMutex } from '../../src/auth/mutex.js';

describe('AsyncMutex', () => {
  it('should guarantee mutual exclusion between concurrent tasks', async () => {
    const mutex = new AsyncMutex();
    const sequence: number[] = [];

    const task = async (id: number, delayMs: number) => {
      await mutex.runExclusive(async () => {
        sequence.push(id);
        await new Promise((r) => setTimeout(r, delayMs));
        sequence.push(id * 10);
      });
    };

    await Promise.all([task(1, 30), task(2, 20), task(3, 10)]);

    // Check that each block ran exclusively without interleaving
    expect(sequence).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('should handle timeout when acquiring lock', async () => {
    const mutex = new AsyncMutex();

    const release = await mutex.acquire();

    await expect(mutex.acquire(50)).rejects.toThrow(/timed out/);

    release();
    expect(mutex.isLocked()).toBe(false);
  });

  it('should allow subsequent acquisitions after previous lock release', async () => {
    const mutex = new AsyncMutex();

    const release1 = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);
    release1();
    expect(mutex.isLocked()).toBe(false);

    const release2 = await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);
    release2();
    expect(mutex.isLocked()).toBe(false);
  });
});
