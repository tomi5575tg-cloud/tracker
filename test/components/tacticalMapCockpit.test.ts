import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TacticalMapCockpitController,
  TACTICAL_COCKPIT_TAILWIND_CLASSES,
  TacticalMapCockpit,
} from '../../components/TacticalMapCockpit.js';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
  MapLibreFeatureStateFeature,
  MapLibreLightSpecification,
} from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';
import type { RouteData } from '../../src/types.js';
import type { PoiItem } from '../../src/poi/types.js';

class MockCockpitMap implements MapLibreMapInstance {
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();
  public featureStates = new Map<string, Record<string, unknown>>();
  public currentLight?: MapLibreLightSpecification;
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

  public getSourceData(id: string): FeatureCollection | string | undefined {
    return this.sources.get(id)?.data;
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

  public setLight(light: MapLibreLightSpecification): void {
    this.currentLight = light;
  }

  public getLight(): MapLibreLightSpecification | undefined {
    return this.currentLight;
  }

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

describe('TacticalMapCockpit (Spięcie w Głównym Widoku Kokpitu React + MapLibre)', () => {
  let mockMap: MockCockpitMap;
  let authBooth: AuthLockBooth;

  const sampleRoute: RouteData = {
    routeId: 'TR-WARSAW-KRAKOW-01',
    userId: 'disp-user-1',
    distanceMeters: 295000,
    durationSeconds: 12600,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    waypoints: [
      { id: 'wp-1', coordinate: [21.0122, 52.2297], timestamp: 1700000000000 },
      { id: 'wp-2', coordinate: [19.9449, 50.0647], timestamp: 1700012600000 },
    ],
  };

  const samplePoi: PoiItem = {
    id: 'poi-hub-central',
    categoryId: 'fuel_station',
    name: 'Baza Paliwowa Centralna',
    coordinate: [21.0122, 52.2297],
    status: 'ACTIVE',
    attributes: { brand: 'Orlen Cyber', fuel_types: ['DIESEL', 'PB95'], gate_code: 'PIN-SECRET' },
    createdBy: 'disp-user-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  beforeEach(() => {
    mockMap = new MockCockpitMap();
    authBooth = new AuthLockBooth({
      storage: new InMemoryStorageProvider(),
    });
  });

  it('should initialize cockpit controller with all sub-modules and neon glow layers', () => {
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
      enableNeonGlow: true,
    });

    expect(cockpit.getCoordinator()).toBeDefined();
    expect(cockpit.getAuthBooth()).toBe(authBooth);
    expect(cockpit.getPoiManager()).toBeDefined();
    expect(cockpit.getRouteManager()).toBeDefined();
    expect(cockpit.getPoiLayerManager()).toBeDefined();
    expect(cockpit.getDynamicLightingManager()).toBeDefined();
    expect(cockpit.getTacticalBottomSheet()).toBeDefined();

    // Verify Neon Glow layers added to map
    expect(mockMap.getLayer('tracker-route-golden-core-line')).toBeDefined();
    expect(mockMap.getLayer('tracker-poi-radar-outer-wave')).toBeDefined();

    cockpit.destroy();
  });

  it('should display active route on map and synchronize with bottom sheet telemetry', async () => {
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
    });

    // Enter session in booth
    await authBooth.enterBooth({
      sessionId: 'sess-100',
      userId: 'disp-user-1',
      username: 'dispatcher_pl',
      token: 'jwt-token',
      role: 'DISPATCHER',
      tenantId: 'TENANT-LOGISTICS-EU',
    });

    cockpit.displayRoute(sampleRoute);

    // Verify route set on map
    const routeSourceData = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(routeSourceData.features).toHaveLength(1);

    // Verify bottom sheet telemetry updated
    const sheetState = cockpit.getTacticalBottomSheet().getState();
    expect(sheetState.activeRoute?.routeId).toBe('TR-WARSAW-KRAKOW-01');

    const vm = cockpit.getViewModel();
    expect(vm.topBar.sessionUsername).toBe('dispatcher_pl');
    expect(vm.topBar.sessionRole).toBe('DISPATCHER');
    expect(vm.topBar.tenantId).toBe('TENANT-LOGISTICS-EU');
    expect(vm.topBar.isSessionActive).toBe(true);

    cockpit.destroy();
  });

  it('should handle onItemSelect: centering camera, selecting on GPU layer and opening HUD sheet', async () => {
    const onSelectSpy = vi.fn();
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
      onItemSelect: onSelectSpy,
    });

    await authBooth.enterBooth({
      sessionId: 'sess-100',
      userId: 'disp-user-1',
      username: 'dispatcher_pl',
      token: 'jwt-token',
      role: 'DISPATCHER',
    });

    cockpit.getPoiManager().createPoi(samplePoi);
    cockpit.displayPois([samplePoi]);

    // Select POI
    cockpit.selectPoi(samplePoi);

    expect(onSelectSpy).toHaveBeenCalledWith(samplePoi);

    // Camera centered on POI with HUD-compensated optical insets
    expect(mockMap.cameraEaseParams).toMatchObject({
      center: [21.0122, 52.2297],
      zoom: 15,
      duration: 800,
      padding: expect.objectContaining({
        top: expect.any(Number),
        bottom: expect.any(Number),
      }),
    });

    // GPU featureState updated
    expect(mockMap.getFeatureState({ source: 'tracker-poi-source', id: 'poi-hub-central' })).toEqual({
      selected: true,
    });

    // Bottom sheet received POI and snapped to HALF
    const sheetState = cockpit.getTacticalBottomSheet().getState();
    expect(sheetState.selectedPoi?.id).toBe('poi-hub-central');
    expect(sheetState.snapPoint).toBe('HALF');

    cockpit.destroy();
  });

  it('should perform Radar spatial scan and display nearby POIs', async () => {
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
      initialCenter: [21.0122, 52.2297],
    });

    await authBooth.enterBooth({
      sessionId: 'sess-100',
      userId: 'disp-user-1',
      username: 'dispatcher_pl',
      token: 'jwt-token',
      role: 'DISPATCHER',
    });

    // Create nearby and far POIs
    cockpit.getPoiManager().createPoi(samplePoi); // Warsaw (0km)
    cockpit.getPoiManager().createPoi({
      id: 'poi-far-krakow',
      categoryId: 'warehouse_logistics',
      name: 'Krakow Magazyn',
      coordinate: [19.9449, 50.0647], // ~252km away
      status: 'ACTIVE',
      attributes: { facility_name: 'Kraków Hub Centralny', ramp_count: 5 },
      createdBy: 'disp-user-1',
    });

    // Scan 20km radius around Warsaw
    const scanResult = cockpit.performRadarScan(20000);

    expect(scanResult.totalMatches).toBe(1);
    expect(scanResult.items[0]!.id).toBe('poi-hub-central');

    // Bottom sheet opened to HALF to show scanned POIs
    expect(cockpit.getTacticalBottomSheet().getState().snapPoint).toBe('HALF');

    cockpit.destroy();
  });

  it('should toggle day and night lighting state (Sun vs Moon)', () => {
    // Summer noon start
    const noonTime = Date.UTC(2026, 5, 21, 10, 40, 0);
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
    });

    cockpit.getDynamicLightingManager().setTime(noonTime);
    expect(cockpit.getViewModel().topBar.celestialBody).toBe('SUN');

    // Toggle 14 hours ahead -> Midnight / Moon
    const nextLighting = cockpit.toggleDayNight(14);
    expect(nextLighting.dominantBody).toBe('MOON');
    expect(cockpit.getViewModel().topBar.celestialBody).toBe('MOON');

    cockpit.destroy();
  });

  it('should execute Panic Session Drain and clear everything across map, routes, POIs and HUD', async () => {
    const onDrainSpy = vi.fn();
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
      onSessionDrain: onDrainSpy,
    });

    await authBooth.enterBooth({
      sessionId: 'sess-100',
      userId: 'disp-user-1',
      username: 'dispatcher_pl',
      token: 'jwt-token',
      role: 'DISPATCHER',
    });

    cockpit.displayRoute(sampleRoute);
    cockpit.getPoiManager().createPoi(samplePoi);
    cockpit.displayPois([samplePoi]);
    cockpit.selectPoi(samplePoi);

    expect(cockpit.getTacticalBottomSheet().getState().selectedPoi).not.toBeNull();

    // Trigger panic session drain
    await cockpit.triggerPanicDrain('PANIC_BUTTON_CLICKED');

    expect(onDrainSpy).toHaveBeenCalledWith('PANIC_BUTTON_CLICKED');

    // Bottom sheet wiped and hidden
    expect(cockpit.getTacticalBottomSheet().getState().snapPoint).toBe('HIDDEN');
    expect(cockpit.getTacticalBottomSheet().getState().selectedPoi).toBeNull();
    expect(cockpit.getTacticalBottomSheet().getState().activeRoute).toBeNull();

    // Map route & POI sources emptied
    const drainedRoute = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    expect(drainedRoute.features).toHaveLength(0);

    const drainedPoi = mockMap.getSourceData('tracker-poi-source') as FeatureCollection;
    expect(drainedPoi.features).toHaveLength(0);

    // Auth booth is empty
    expect(authBooth.getStatus().state).toBe('EMPTY');
    expect(cockpit.getViewModel().topBar.isSessionActive).toBe(false);

    cockpit.destroy();
  });

  it('should render HTML template string and support React JSX factory', () => {
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      authBooth,
    });

    const html = cockpit.renderHtml();
    expect(html).toContain('Tracker HUD Cockpit');
    expect(html).toContain('maplibre-cockpit-canvas');
    expect(html).toContain('data-action="radar-scan"');
    expect(html).toContain('data-action="panic-drain"');

    // Test React Functional Component wrapper
    const component = TacticalMapCockpit({
      map: mockMap,
      authBooth,
    });

    expect(component.controller).toBeInstanceOf(TacticalMapCockpitController);
    expect(component.classes.root).toBe(TACTICAL_COCKPIT_TAILWIND_CLASSES.root);
    expect(component.getViewModel().topBar.sessionUsername).toBe('NIEZALOGOWANY');

    cockpit.destroy();
    component.controller.destroy();
  });
});
