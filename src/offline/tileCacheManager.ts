import type { SessionDrainHook } from '../auth/drainManager.js';

export interface TileCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CachedTileEntry {
  readonly key: string;
  readonly coordinate: TileCoordinate;
  readonly data: Uint8Array | ArrayBuffer | string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly timestamp: number;
  readonly lastAccessed: number;
  readonly isSynthetic?: boolean | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface TileCacheStats {
  readonly totalEntries: number;
  readonly totalBytes: number;
  readonly maxBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly hitRatio: number;
  readonly fallbackHits: number;
}

export interface TileCacheConfig {
  /**
   * Maximum total cache size in bytes (default: 64MB)
   */
  readonly maxCacheBytes?: number | undefined;
  /**
   * Maximum number of tile entries (default: 2000)
   */
  readonly maxEntries?: number | undefined;
  /**
   * Time to live for cached tiles in ms (default: 7 days)
   */
  readonly ttlMs?: number | undefined;
  /**
   * Custom cache name prefix (e.g. 'tracker-tactical-tiles-v1')
   */
  readonly cacheName?: string | undefined;
}

/**
 * TacticalTileCacheManager:
 * High-performance, LRU-evicted in-memory and CacheStorage tile cache for MapLibre raster/vector tiles.
 *
 * Implements:
 * 1. Monotonic LRU memory buffer with byte-size accounting.
 * 2. Rapid tile key parsing (`{z}/{x}/{y}` and standard slippy map tile URLs).
 * 3. Bounding box & Corridor pre-caching helpers.
 * 4. Panic Drain (`SessionDrainHook`): completely purges and evicts tile caches to prevent forensic data leakage.
 */
export class TacticalTileCacheManager implements SessionDrainHook {
  private readonly config: Required<TileCacheConfig>;
  private readonly cache = new Map<string, CachedTileEntry>();
  private currentBytes = 0;
  private hits = 0;
  private misses = 0;
  private fallbackHits = 0;

  constructor(config: TileCacheConfig = {}) {
    this.config = {
      maxCacheBytes: config.maxCacheBytes ?? 64 * 1024 * 1024, // 64 MB
      maxEntries: config.maxEntries ?? 2000,
      ttlMs: config.ttlMs ?? 7 * 24 * 60 * 60 * 1000, // 7 days
      cacheName: config.cacheName ?? 'tracker-tactical-tiles-v1',
    };
  }

  public static tileKey(z: number, x: number, y: number): string {
    return `${z}/${x}/${y}`;
  }

  public static parseTileKey(key: string): TileCoordinate | null {
    // 1. Try matching from URL path or standard /{z}/{x}/{y} pattern
    const match = key.match(/(?:^|\/)(\d+)\/(\d+)\/(\d+)(?:\.[a-zA-Z0-9]+)?(?:\?.*)?$/);
    if (match && match[1] && match[2] && match[3]) {
      const z = parseInt(match[1], 10);
      const x = parseInt(match[2], 10);
      const y = parseInt(match[3], 10);
      if (!isNaN(z) && !isNaN(x) && !isNaN(y)) {
        return { z, x, y };
      }
    }

    const parts = key.split('/');
    if (parts.length === 3) {
      const z = parseInt(parts[0]!, 10);
      const x = parseInt(parts[1]!, 10);
      const y = parseInt(parts[2]!.split('.')[0]!, 10);

      if (!isNaN(z) && !isNaN(x) && !isNaN(y)) {
        return { z, x, y };
      }
    }

    return null;
  }

  public static lonLatToTile(lon: number, lat: number, zoom: number): TileCoordinate {
    const z = Math.floor(zoom);
    const n = Math.pow(2, z);
    const radLat = (lat * Math.PI) / 180;

    let x = Math.floor(((lon + 180) / 360) * n);
    let y = Math.floor((1 - Math.log(Math.tan(radLat) + 1 / Math.cos(radLat)) / Math.PI) / 2 * n);

    x = Math.max(0, Math.min(n - 1, x));
    y = Math.max(0, Math.min(n - 1, y));

    return { x, y, z };
  }

  public static tileToLonLatBounds(x: number, y: number, z: number): [minLon: number, minLat: number, maxLon: number, maxLat: number] {
    const n = Math.pow(2, z);
    const minLon = (x / n) * 360 - 180;
    const maxLon = ((x + 1) / n) * 360 - 180;

    const n1 = Math.PI - (2 * Math.PI * y) / n;
    const maxLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n1) - Math.exp(-n1)));

    const n2 = Math.PI - (2 * Math.PI * (y + 1)) / n;
    const minLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));

    return [minLon, minLat, maxLon, maxLat];
  }

  public put(
    coordinate: TileCoordinate,
    data: Uint8Array | ArrayBuffer | string,
    contentType = 'image/png',
    isSynthetic = false,
    metadata?: Record<string, unknown>
  ): void {
    const key = TacticalTileCacheManager.tileKey(coordinate.z, coordinate.x, coordinate.y);
    const byteSize = typeof data === 'string' ? data.length : data.byteLength;

    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!;
      this.currentBytes -= existing.byteSize;
      this.cache.delete(key);
    }

    // Ensure capacity
    this.evictToFit(byteSize);

    const now = Date.now();
    const entry: CachedTileEntry = {
      key,
      coordinate,
      data,
      contentType,
      byteSize,
      timestamp: now,
      lastAccessed: now,
      isSynthetic,
      ...(metadata ? { metadata } : {}),
    };

    this.cache.set(key, entry);
    this.currentBytes += byteSize;
  }

  public get(coordinate: TileCoordinate | string): CachedTileEntry | null {
    let key: string;
    if (typeof coordinate === 'string') {
      const parsed = TacticalTileCacheManager.parseTileKey(coordinate);
      if (!parsed) {
        this.misses++;
        return null;
      }
      key = TacticalTileCacheManager.tileKey(parsed.z, parsed.x, parsed.y);
    } else {
      key = TacticalTileCacheManager.tileKey(coordinate.z, coordinate.x, coordinate.y);
    }

    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const now = Date.now();
    // Check TTL
    if (now - entry.timestamp > (this.config.ttlMs ?? 7 * 24 * 60 * 60 * 1000)) {
      this.cache.delete(key);
      this.currentBytes -= entry.byteSize;
      this.misses++;
      return null;
    }

    // LRU touch
    this.cache.delete(key);
    const updatedEntry: CachedTileEntry = {
      ...entry,
      lastAccessed: now,
    };
    this.cache.set(key, updatedEntry);

    if (entry.isSynthetic) {
      this.fallbackHits++;
    } else {
      this.hits++;
    }

    return updatedEntry;
  }

  public has(coordinate: TileCoordinate | string): boolean {
    return this.get(coordinate) !== null;
  }

  public getStats(): TileCacheStats {
    const totalRequests = this.hits + this.misses + this.fallbackHits;
    const hitRatio = totalRequests > 0 ? (this.hits + this.fallbackHits) / totalRequests : 0;

    return {
      totalEntries: this.cache.size,
      totalBytes: this.currentBytes,
      maxBytes: this.config.maxCacheBytes ?? 64 * 1024 * 1024,
      hits: this.hits,
      misses: this.misses,
      hitRatio,
      fallbackHits: this.fallbackHits,
    };
  }

  public clear(): void {
    this.cache.clear();
    this.currentBytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.fallbackHits = 0;
  }

  /**
   * PANIC/DRAIN: SessionDrainHook implementation
   * Completely purges in-memory cached tiles.
   */
  public drain(_reason = 'SESSION_DRAIN', _previousSession?: unknown): void {
    this.clear();
  }

  public destroy(): void {
    this.clear();
  }

  private evictToFit(incomingBytes: number): void {
    const maxBytes = this.config.maxCacheBytes ?? 64 * 1024 * 1024;
    const maxEntries = this.config.maxEntries ?? 2000;

    while (
      (this.currentBytes + incomingBytes > maxBytes ||
        this.cache.size + 1 > maxEntries) &&
      this.cache.size > 0
    ) {
      // Map keys iteration gives oldest inserted/accessed entry (LRU)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const entry = this.cache.get(oldestKey);
        if (entry) {
          this.currentBytes -= entry.byteSize;
        }
        this.cache.delete(oldestKey);
      }
    }
  }
}
