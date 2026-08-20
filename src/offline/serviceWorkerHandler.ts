import { TacticalTileCacheManager, type TileCoordinate } from './tileCacheManager.js';
import { GoldenThreadOfflineFallback } from './goldenThreadFallback.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface ServiceWorkerRequest {
  readonly url: string;
  readonly method?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
}

export interface ServiceWorkerResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array | ArrayBuffer | string;
  readonly fromCache: boolean;
  readonly isFallback: boolean;
}

export interface TacticalServiceWorkerConfig {
  readonly tileCacheManager?: TacticalTileCacheManager | undefined;
  readonly goldenThreadFallback?: GoldenThreadOfflineFallback | undefined;
  /**
   * Tile URL matching regex pattern
   */
  readonly tileUrlPattern?: RegExp | undefined;
  /**
   * Custom fetch proxy for network tile retrieval
   */
  readonly networkFetch?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
}

/**
 * TacticalServiceWorkerHandler:
 * Robust, bulletproof Service Worker fetch interceptor and offline tile router.
 *
 * Architecture:
 * 1. Cache-First with Dynamic Network Fallback & Synthetic Tile Generation.
 * 2. When offline or server returns 4xx/5xx/timeout, effortlessly routes to the GoldenThreadOfflineFallback.
 * 3. Sanitizes headers and handles byte buffers transparently.
 * 4. Implements SessionDrainHook: immediately purges caches upon session drain.
 */
export class TacticalServiceWorkerHandler implements SessionDrainHook {
  private readonly tileCacheManager: TacticalTileCacheManager;
  private readonly goldenThreadFallback: GoldenThreadOfflineFallback;
  private readonly tileUrlPattern: RegExp;
  private readonly networkFetch: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(config: TacticalServiceWorkerConfig = {}) {
    this.tileCacheManager = config.tileCacheManager ?? new TacticalTileCacheManager();
    this.goldenThreadFallback = config.goldenThreadFallback ?? new GoldenThreadOfflineFallback();
    this.tileUrlPattern = config.tileUrlPattern ?? /\/(\d+)\/(\d+)\/(\d+)(?:\.(?:png|pbf|mvt|webp|jpg|jpeg|svg))?(?:\?.*)?$/;
    this.networkFetch =
      config.networkFetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : async () => {
            throw new Error('Network offline or fetch unavailable');
          });
  }

  public getTileCacheManager(): TacticalTileCacheManager {
    return this.tileCacheManager;
  }

  public getGoldenThreadFallback(): GoldenThreadOfflineFallback {
    return this.goldenThreadFallback;
  }

  /**
   * Parses tile coordinates from a tile URL
   */
  public extractTileCoordinate(url: string): TileCoordinate | null {
    const match = url.match(this.tileUrlPattern);
    if (match && match[1] && match[2] && match[3]) {
      return {
        z: parseInt(match[1], 10),
        x: parseInt(match[2], 10),
        y: parseInt(match[3], 10),
      };
    }
    return null;
  }

  /**
   * Primary fetch event handler: intercepts tile requests, consults cache,
   * falls back to network, or serves synthetic vector tile for Golden Thread.
   */
  public async handleFetch(request: ServiceWorkerRequest | string): Promise<ServiceWorkerResponse> {
    const url = typeof request === 'string' ? request : request.url;
    const tileCoord = this.extractTileCoordinate(url);

    if (!tileCoord) {
      // Not a tile request - forward directly to network
      try {
        const netRes = await this.networkFetch(url);
        const body = await netRes.arrayBuffer();
        return {
          status: netRes.status,
          statusText: netRes.statusText,
          headers: this.extractHeaders(netRes),
          body,
          fromCache: false,
          isFallback: false,
        };
      } catch (err) {
        return {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
          headers: { 'content-type': 'text/plain' },
          body: String(err),
          fromCache: false,
          isFallback: false,
        };
      }
    }

    // 1. Check local LRU Tile Cache
    const cached = this.tileCacheManager.get(tileCoord);
    if (cached) {
      return {
        status: 200,
        statusText: 'OK (Cache)',
        headers: {
          'content-type': cached.contentType,
          'x-tracker-cache': 'HIT',
          'x-tracker-synthetic': cached.isSynthetic ? '1' : '0',
        },
        body: cached.data,
        fromCache: true,
        isFallback: !!cached.isSynthetic,
      };
    }

    // 2. Try fetching from network
    try {
      const netRes = await this.networkFetch(url);
      if (netRes.ok) {
        const buffer = await netRes.arrayBuffer();
        const contentType = netRes.headers.get('content-type') ?? 'image/png';

        // Cache the newly retrieved tile
        this.tileCacheManager.put(tileCoord, buffer, contentType, false);

        return {
          status: netRes.status,
          statusText: netRes.statusText,
          headers: {
            ...this.extractHeaders(netRes),
            'x-tracker-cache': 'MISS',
          },
          body: buffer,
          fromCache: false,
          isFallback: false,
        };
      }
    } catch {
      // Network failure / offline mode
    }

    // 3. Fallback: Dynamic Synthetic Tile Generation for Golden Thread
    const synthetic = this.goldenThreadFallback.generateSyntheticTile(tileCoord);
    this.tileCacheManager.put(tileCoord, synthetic.svg, 'image/svg+xml', true, {
      fallbackGenerated: true,
    });

    return {
      status: 200,
      statusText: 'OK (Golden Thread Fallback)',
      headers: {
        'content-type': 'image/svg+xml',
        'x-tracker-cache': 'FALLBACK',
        'x-tracker-synthetic': '1',
      },
      body: synthetic.svg,
      fromCache: false,
      isFallback: true,
    };
  }

  /**
   * SessionDrainHook implementation
   */
  public drain(reason = 'SW_DRAIN', previousSession?: unknown): void {
    this.tileCacheManager.drain(reason, previousSession);
    this.goldenThreadFallback.setActiveRoute(null);
  }

  public destroy(): void {
    this.drain('DESTROY');
  }

  private extractHeaders(res: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    if (res.headers && typeof res.headers.forEach === 'function') {
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }
    return headers;
  }
}
