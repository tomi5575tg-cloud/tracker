import { describe, it, expect } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import { MapLibreRouteManager } from '../../src/maplibre/routeManager.js';
import { SecureTrackingSessionCoordinator } from '../../src/integration/coordinator.js';
import type { MapLibreMapInstance, MapLibreGeoJsonSource, MapLibreLayerSpecification } from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';
import type { RouteData } from '../../src/types.js';

class MockMapLibreMap implements MapLibreMapInstance {
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();

  public isStyleLoaded(): boolean {
    return true;
  }

  public getSource(id: string): MapLibreGeoJsonSource | undefined {
    const entry = this.sources.get(id);
    if (!entry) return undefined;
    return {
      setData: (data: FeatureCollection | string) => {
        entry.data = data;
      },
    };
  }

  public getSourceData(id: string): FeatureCollection | string | undefined {
    return this.sources.get(id)?.data;
  }

  public addSource(id: string, source: { type: 'geojson'; data: FeatureCollection | string }): void {
    this.sources.set(id, source);
  }

  public removeSource(id: string): void {
    this.sources.delete(id);
  }

  public getLayer(id: string): unknown | undefined {
    return this.layers.get(id);
  }

  public addLayer(layer: MapLibreLayerSpecification): void {
    this.layers.set(layer.id, layer);
  }

  public removeLayer(id: string): void {
    this.layers.delete(id);
  }

  public setLayoutProperty(): void {}
  public setPaintProperty(): void {}
  public once(_event: string, listener: (...args: unknown[]) => void): void {
    listener();
  }
  public on(): void {}
  public off(): void {}
}

describe('End-to-End Integration: Sluza Logowania & Drenaz Sesji (clearRoute)', () => {
  it('should auto-drain MapLibre route when user switches or logs out', async () => {
    const storage = new InMemoryStorageProvider();
    const authBooth = new AuthLockBooth({ storage });
    const mockMap = new MockMapLibreMap();
    const routeManager = new MapLibreRouteManager(mockMap);

    const coordinator = new SecureTrackingSessionCoordinator(authBooth, routeManager);

    // 1. User Alice enters booth
    await authBooth.enterBooth({
      sessionId: 'sess-alice',
      userId: 'user-alice',
      username: 'alice',
      token: 'jwt-alice',
    });

    const aliceRoute: RouteData = {
      routeId: 'route-alice-1',
      userId: 'user-alice',
      distanceMeters: 2000,
      durationSeconds: 600,
      createdAt: 1700000000000,
      updatedAt: 1700000600000,
      waypoints: [
        { id: 'wp-1', coordinate: [21.0, 52.0], timestamp: 1700000000000 },
        { id: 'wp-2', coordinate: [21.05, 52.05], timestamp: 1700000600000 },
      ],
    };

    coordinator.displayRoute(aliceRoute);

    // Verify Alice's route is on map
    const routeSourceData1 = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(routeSourceData1.features).toHaveLength(1);
    expect(routeSourceData1.features[0]!.properties['userId']).toBe('user-alice');

    // 2. User Bob enters booth (Zasada Jednej Kabiny -> Automatic Session Drain of Alice's state)
    await authBooth.enterBooth({
      sessionId: 'sess-bob',
      userId: 'user-bob',
      username: 'bob',
      token: 'jwt-bob',
    });

    // Verify map was automatically drained
    const routeSourceData2 = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(routeSourceData2.features).toHaveLength(0);
    expect(routeManager.getCurrentRoute()).toBeNull();

    // 3. Trying to display Alice's route while Bob is in booth must throw Security Violation
    expect(() => coordinator.displayRoute(aliceRoute)).toThrow(/Security violation/);

    // 4. Bob displays Bob's route
    const bobRoute: RouteData = {
      routeId: 'route-bob-1',
      userId: 'user-bob',
      distanceMeters: 1000,
      durationSeconds: 300,
      createdAt: 1700001000000,
      updatedAt: 1700001300000,
      waypoints: [{ id: 'wp-b1', coordinate: [19.9, 50.0], timestamp: 1700001000000 }],
    };

    coordinator.displayRoute(bobRoute);

    const routeSourceData3 = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(routeSourceData3.features).toHaveLength(1);
    expect(routeSourceData3.features[0]!.properties['userId']).toBe('user-bob');

    // 5. User Bob logs out -> Map is automatically drained
    await authBooth.exitBooth('USER_LOGOUT');
    const routeSourceData4 = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(routeSourceData4.features).toHaveLength(0);

    coordinator.destroy();
  });
});
