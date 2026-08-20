import { describe, it, expect, vi } from 'vitest';
import { TacticalServiceWorkerHandler } from '../../src/offline/serviceWorkerHandler.js';
import { TacticalTileCacheManager } from '../../src/offline/tileCacheManager.js';
import type { RouteData } from '../../src/types.js';

describe('TacticalServiceWorkerHandler', () => {
  it('should intercept tile requests, fetch from network and populate cache', async () => {
    const mockNetworkFetch = vi.fn(async () => {
      const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
      return new Response(buffer, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });

    const handler = new TacticalServiceWorkerHandler({
      networkFetch: mockNetworkFetch,
    });

    const tileUrl = 'https://tiles.tracker.internal/12/2180/1376.png';
    const res1 = await handler.handleFetch(tileUrl);

    expect(res1.status).toBe(200);
    expect(res1.fromCache).toBe(false);
    expect(res1.isFallback).toBe(false);
    expect(mockNetworkFetch).toHaveBeenCalledTimes(1);

    // Second fetch should hit memory cache immediately without touching network
    const res2 = await handler.handleFetch(tileUrl);
    expect(res2.status).toBe(200);
    expect(res2.fromCache).toBe(true);
    expect(res2.headers['x-tracker-cache']).toBe('HIT');
    expect(mockNetworkFetch).toHaveBeenCalledTimes(1); // Still 1!
  });

  it('should seamlessly generate synthetic Golden Thread fallback tile when network fails', async () => {
    const mockOfflineFetch = vi.fn(async () => {
      throw new Error('Network offline');
    });

    const route: RouteData = {
      routeId: 'route-offline-sw',
      userId: 'driver-1',
      waypoints: [
        { id: 'w1', coordinate: [21.0122, 52.2297], timestamp: 1000 },
        { id: 'w2', coordinate: [21.02, 52.23], timestamp: 2000 },
      ],
      distanceMeters: 5000,
      durationSeconds: 400,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const handler = new TacticalServiceWorkerHandler({
      networkFetch: mockOfflineFetch,
    });

    handler.getGoldenThreadFallback().setActiveRoute(route);

    const tile = TacticalTileCacheManager.lonLatToTile(21.0122, 52.2297, 12);
    const tileUrl = `https://tiles.tracker.internal/${tile.z}/${tile.x}/${tile.y}.png`;

    const res = await handler.handleFetch(tileUrl);

    expect(res.status).toBe(200);
    expect(res.isFallback).toBe(true);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['x-tracker-synthetic']).toBe('1');
    expect(typeof res.body === 'string' && res.body.includes('<svg')).toBe(true);
  });

  it('should purge tile caches and active route on session drain', () => {
    const handler = new TacticalServiceWorkerHandler();
    handler.getTileCacheManager().put({ z: 1, x: 1, y: 1 }, 'test_tile');

    expect(handler.getTileCacheManager().getStats().totalEntries).toBe(1);

    handler.drain('LOGOUT');

    expect(handler.getTileCacheManager().getStats().totalEntries).toBe(0);
    expect(handler.getGoldenThreadFallback().getActiveRoute()).toBeNull();
  });
});
