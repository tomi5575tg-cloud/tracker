import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapLibreGeoJsonAdapter } from '../../src/maplibre/geoJsonAdapter.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
  MapLibreLayerEvent,
  MapLibreFeatureStateFeature,
  MapLibreMarker,
  MapLibrePopup,
} from '../../src/maplibre/types.js';
import type { FeatureCollection, PointGeometry } from '../../src/geojson/types.js';

class MockMapLibreMap implements MapLibreMapInstance {
  private styleLoaded = true;
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();
  private featureStates = new Map<string, Record<string, unknown>>();
  private listeners = new Map<string, Array<(...args: any[]) => void>>();
  private layerListeners = new Map<string, Array<(e: MapLibreLayerEvent) => void>>();

  public canvasStyle = { cursor: '' };
  public fittedBounds: [[number, number], [number, number]] | null = null;

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
      if (existing) {
        delete existing[key];
      }
    } else {
      this.featureStates.delete(`${feature.source}:${feature.id}`);
    }
  }

  public getCanvas(): { style: { cursor: string } } {
    return { style: this.canvasStyle };
  }

  public fitBounds(bounds: any): void {
    this.fittedBounds = bounds;
  }

  public once(event: string, listener: (...args: unknown[]) => void): void {
    this.on(event, listener);
  }

  public on(event: string, ...args: any[]): void {
    if (typeof args[0] === 'string') {
      const layerId = args[0];
      const listener = args[1];
      const key = `${event}:${layerId}`;
      const list = this.layerListeners.get(key) ?? [];
      list.push(listener);
      this.layerListeners.set(key, list);
    } else {
      const listener = args[0];
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
    }
  }

  public off(event: string, ...args: any[]): void {
    if (typeof args[0] === 'string') {
      const layerId = args[0];
      const listener = args[1];
      const key = `${event}:${layerId}`;
      const list = this.layerListeners.get(key) ?? [];
      this.layerListeners.set(
        key,
        list.filter((l) => l !== listener)
      );
    } else {
      const listener = args[0];
      const list = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        list.filter((l) => l !== listener)
      );
    }
  }

  public trigger(event: string, ...args: any[]): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const listener of list) {
        listener(...args);
      }
    }
  }

  public triggerLayer(event: string, layerId: string, eventData: MapLibreLayerEvent): void {
    const list = this.layerListeners.get(`${event}:${layerId}`);
    if (list) {
      for (const listener of list) {
        listener(eventData);
      }
    }
  }
}

describe('MapLibreGeoJsonAdapter (Lekki Adapter GeoJSON)', () => {
  let mockMap: MockMapLibreMap;

  const samplePointsCollection: FeatureCollection<PointGeometry, { name: string; type: string }> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'poi-1',
        geometry: { type: 'Point', coordinates: [21.0122, 52.2297] }, // Warsaw
        properties: { name: 'Warsaw HQ', type: 'office' },
      },
      {
        type: 'Feature',
        id: 'poi-2',
        geometry: { type: 'Point', coordinates: [19.9449, 50.0647] }, // Krakow
        properties: { name: 'Krakow Hub', type: 'warehouse' },
      },
    ],
  };

  beforeEach(() => {
    mockMap = new MockMapLibreMap();
  });

  it('should initialize source and layer specifications on map', () => {
    const adapter = new MapLibreGeoJsonAdapter(mockMap, {
      sourceId: 'custom-poi-source',
      layers: [
        {
          id: 'custom-poi-circles',
          type: 'circle',
          paint: { 'circle-radius': 6, 'circle-color': '#009688' },
        },
      ],
    });

    expect(mockMap.getSource('custom-poi-source')).toBeDefined();
    expect(mockMap.getLayer('custom-poi-circles')).toBeDefined();
    expect(adapter.getData().features).toHaveLength(0);
  });

  it('should set data and auto fit bounds if configured', () => {
    const adapter = new MapLibreGeoJsonAdapter(mockMap, {
      sourceId: 'live-points',
      autoFitBounds: true,
    });

    adapter.setData(samplePointsCollection);

    const sourceData = mockMap.getSourceData('live-points') as FeatureCollection;
    expect(sourceData.features).toHaveLength(2);
    expect(mockMap.fittedBounds).not.toBeNull();
  });

  it('should support debounced data updates for telemetry streaming', async () => {
    vi.useFakeTimers();

    const adapter = new MapLibreGeoJsonAdapter(mockMap, {
      sourceId: 'telemetry-stream',
      debounceMs: 50,
    });

    adapter.setDataDebounced(samplePointsCollection, 50);

    // Not yet updated immediately
    expect((mockMap.getSourceData('telemetry-stream') as FeatureCollection).features).toHaveLength(0);

    // Fast-forward time
    vi.advanceTimersByTime(60);

    expect((mockMap.getSourceData('telemetry-stream') as FeatureCollection).features).toHaveLength(2);

    vi.useRealTimers();
  });

  it('should handle feature click events', () => {
    const adapter = new MapLibreGeoJsonAdapter(mockMap, {
      sourceId: 'interactive-source',
      layers: [{ id: 'clickable-layer', type: 'circle' }],
    });

    const clickSpy = vi.fn();
    adapter.onFeatureClick('clickable-layer', clickSpy);

    mockMap.triggerLayer('click', 'clickable-layer', {
      features: [samplePointsCollection.features[0]!],
    });

    expect(clickSpy).toHaveBeenCalledWith(
      samplePointsCollection.features[0],
      expect.anything()
    );
  });

  it('should handle feature hover, featureState and cursor management', () => {
    const adapter = new MapLibreGeoJsonAdapter(mockMap, {
      sourceId: 'hover-source',
      layers: [{ id: 'hover-layer', type: 'circle' }],
      changeCursorOnHover: true,
      hoverCursor: 'crosshair',
    });

    const hoverSpy = vi.fn();
    adapter.onFeatureHover('hover-layer', hoverSpy);

    // Mouse enter on Feature 1
    mockMap.triggerLayer('mouseenter', 'hover-layer', {
      features: [samplePointsCollection.features[0]!],
    });

    expect(mockMap.canvasStyle.cursor).toBe('crosshair');
    expect(mockMap.getFeatureState({ source: 'hover-source', id: 'poi-1' })).toEqual({ hover: true });
    expect(hoverSpy).toHaveBeenCalledWith(samplePointsCollection.features[0], expect.anything());

    // Mouse leave
    mockMap.triggerLayer('mouseleave', 'hover-layer', {});
    expect(mockMap.canvasStyle.cursor).toBe('');
    expect(hoverSpy).toHaveBeenCalledWith(null, expect.anything());
  });

  it('should drain and clear data, featureState, HTML markers and popups on clear() or drain()', () => {
    const adapter = new MapLibreGeoJsonAdapter(mockMap, {
      sourceId: 'drain-source',
      layers: [{ id: 'drain-layer', type: 'circle' }],
    });

    adapter.setData(samplePointsCollection);
    adapter.setHoveredFeature('poi-1');
    adapter.setSelectedFeature('poi-2');

    const mockMarker: MapLibreMarker = {
      remove: vi.fn(),
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      getElement: () => ({} as HTMLElement),
    };

    const mockPopup: MapLibrePopup = {
      remove: vi.fn(),
      isOpen: () => true,
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      setText: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
    };

    adapter.registerMarker(mockMarker);
    adapter.registerPopup(mockPopup);

    // Execute Drain
    adapter.drain('SESSION_SWITCH', null);

    expect(mockMarker.remove).toHaveBeenCalled();
    expect(mockPopup.remove).toHaveBeenCalled();
    expect(adapter.getData().features).toHaveLength(0);

    const sourceData = mockMap.getSourceData('drain-source') as FeatureCollection;
    expect(sourceData.features).toHaveLength(0);
  });
});
