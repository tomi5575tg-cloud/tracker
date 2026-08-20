import { describe, it, expect, vi } from 'vitest';
import { TacticalMapCockpitController } from '../../components/TacticalMapCockpit.js';
import type { MapLibreMapInstance } from '../../src/maplibre/types.js';
import type { RouteData } from '../../src/types.js';
import type { PoiItem } from '../../src/poi/types.js';

function createMockMap(): MapLibreMapInstance {
  const sources = new Map<string, any>();
  const layers = new Map<string, any>();

  return {
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, src: any) => {
      sources.set(id, { setData: vi.fn() });
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((layer: any) => {
      layers.set(layer.id, layer);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    setLight: vi.fn(),
    getLight: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    easeTo: vi.fn(),
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    stop: vi.fn(),
    once: vi.fn((_event, cb) => cb()),
    on: vi.fn(),
    off: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
    setFeatureState: vi.fn(),
    getFeatureState: vi.fn(() => ({})),
    removeFeatureState: vi.fn(),
  };
}

describe('Tactical Optics & Race Guard Integration', () => {
  it('should auto-frame POI with optical camera insets when selectPoi or onItemSelect is invoked', async () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      initialCenter: [21.0122, 52.2297],
    });

    await cockpit.getAuthBooth().enterBooth({
      sessionId: 's1',
      userId: 'u1',
      username: 'Tomi',
      role: 'ADMIN',
      token: 'tok-1',
      loginTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
    });

    const samplePoi: PoiItem = {
      id: 'poi-optics-1',
      categoryId: 'fuel_station',
      name: 'Orlen Cyber Hub',
      coordinate: [21.05, 52.25],
      status: 'ACTIVE',
      attributes: {
        brand: 'Orlen',
        fuel_types: ['DIESEL', 'PB95'],
      },
      tags: [],
      createdBy: 'u1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    cockpit.getPoiManager().createPoi(samplePoi);

    cockpit.selectPoi(samplePoi);

    expect(mockMap.easeTo).toHaveBeenCalled();
    const easeArgs = (mockMap.easeTo as any).mock.calls[0][0];
    expect(easeArgs.center).toEqual([21.05, 52.25]);
    expect(easeArgs.padding).toBeDefined();
    expect(easeArgs.padding.top).toBeGreaterThan(50);
    expect(easeArgs.padding.bottom).toBeGreaterThan(50);
  });

  it('should auto-frame route with bounding box insets when displayRoute is called', async () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
    });

    await cockpit.getAuthBooth().enterBooth({
      sessionId: 's1',
      userId: 'u1',
      username: 'Tomi',
      role: 'ADMIN',
      token: 'tok-1',
      loginTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
    });

    const route: RouteData = {
      routeId: 'route-test-101',
      userId: 'u1',
      waypoints: [
        { id: 'w1', coordinate: [21.0, 52.2], timestamp: 1000 },
        { id: 'w2', coordinate: [21.3, 52.5], timestamp: 2000 },
      ],
      distanceMeters: 50000,
      durationSeconds: 3600,
      createdAt: 1000,
      updatedAt: 1000,
    };

    cockpit.displayRoute(route);

    expect(mockMap.fitBounds).toHaveBeenCalled();
    const fitArgs = (mockMap.fitBounds as any).mock.calls[0];
    expect(fitArgs[0]).toEqual([
      [21.0, 52.2],
      [21.3, 52.5],
    ]);
    expect(fitArgs[1].padding.bottom).toBeGreaterThan(50);
  });

  it('should execute performRadarScanSafe with query race protection', async () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      initialCenter: [21.0122, 52.2297],
    });

    await cockpit.getAuthBooth().enterBooth({
      sessionId: 's1',
      userId: 'u1',
      username: 'Tomi',
      role: 'ADMIN',
      token: 'tok-1',
      loginTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
    });

    const samplePoi: PoiItem = {
      id: 'poi-radar-1',
      categoryId: 'fuel_station',
      name: 'Warsaw Hub',
      coordinate: [21.0125, 52.2299], // ~30 meters from center
      status: 'ACTIVE',
      attributes: {
        brand: 'Shell',
        fuel_types: ['DIESEL', 'LPG'],
      },
      tags: [],
      createdBy: 'u1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };

    cockpit.getPoiManager().createPoi(samplePoi);

    const scanResult = await cockpit.performRadarScanSafe(5000);

    expect(scanResult.committed).toBe(true);
    expect(scanResult.totalMatches).toBe(1);
    expect(scanResult.items[0]?.id).toBe('poi-radar-1');
    expect(cockpit.getTacticalBottomSheet().getState().snapPoint).toBe('HALF');
  });

  it('should drain camera optics and query race guard during panic drain', async () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
    });

    await cockpit.getAuthBooth().enterBooth({
      sessionId: 's1',
      userId: 'u1',
      username: 'Tomi',
      role: 'ADMIN',
      token: 'tok-1',
      loginTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
    });

    await cockpit.triggerPanicDrain('PANIC_TEST');

    expect(mockMap.stop).toHaveBeenCalled();
    expect(cockpit.getQueryRaceGuard().hasInFlight()).toBe(false);
    expect(cockpit.getAuthBooth().getStatus().state).toBe('EMPTY');
  });
});
