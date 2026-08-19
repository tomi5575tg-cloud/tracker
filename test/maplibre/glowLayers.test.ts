import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NEON_GLOW_THEME,
  createGoldenThreadLayers,
  createPoiRadarLayers,
  applyNeonGlowLayers,
} from '../../lib/mapGlowLayers.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
} from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';

class MockMapLibreMap implements MapLibreMapInstance {
  private styleLoaded = true;
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  public isStyleLoaded(): boolean {
    return this.styleLoaded;
  }

  public setStyleLoaded(loaded: boolean): void {
    this.styleLoaded = loaded;
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

  public once(event: string, listener: (...args: unknown[]) => void): void {
    this.on(event, listener);
  }

  public on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  public off(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((l) => l !== listener)
    );
  }

  public trigger(event: string, ...args: any[]): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const listener of list) {
        listener(...args);
      }
    }
  }
}

describe('Neon Glow Layers (Złota Nitka + Radar POI - lib/mapGlowLayers.ts)', () => {
  let mockMap: MockMapLibreMap;

  beforeEach(() => {
    mockMap = new MockMapLibreMap();
  });

  describe('Golden Thread Layers (Złota Nitka)', () => {
    it('should generate 3 optical neon glow layers with proper zoom interpolation and colors', () => {
      const layers = createGoldenThreadLayers({
        routeSourceId: 'my-route-source',
      });

      expect(layers).toHaveLength(3);

      const [outerGlow, midGlow, coreLine] = layers;

      // 1. Outer Amber Glow Layer
      expect(outerGlow?.id).toBe('tracker-route-golden-outer-glow');
      expect(outerGlow?.type).toBe('line');
      expect(outerGlow?.source).toBe('my-route-source');
      expect(outerGlow?.paint?.['line-color']).toBe(NEON_GLOW_THEME.goldenGlow);
      expect(outerGlow?.paint?.['line-opacity']).toBe(0.75);

      // 2. Mid Gold Radiant Layer
      expect(midGlow?.id).toBe('tracker-route-golden-mid-glow');
      expect(midGlow?.type).toBe('line');
      expect(midGlow?.paint?.['line-color']).toBe(NEON_GLOW_THEME.goldenMid);

      // 3. Inner Core White-Gold Thread Layer
      expect(coreLine?.id).toBe('tracker-route-golden-core-line');
      expect(coreLine?.type).toBe('line');
      expect(coreLine?.paint?.['line-color']).toBe(NEON_GLOW_THEME.goldenCore);
      expect(coreLine?.paint?.['line-opacity']).toBe(1.0);
    });

    it('should allow custom colors for golden thread neon layers', () => {
      const customLayers = createGoldenThreadLayers({
        coreColor: '#FFFFFF',
        midColor: '#FFCC00',
        glowColor: '#FF9900',
      });

      expect(customLayers[0]?.paint?.['line-color']).toBe('#FF9900');
      expect(customLayers[1]?.paint?.['line-color']).toBe('#FFCC00');
      expect(customLayers[2]?.paint?.['line-color']).toBe('#FFFFFF');
    });
  });

  describe('POI Radar Layers (Punkty Radaru POI)', () => {
    it('should generate 5 multi-tier radar & halo glow layers with feature-state support', () => {
      const layers = createPoiRadarLayers({
        poiSourceId: 'my-poi-source',
      });

      expect(layers).toHaveLength(5);

      const [outerWave, midRing, coreCircle, centerDot, symbols] = layers;

      // 1. Outer Radar Wave
      expect(outerWave?.id).toBe('tracker-poi-radar-outer-wave');
      expect(outerWave?.type).toBe('circle');
      expect(outerWave?.source).toBe('my-poi-source');
      expect(outerWave?.paint?.['circle-blur']).toBe(0.8);

      // 2. Mid Halo Ring
      expect(midRing?.id).toBe('tracker-poi-radar-mid-ring');
      expect(midRing?.type).toBe('circle');
      expect(midRing?.paint?.['circle-stroke-width']).toBe(2);

      // 3. Core Circle
      expect(coreCircle?.id).toBe('tracker-poi-radar-core-circle');
      expect(coreCircle?.type).toBe('circle');

      // 4. Center Hotspot Dot
      expect(centerDot?.id).toBe('tracker-poi-radar-center-dot');
      expect(centerDot?.type).toBe('circle');
      expect(centerDot?.paint?.['circle-color']).toBe(NEON_GLOW_THEME.radarCenterDot);

      // 5. Symbols with halo
      expect(symbols?.id).toBe('tracker-poi-radar-symbols');
      expect(symbols?.type).toBe('symbol');
      expect(symbols?.paint?.['text-halo-color']).toBe('#0B0F19');
    });
  });

  describe('applyNeonGlowLayers integration', () => {
    it('should apply both Golden Thread and POI Radar layers to MapLibre Map and provide clean removal callback', () => {
      const { goldenThreadLayerIds, poiRadarLayerIds, removeGlowLayers } = applyNeonGlowLayers(mockMap, {
        routeSourceId: 'tracker-route-source',
        poiSourceId: 'tracker-poi-source',
      });

      expect(goldenThreadLayerIds).toHaveLength(3);
      expect(poiRadarLayerIds).toHaveLength(5);

      for (const id of [...goldenThreadLayerIds, ...poiRadarLayerIds]) {
        expect(mockMap.getLayer(id)).toBeDefined();
      }

      // Remove glow layers
      removeGlowLayers();

      for (const id of [...goldenThreadLayerIds, ...poiRadarLayerIds]) {
        expect(mockMap.getLayer(id)).toBeUndefined();
      }
    });

    it('should schedule addition if style is not loaded yet', () => {
      mockMap.setStyleLoaded(false);

      const { goldenThreadLayerIds } = applyNeonGlowLayers(mockMap);

      // Not loaded yet
      expect(mockMap.getLayer(goldenThreadLayerIds[0]!)).toBeUndefined();

      // Style loaded event
      mockMap.setStyleLoaded(true);
      mockMap.trigger('load');

      expect(mockMap.getLayer(goldenThreadLayerIds[0]!)).toBeDefined();
    });
  });
});
