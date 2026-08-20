import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapLibrePoiLayerManager } from '../../src/maplibre/poiLayerManager.js';
import { MapLibreGeoJsonAdapter } from '../../src/maplibre/geoJsonAdapter.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
  MapLibreLayerEvent,
  MapLibreFeatureStateFeature,
} from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';
import type { PoiItem } from '../../src/poi/types.js';

class MockSelectionMap implements MapLibreMapInstance {
  public sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  public layers = new Map<string, MapLibreLayerSpecification>();
  public featureStates = new Map<string, Record<string, unknown>>();
  public layerListeners = new Map<string, Array<(e: MapLibreLayerEvent) => void>>();
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

  public on(event: string, ...args: any[]): void {
    if (typeof args[0] === 'string') {
      const key = `${event}:${args[0]}`;
      const list = this.layerListeners.get(key) ?? [];
      list.push(args[1]);
      this.layerListeners.set(key, list);
    }
  }

  public off(): void {}
  public once(): void {}

  public triggerLayerClick(layerId: string, eventData: MapLibreLayerEvent): void {
    const list = this.layerListeners.get(`click:${layerId}`);
    if (list) {
      for (const listener of list) {
        listener(eventData);
      }
    }
  }
}

describe('Spięcie onItemSelect z silnikiem MapLibre GL JS', () => {
  let mockMap: MockSelectionMap;

  const samplePoiA: PoiItem = {
    id: 'poi-krakow-hub',
    categoryId: 'warehouse_logistics',
    name: 'Krakow Logistics Hub',
    coordinate: [19.9449, 50.0647], // [lon, lat]
    status: 'ACTIVE',
    attributes: { ramp_count: 15 },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  const samplePoiB: PoiItem = {
    id: 'poi-warsaw-hub',
    categoryId: 'fuel_station',
    name: 'Warsaw Fuel Center',
    coordinate: [21.0122, 52.2297],
    status: 'ACTIVE',
    attributes: { brand: 'Orlen' },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  beforeEach(() => {
    mockMap = new MockSelectionMap();
  });

  describe('MapLibrePoiLayerManager.onItemSelect', () => {
    it('should select POI by object, center camera and update GPU feature-state', () => {
      const onItemSelectSpy = vi.fn();
      const poiLayerManager = new MapLibrePoiLayerManager(mockMap, {
        onItemSelect: onItemSelectSpy,
      });

      poiLayerManager.setPoiItems([samplePoiA, samplePoiB]);

      // Trigger selection
      poiLayerManager.onItemSelect(samplePoiA, {
        centerCamera: true,
        zoom: 14,
      });

      expect(onItemSelectSpy).toHaveBeenCalledWith(samplePoiA);

      // Verify GPU featureState updated
      expect(mockMap.getFeatureState({ source: 'tracker-poi-source', id: 'poi-krakow-hub' })).toEqual({
        selected: true,
      });

      // Verify camera centered
      expect(mockMap.cameraEaseParams).toEqual({
        center: [19.9449, 50.0647],
        zoom: 14,
        duration: 800,
      });
    });

    it('should switch selection to another POI and deactivate previous feature-state', () => {
      const poiLayerManager = new MapLibrePoiLayerManager(mockMap);
      poiLayerManager.setPoiItems([samplePoiA, samplePoiB]);

      // Select A
      poiLayerManager.selectPoi('poi-krakow-hub');
      expect(mockMap.getFeatureState({ source: 'tracker-poi-source', id: 'poi-krakow-hub' })).toEqual({
        selected: true,
      });

      // Select B
      poiLayerManager.selectPoi('poi-warsaw-hub');
      expect(mockMap.getFeatureState({ source: 'tracker-poi-source', id: 'poi-krakow-hub' })).toEqual({
        selected: false,
      });
      expect(mockMap.getFeatureState({ source: 'tracker-poi-source', id: 'poi-warsaw-hub' })).toEqual({
        selected: true,
      });
    });
  });

  describe('MapLibreGeoJsonAdapter.onItemSelect & onFeatureClick', () => {
    it('should select item on feature click and dispatch onItemSelect callback', () => {
      const onItemSelectSpy = vi.fn();
      const adapter = new MapLibreGeoJsonAdapter(mockMap, {
        sourceId: 'poi-adapter-source',
        layers: [{ id: 'poi-layer', type: 'circle' }],
        onItemSelect: onItemSelectSpy,
      });

      adapter.onFeatureClick('poi-layer', vi.fn());

      // Trigger map click on layer
      mockMap.triggerLayerClick('poi-layer', {
        features: [
          {
            type: 'Feature',
            id: 'poi-krakow-hub',
            geometry: { type: 'Point', coordinates: [19.9449, 50.0647] },
            properties: { name: 'Krakow Hub' },
          },
        ],
      });

      expect(onItemSelectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'poi-krakow-hub' })
      );

      // Verify selected feature state
      expect(mockMap.getFeatureState({ source: 'poi-adapter-source', id: 'poi-krakow-hub' })).toEqual({
        selected: true,
      });
    });
  });
});
