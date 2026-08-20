import { describe, it, expect, vi } from 'vitest';
import { TacticalCameraOpticsEngine } from '../../src/maplibre/cameraOptics.js';
import type { MapLibreMapInstance } from '../../src/maplibre/types.js';
import type { PoiItem } from '../../src/poi/types.js';
import type { RouteData } from '../../src/types.js';

function createMockMap(): MapLibreMapInstance {
  return {
    getSource: vi.fn(),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    getLayer: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    easeTo: vi.fn(),
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    stop: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('TacticalCameraOpticsEngine', () => {
  it('should accurately calculate HUD viewport insets for different bottom sheet snap points', () => {
    const mockMap = createMockMap();
    const optics = new TacticalCameraOpticsEngine(mockMap, {
      insetsConfig: {
        topBarHeightPx: 64,
        floatingToolbarWidthPx: 68,
        safetyPaddingPx: 20,
      },
      snapConfig: {
        peekHeightPx: 80,
        halfRatio: 0.5,
        expandedRatio: 0.9,
      },
    });

    // PEEK snap (80px + 20px padding = 100px bottom)
    const peekInsets = optics.computeViewportInsets('PEEK');
    expect(peekInsets.top).toBe(84); // 64 + 20
    expect(peekInsets.right).toBe(88); // 68 + 20
    expect(peekInsets.left).toBe(20);
    expect(peekInsets.bottom).toBe(100); // 80 + 20

    // HALF snap (800px * 0.5 = 400px + 20px = 420px bottom)
    const halfInsets = optics.computeViewportInsets('HALF');
    expect(halfInsets.bottom).toBe(420);

    // EXPANDED snap (800px * 0.9 = 720px + 20px = 740px bottom)
    const expInsets = optics.computeViewportInsets('EXPANDED');
    expect(expInsets.bottom).toBe(740);

    // HIDDEN snap (0px + 20px = 20px bottom)
    const hiddenInsets = optics.computeViewportInsets('HIDDEN');
    expect(hiddenInsets.bottom).toBe(20);
  });

  it('should calculate optical center offset to compensate for asymmetrical HUD elements', () => {
    const mockMap = createMockMap();
    const optics = new TacticalCameraOpticsEngine(mockMap);

    const insets = { top: 88, bottom: 384, left: 24, right: 92 };
    const offset = optics.computeOpticalCenterOffset(insets);

    // X offset: (24 - 92)/2 = -34 (shift left)
    expect(offset.offsetX).toBe(-34);
    // Y offset: (88 - 384)/2 = -148 (shift up to center in sweet spot)
    expect(offset.offsetY).toBe(-148);
  });

  it('should frame a single POI item with HUD-compensated camera options', () => {
    const mockMap = createMockMap();
    const optics = new TacticalCameraOpticsEngine(mockMap);

    const samplePoi: PoiItem = {
      id: 'poi-test-1',
      categoryId: 'fuel_station',
      name: 'Orlen Hub',
      coordinate: [21.0122, 52.2297],
      status: 'ACTIVE',
      attributes: {},
      tags: [],
      createdBy: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    };

    optics.framePoi(samplePoi, {
      targetZoom: 16,
      durationMs: 750,
      bottomSheetSnap: 'HALF',
    });

    expect(mockMap.easeTo).toHaveBeenCalledTimes(1);
    const callArgs = (mockMap.easeTo as any).mock.calls[0][0];
    expect(callArgs.center).toEqual([21.0122, 52.2297]);
    expect(callArgs.zoom).toBe(16);
    expect(callArgs.duration).toBe(750);
    expect(callArgs.padding.bottom).toBeGreaterThan(300); // compensated for HALF snap
    expect(optics.getState().lastFramedType).toBe('POI');
  });

  it('should frame a complete route and waypoints bounding box with fitBounds and HUD insets', () => {
    const mockMap = createMockMap();
    const optics = new TacticalCameraOpticsEngine(mockMap);

    const sampleRoute: RouteData = {
      routeId: 'rt-101',
      userId: 'user-1',
      waypoints: [
        { id: 'w1', coordinate: [21.0, 52.2], timestamp: 1000 },
        { id: 'w2', coordinate: [21.1, 52.3], timestamp: 2000 },
        { id: 'w3', coordinate: [21.2, 52.4], timestamp: 3000 },
      ],
      distanceMeters: 45000,
      durationSeconds: 2400,
      createdAt: 1000,
      updatedAt: 1000,
    };

    optics.frameRoute(sampleRoute, { bottomSheetSnap: 'PEEK' });

    expect(mockMap.fitBounds).toHaveBeenCalledTimes(1);
    const [bounds, fitOptions] = (mockMap.fitBounds as any).mock.calls[0];
    expect(bounds).toEqual([
      [21.0, 52.2],
      [21.2, 52.4],
    ]);
    expect(fitOptions.padding.top).toBe(88); // 64 + 24
    expect(fitOptions.padding.bottom).toBe(108); // 84 + 24
    expect(optics.getState().lastFramedType).toBe('ROUTE');
  });

  it('should instantly stop animations and reset camera upon session drain', () => {
    const mockMap = createMockMap();
    const optics = new TacticalCameraOpticsEngine(mockMap, {
      defaultCamera: { center: [21.0, 52.0], zoom: 10 },
    });

    optics.drain('PANIC_LOGOUT');

    expect(mockMap.stop).toHaveBeenCalled();
    expect(mockMap.jumpTo).toHaveBeenCalledWith({ center: [21.0, 52.0], zoom: 10 });
    expect(optics.getState().lastFramedType).toBe('RESET');
  });
});
