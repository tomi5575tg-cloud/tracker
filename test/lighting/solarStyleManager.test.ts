import { describe, it, expect, vi } from 'vitest';
import { AutonomousSolarStyleManager } from '../../src/lighting/solarStyleManager.js';
import { DynamicLightingManager } from '../../src/lighting/dynamicLightingManager.js';
import type { MapLibreMapInstance } from '../../src/maplibre/types.js';

function createMockMap(): MapLibreMapInstance {
  const layers = new Map<string, any>();
  const listeners = new Map<string, Array<(...args: any[]) => void>>();

  return {
    getSource: vi.fn(),
    addSource: vi.fn(),
    removeSource: vi.fn(),
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
    setStyle: vi.fn(),
    getStyle: vi.fn(() => ({})),
    once: vi.fn((event, cb) => cb()),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
    }),
    off: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
    setFeatureState: vi.fn(),
    getFeatureState: vi.fn(() => ({})),
    removeFeatureState: vi.fn(),
  };
}

describe('AutonomousSolarStyleManager', () => {
  it('should autonomously resolve appropriate tactical style based on solar altitude and ephemeris', () => {
    const mockMap = createMockMap();
    const lighting = new DynamicLightingManager(mockMap, {
      observerCoordinate: [21.0122, 52.2297],
    });

    const manager = new AutonomousSolarStyleManager(mockMap, {
      lightingManager: lighting,
    });

    // 1. High noon daylight
    lighting.setTime(Date.UTC(2026, 5, 21, 10, 40, 0)); // Solar Noon in Warsaw in June (~61 deg altitude)
    const dayState = lighting.getState();
    const dayTheme = manager.resolveThemeForState(dayState);
    expect(dayTheme).toBe('DAYLIGHT');

    // 2. Midnight / deep night
    lighting.setTime(Date.UTC(2026, 5, 21, 23, 0, 0)); // Midnight (~-14 deg altitude)
    const nightState = lighting.getState();
    const nightTheme = manager.resolveThemeForState(nightState);
    expect(nightTheme).toBe('NIGHT_OBSIDIAN');
  });

  it('should trigger setStyle on MapLibre and automatically re-inject Golden Thread & POI radar layers', () => {
    const mockMap = createMockMap();
    let reinjectedTheme: string | null = null;
    let reinjectedLayersList: string[] = [];

    const manager = new AutonomousSolarStyleManager(mockMap, {
      onReinjectionComplete: (theme, layers) => {
        reinjectedTheme = theme;
        reinjectedLayersList = layers;
      },
    });

    manager.applyTheme('GOLDEN_HOUR');

    expect(mockMap.setStyle).toHaveBeenCalled();
    expect(reinjectedTheme).toBe('GOLDEN_HOUR');
    expect(reinjectedLayersList.length).toBeGreaterThan(0);
    expect(reinjectedLayersList).toContain('tracker-route-golden-core-line');
    expect(reinjectedLayersList).toContain('tracker-poi-radar-core-circle');
  });

  it('should invoke registered custom onReinject callbacks during style reloads', () => {
    const mockMap = createMockMap();
    const manager = new AutonomousSolarStyleManager(mockMap);
    let customCallbackInvoked = false;

    manager.onReinject(() => {
      customCallbackInvoked = true;
    });

    manager.reinjectGoldenThreadAndLayers();

    expect(customCallbackInvoked).toBe(true);
  });

  it('should clean up glow layers and disarm timers on session drain', () => {
    const mockMap = createMockMap();
    const manager = new AutonomousSolarStyleManager(mockMap);

    manager.drain('PANIC_LOGOUT');

    expect(manager.isAutoSwitching()).toBe(false);
  });
});
