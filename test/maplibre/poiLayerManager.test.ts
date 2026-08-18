import { describe, it, expect, vi } from 'vitest';
import { MapLibrePoiLayerManager } from '../../src/maplibre/poiLayerManager.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreMarker,
  MapLibrePopup,
  MapLibreLayerSpecification,
} from '../../src/maplibre/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';
import { FUEL_STATION_CATEGORY } from '../../src/poi/defaultCategories.js';
import type { PoiItem } from '../../src/poi/types.js';

class MockMapLibreMap implements MapLibreMapInstance {
  private styleLoaded = true;
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();

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

  public setLayoutProperty(): void {}
  public setPaintProperty(): void {}
  public once(): void {}
  public on(): void {}
  public off(): void {}
}

describe('MapLibrePoiLayerManager', () => {
  it('should initialize MapLibre GeoJSON source and circle/symbol layers', () => {
    const mockMap = new MockMapLibreMap();
    const poiLayerManager = new MapLibrePoiLayerManager(mockMap);

    expect(mockMap.getSource('tracker-poi-source')).toBeDefined();
    expect(mockMap.getLayer('tracker-poi-circles')).toBeDefined();
    expect(mockMap.getLayer('tracker-poi-symbols')).toBeDefined();
  });

  it('should set POI items on MapLibre GeoJSON source', () => {
    const mockMap = new MockMapLibreMap();
    const poiLayerManager = new MapLibrePoiLayerManager(mockMap);

    const testPois: PoiItem[] = [
      {
        id: 'poi-1',
        categoryId: 'fuel_station',
        name: 'Stacja A',
        coordinate: [21.0, 52.0],
        status: 'ACTIVE',
        attributes: { brand: 'Shell', fuel_types: ['DIESEL'] },
        createdBy: 'user',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        version: 1,
      },
    ];

    poiLayerManager.setPoiItems(testPois, {
      categories: [FUEL_STATION_CATEGORY],
    });

    const sourceData = mockMap.getSourceData('tracker-poi-source') as FeatureCollection;
    expect(sourceData.type).toBe('FeatureCollection');
    expect(sourceData.features).toHaveLength(1);
    expect(sourceData.features[0]!.id).toBe('poi-1');
  });

  it('should drain and clear all POI data, HTML markers, and popups on clearPoi()', () => {
    const mockMap = new MockMapLibreMap();
    const poiLayerManager = new MapLibrePoiLayerManager(mockMap);

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

    poiLayerManager.registerMarker(mockMarker);
    poiLayerManager.registerPopup(mockPopup);

    expect(poiLayerManager.getMarkerCount()).toBe(1);
    expect(poiLayerManager.getPopupCount()).toBe(1);

    // Call clearPoi
    poiLayerManager.clearPoi();

    expect(mockMarker.remove).toHaveBeenCalled();
    expect(mockPopup.remove).toHaveBeenCalled();
    expect(poiLayerManager.getMarkerCount()).toBe(0);
    expect(poiLayerManager.getPopupCount()).toBe(0);

    const sourceData = mockMap.getSourceData('tracker-poi-source') as FeatureCollection;
    expect(sourceData.features).toHaveLength(0);
  });
});
