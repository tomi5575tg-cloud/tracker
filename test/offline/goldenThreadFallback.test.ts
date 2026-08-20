import { describe, it, expect } from 'vitest';
import { GoldenThreadOfflineFallback } from '../../src/offline/goldenThreadFallback.js';
import { TacticalTileCacheManager } from '../../src/offline/tileCacheManager.js';
import type { RouteData } from '../../src/types.js';

describe('GoldenThreadOfflineFallback', () => {
  it('should generate synthetic vector tile with Golden Thread path and gridlines', () => {
    const fallback = new GoldenThreadOfflineFallback();

    const route: RouteData = {
      routeId: 'route-golden-offline',
      userId: 'driver-1',
      waypoints: [
        { id: 'w1', coordinate: [21.01, 52.22], timestamp: 1000 },
        { id: 'w2', coordinate: [21.05, 52.25], timestamp: 2000 },
      ],
      distanceMeters: 8000,
      durationSeconds: 600,
      createdAt: 1000,
      updatedAt: 1000,
    };

    fallback.setActiveRoute(route);

    const tileCoord = TacticalTileCacheManager.lonLatToTile(21.01, 52.22, 12);
    const result = fallback.generateSyntheticTile(tileCoord);

    expect(result.hasRouteIntersect).toBe(true);
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('#FFD700'); // Golden Radiant
    expect(result.svg).toContain('#FFF8E7'); // Golden Core Line
    expect(result.svg).toContain('stroke-dasharray="4,4"'); // Tactical Grid
  });

  it('should pregenerate and cache synthetic fallback tiles for all route waypoints', () => {
    const fallback = new GoldenThreadOfflineFallback();
    const cache = new TacticalTileCacheManager();

    const route: RouteData = {
      routeId: 'route-pregen',
      userId: 'driver-1',
      waypoints: [
        { id: 'w1', coordinate: [21.0, 52.2], timestamp: 1000 },
        { id: 'w2', coordinate: [21.1, 52.3], timestamp: 2000 },
        { id: 'w3', coordinate: [21.2, 52.4], timestamp: 3000 },
      ],
      distanceMeters: 30000,
      durationSeconds: 2400,
      createdAt: 1000,
      updatedAt: 1000,
    };

    fallback.setActiveRoute(route);

    const generated = fallback.pregenerateRouteTiles(cache, 10, 11);
    expect(generated).toBeGreaterThan(0);
    expect(cache.getStats().totalEntries).toBe(generated);
  });
});
