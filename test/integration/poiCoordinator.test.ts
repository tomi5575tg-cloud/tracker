import { describe, it, expect, vi } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import { MapLibreRouteManager } from '../../src/maplibre/routeManager.js';
import { MapLibrePoiLayerManager } from '../../src/maplibre/poiLayerManager.js';
import { PoiManager } from '../../src/poi/poiManager.js';
import { SecureTrackingSessionCoordinator } from '../../src/integration/coordinator.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
} from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';
import type { RouteData } from '../../src/types.js';
import type { PoiItem } from '../../src/poi/types.js';

class MockMapLibreMap implements MapLibreMapInstance {
  private styleLoaded = true;
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();
  public stopped = false;

  public isStyleLoaded(): boolean {
    return this.styleLoaded;
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

  public stop(): void {
    this.stopped = true;
  }

  public setLayoutProperty(): void {}
  public setPaintProperty(): void {}
  public once(): void {}
  public on(): void {}
  public off(): void {}
}

describe('SecureTrackingSessionCoordinator POI & Route Integration', () => {
  it('should synchronize Session Drain across Routes and POI Map Layers on user switch', async () => {
    const authBooth = new AuthLockBooth({
      storage: new InMemoryStorageProvider(),
    });

    const routeMap = new MockMapLibreMap();
    const poiMap = new MockMapLibreMap();

    const routeManager = new MapLibreRouteManager(routeMap);
    const poiLayerManager = new MapLibrePoiLayerManager(poiMap);
    const poiManager = new PoiManager({ authBooth });

    const coordinator = new SecureTrackingSessionCoordinator(authBooth, routeManager, {
      poiLayerManager,
      poiManager,
    });

    // 1. Enter booth as Dispatcher
    await authBooth.enterBooth({
      sessionId: 'sess-disp-1',
      userId: 'user-dispatcher',
      username: 'disp_john',
      token: 'tok-disp',
      role: 'DISPATCHER',
    });

    // 2. Set route
    const sampleRoute: RouteData = {
      routeId: 'route-active-1',
      userId: 'user-dispatcher',
      distanceMeters: 5000,
      durationSeconds: 1200,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      waypoints: [
        { id: 'wp-1', coordinate: [21.0, 52.0], timestamp: 1700000000000 },
        { id: 'wp-2', coordinate: [21.1, 52.1], timestamp: 1700000600000 },
      ],
    };

    coordinator.displayRoute(sampleRoute);
    const routeSourceData = routeMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(routeSourceData.features).toHaveLength(1);

    // 3. Create POI with sensitive data and display on map
    const poi: PoiItem = poiManager.createPoi({
      id: 'poi-secret-fuel',
      categoryId: 'fuel_station',
      name: 'Stacja Paliw Baza',
      coordinate: [21.05, 52.05],
      status: 'ACTIVE',
      attributes: {
        brand: 'Lotos',
        fuel_types: ['DIESEL', 'ADBLUE'],
        gate_code: 'TOP_SECRET_GATE_CODE_999',
      },
      createdBy: 'user-dispatcher',
    });

    coordinator.displayPois([poi]);
    const poiSourceData = poiMap.getSourceData('tracker-poi-source') as FeatureCollection;
    expect(poiSourceData.features).toHaveLength(1);
    // Dispatcher has POI_READ_SENSITIVE -> gate_code is intact
    expect(poiSourceData.features[0]!.properties['attributes']['gate_code']).toBe('TOP_SECRET_GATE_CODE_999');

    // 4. Switch user to Driver (User 2) -> Single Booth triggers automatic DRAIN of both Route & POIs
    await authBooth.enterBooth({
      sessionId: 'sess-driver-2',
      userId: 'user-driver-2',
      username: 'driver_bob',
      token: 'tok-driver',
      role: 'DRIVER',
    });

    // Verify both route source and POI source were drained to empty FeatureCollections
    const drainedRouteData = routeMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(drainedRouteData.features).toHaveLength(0);

    const drainedPoiData = poiMap.getSourceData('tracker-poi-source') as FeatureCollection;
    expect(drainedPoiData.features).toHaveLength(0);

    // Also POI manager memory cache was drained
    expect(poiManager.listPois()).toHaveLength(0);

    coordinator.destroy();
  });
});
