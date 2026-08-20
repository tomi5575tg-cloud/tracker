import { describe, it, expect } from 'vitest';
import { TacticalTileCacheManager } from '../../src/offline/tileCacheManager.js';

describe('TacticalTileCacheManager', () => {
  it('should parse and serialize tile keys and coordinates accurately', () => {
    const key = TacticalTileCacheManager.tileKey(14, 9425, 5472);
    expect(key).toBe('14/9425/5472');

    const parsed = TacticalTileCacheManager.parseTileKey(key);
    expect(parsed).toEqual({ z: 14, x: 9425, y: 5472 });

    const fromUrl = TacticalTileCacheManager.parseTileKey('https://tile.openstreetmap.org/12/2180/1376.png');
    expect(fromUrl).toEqual({ z: 12, x: 2180, y: 1376 });
  });

  it('should calculate accurate slippy map tile coordinates and bounding boxes', () => {
    // Warsaw: [21.0122, 52.2297], zoom 12
    const tile = TacticalTileCacheManager.lonLatToTile(21.0122, 52.2297, 12);
    expect(tile.z).toBe(12);
    expect(tile.x).toBeGreaterThan(2000);
    expect(tile.y).toBeGreaterThan(1000);

    const bounds = TacticalTileCacheManager.tileToLonLatBounds(tile.x, tile.y, tile.z);
    expect(bounds[0]).toBeLessThanOrEqual(21.0122);
    expect(bounds[2]).toBeGreaterThanOrEqual(21.0122);
    expect(bounds[1]).toBeLessThanOrEqual(52.2297);
    expect(bounds[3]).toBeGreaterThanOrEqual(52.2297);
  });

  it('should store and retrieve tiles with LRU eviction and memory bounds', () => {
    const cache = new TacticalTileCacheManager({
      maxCacheBytes: 500, // Very small cache to force LRU eviction
      maxEntries: 10,
    });

    const tile1 = { z: 10, x: 1, y: 1 };
    const tile2 = { z: 10, x: 2, y: 2 };
    const tile3 = { z: 10, x: 3, y: 3 };

    // 200 bytes each
    const data1 = 'a'.repeat(200);
    const data2 = 'b'.repeat(200);
    const data3 = 'c'.repeat(200);

    cache.put(tile1, data1);
    cache.put(tile2, data2);

    expect(cache.has(tile1)).toBe(true);
    expect(cache.has(tile2)).toBe(true);

    // Adding 3rd tile will exceed 500 bytes (200 * 3 = 600 > 500), should evict tile1 (LRU)
    cache.put(tile3, data3);

    expect(cache.has(tile1)).toBe(false);
    expect(cache.has(tile2)).toBe(true);
    expect(cache.has(tile3)).toBe(true);

    const stats = cache.getStats();
    expect(stats.totalBytes).toBe(400);
    expect(stats.totalEntries).toBe(2);
  });

  it('should completely purge memory during panic drain', () => {
    const cache = new TacticalTileCacheManager();
    cache.put({ z: 1, x: 0, y: 0 }, 'tile_data');

    expect(cache.getStats().totalEntries).toBe(1);

    cache.drain('PANIC_TEST');

    expect(cache.getStats().totalEntries).toBe(0);
    expect(cache.getStats().totalBytes).toBe(0);
  });
});
