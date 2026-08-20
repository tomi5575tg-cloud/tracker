import { describe, it, expect } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import { MapLibreRouteManager } from '../../src/maplibre/routeManager.js';
import { MapLibrePoiLayerManager } from '../../src/maplibre/poiLayerManager.js';
import { PoiManager } from '../../src/poi/poiManager.js';
import { TacticalBottomSheetController } from '../../components/TacticalBottomSheet.js';
import { SecureTrackingSessionCoordinator } from '../../src/integration/coordinator.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
  MapLibreFeatureStateFeature,
} from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';

class MockCoordinatorMap implements MapLibreMapInstance {
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();
  public featureStates = new Map<string, Record<string, unknown>>();
  public cameraEaseParams: any = null;

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

  public addSource(id: string, source: any): void {
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

  public setFeatureState(feature: MapLibreFeatureStateFeature, state: Record<string, unknown>): void {
    const key = `${feature.source}:${feature.id}`;
    const existing = this.featureStates.get(key) ?? {};
    this.featureStates.set(key, { ...existing, ...state });
  }

  public getFeatureState(feature: MapLibreFeatureStateFeature): Record<string, unknown> | undefined {
    return this.featureStates.get(`${feature.source}:${feature.id}`);
  }

  public removeFeatureState(feature: MapLibreFeatureStateFeature, key?: string): void {
    if (key) {
      const stateKey = `${feature.source}:${feature.id}`;
      const existing = this.featureStates.get(stateKey);
      if (existing) delete existing[key];
    } else {
      this.featureStates.delete(`${feature.source}:${feature.id}`);
    }
  }

  public easeTo(params: any): void {
    this.cameraEaseParams = params;
  }

  public once(): void {}
  public on(): void {}
  public off(): void {}
}

describe('Bidirectional onItemSelect in SecureTrackingSessionCoordinator & TacticalBottomSheet', () => {
  it('should synchronize POI selection between MapLibre GPU layer and Tactical Bottom Sheet', async () => {
    const authBooth = new AuthLockBooth({
      storage: new InMemoryStorageProvider(),
    });

    const mockMap = new MockCoordinatorMap();
    const routeManager = new MapLibreRouteManager(mockMap);
    const poiLayerManager = new MapLibrePoiLayerManager(mockMap);
    const poiManager = new PoiManager({ authBooth });
    const tacticalBottomSheet = new TacticalBottomSheetController({
      initialSnapPoint: 'PEEK',
    });

    const coordinator = new SecureTrackingSessionCoordinator(authBooth, routeManager, {
      poiLayerManager,
      poiManager,
      tacticalBottomSheet,
    });

    // Login as Dispatcher
    await authBooth.enterBooth({
      sessionId: 'sess-disp-10',
      userId: 'user-disp-10',
      username: 'dispatcher_john',
      token: 'jwt-10',
      role: 'DISPATCHER',
    });

    // Create and display POI
    const poi = poiManager.createPoi({
      id: 'poi-radar-station',
      categoryId: 'fuel_station',
      name: 'Stacja Paliw i Strefa EV Orlen',
      coordinate: [21.0122, 52.2297],
      status: 'ACTIVE',
      attributes: {
        brand: 'Orlen',
        fuel_types: ['DIESEL', 'EV_FAST'],
      },
      createdBy: 'user-disp-10',
    });

    coordinator.displayPois([poi]);

    // Initial state: Bottom sheet in PEEK, nothing selected
    expect(tacticalBottomSheet.getState().selectedPoi).toBeNull();

    // Trigger coordinator onItemSelect with centerCamera
    coordinator.onItemSelect('poi-radar-station', {
      centerCamera: true,
      zoom: 15,
    });

    // Verify 1: Tactical Bottom Sheet received POI, expanded to HALF, and updated header
    expect(tacticalBottomSheet.getState().selectedPoi?.id).toBe('poi-radar-station');
    expect(tacticalBottomSheet.getState().snapPoint).toBe('HALF');
    expect(tacticalBottomSheet.getHeaderViewModel().title).toBe('Stacja Paliw i Strefa EV Orlen');

    // Verify 2: MapLibre camera centered
    expect(mockMap.cameraEaseParams).toEqual({
      center: [21.0122, 52.2297],
      zoom: 15,
      duration: 800,
    });

    // Verify 3: MapLibre GPU feature-state updated to selected: true
    expect(mockMap.getFeatureState({ source: 'tracker-poi-source', id: 'poi-radar-station' })).toEqual({
      selected: true,
    });

    coordinator.destroy();
  });
});
