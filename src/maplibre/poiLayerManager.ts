import { createEmptyFeatureCollection } from '../geojson/types.js';
import type { MapLibreMapInstance, MapLibreMarker, MapLibrePopup } from './types.js';
import type {
  PoiGeoJsonFeatureCollection,
  PoiItem,
  PoiPointFeature,
  PoiGeoJsonFeatureProperties,
} from '../poi/types.js';
import { PoiGeoJsonConverter, type PoiToGeoJsonOptions } from '../poi/converter.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface PoiLayerConfig {
  readonly sourceId?: string | undefined;
  readonly circleLayerId?: string | undefined;
  readonly symbolLayerId?: string | undefined;
  readonly clusterLayerId?: string | undefined;
  readonly clusterCountLayerId?: string | undefined;
  readonly enableClustering?: boolean | undefined;
  readonly clusterMaxZoom?: number | undefined;
  readonly clusterRadius?: number | undefined;
}

interface ResolvedPoiLayerConfig {
  readonly sourceId: string;
  readonly circleLayerId: string;
  readonly symbolLayerId: string;
  readonly clusterLayerId: string;
  readonly clusterCountLayerId: string;
  readonly enableClustering: boolean;
  readonly clusterMaxZoom: number;
  readonly clusterRadius: number;
}

export const DEFAULT_POI_LAYER_CONFIG: ResolvedPoiLayerConfig = {
  sourceId: 'tracker-poi-source',
  circleLayerId: 'tracker-poi-circles',
  symbolLayerId: 'tracker-poi-symbols',
  clusterLayerId: 'tracker-poi-clusters',
  clusterCountLayerId: 'tracker-poi-cluster-count',
  enableClustering: false,
  clusterMaxZoom: 14,
  clusterRadius: 50,
};

export class MapLibrePoiLayerManager implements SessionDrainHook {
  private readonly map: MapLibreMapInstance;
  private readonly config: ResolvedPoiLayerConfig;
  private readonly markers = new Set<MapLibreMarker>();
  private readonly popups = new Set<MapLibrePopup>();
  private initialized = false;

  constructor(map: MapLibreMapInstance, config: PoiLayerConfig = {}) {
    this.map = map;
    this.config = {
      sourceId: config.sourceId ?? DEFAULT_POI_LAYER_CONFIG.sourceId,
      circleLayerId: config.circleLayerId ?? DEFAULT_POI_LAYER_CONFIG.circleLayerId,
      symbolLayerId: config.symbolLayerId ?? DEFAULT_POI_LAYER_CONFIG.symbolLayerId,
      clusterLayerId: config.clusterLayerId ?? DEFAULT_POI_LAYER_CONFIG.clusterLayerId,
      clusterCountLayerId: config.clusterCountLayerId ?? DEFAULT_POI_LAYER_CONFIG.clusterCountLayerId,
      enableClustering: config.enableClustering ?? DEFAULT_POI_LAYER_CONFIG.enableClustering,
      clusterMaxZoom: config.clusterMaxZoom ?? DEFAULT_POI_LAYER_CONFIG.clusterMaxZoom,
      clusterRadius: config.clusterRadius ?? DEFAULT_POI_LAYER_CONFIG.clusterRadius,
    };

    this.ensureLayersInitialized();
  }

  /**
   * Initializes MapLibre GeoJSON source and default layers if style is loaded.
   */
  public ensureLayersInitialized(): void {
    if (this.initialized) {
      return;
    }

    if (!this.map.isStyleLoaded()) {
      this.map.once('load', () => this.ensureLayersInitialized());
      return;
    }

    const sourceId = this.config.sourceId;
    const circleLayerId = this.config.circleLayerId;
    const symbolLayerId = this.config.symbolLayerId;

    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: createEmptyFeatureCollection<PoiPointFeature['geometry'], PoiGeoJsonFeatureProperties>(),
      });
    }

    if (!this.map.getLayer(circleLayerId)) {
      this.map.addLayer({
        id: circleLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'markerColor'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        },
      });
    }

    if (!this.map.getLayer(symbolLayerId)) {
      this.map.addLayer({
        id: symbolLayerId,
        type: 'symbol',
        source: sourceId,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#212121',
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 1.5,
        },
      });
    }

    this.initialized = true;
  }

  /**
   * Sets POI data on the map using an RFC 7946 FeatureCollection.
   */
  public setPoiGeoJson(collection: PoiGeoJsonFeatureCollection): void {
    this.ensureLayersInitialized();
    const source = this.map.getSource(this.config.sourceId);
    if (source) {
      source.setData(collection);
    }
  }

  /**
   * Sets POI items directly, converting them with category styling and permissions.
   */
  public setPoiItems(pois: readonly PoiItem[], options: PoiToGeoJsonOptions = {}): void {
    const featureCollection = PoiGeoJsonConverter.toFeatureCollection(pois, options);
    this.setPoiGeoJson(featureCollection);
  }

  /**
   * PANIC/DRAIN: Completely clears all POI layers, markers, and popups.
   */
  public clearPoi(): void {
    // 1. Reset source to empty RFC 7946 FeatureCollection
    const source = this.map.getSource(this.config.sourceId);
    if (source) {
      source.setData(createEmptyFeatureCollection<PoiPointFeature['geometry'], PoiGeoJsonFeatureProperties>());
    }

    // 2. Remove all registered HTML markers
    for (const marker of this.markers) {
      try {
        marker.remove();
      } catch {
        // ignore errors during cleanup
      }
    }
    this.markers.clear();

    // 3. Remove all registered popups
    for (const popup of this.popups) {
      try {
        popup.remove();
      } catch {
        // ignore errors during cleanup
      }
    }
    this.popups.clear();
  }

  /**
   * SessionDrainHook implementation for Coordinator / AuthLockBooth.
   */
  public drain(_reason: string, _previousSession: unknown): void {
    this.clearPoi();
  }

  /**
   * Marker and popup registration for memory tracking and leak prevention
   */
  public registerMarker(marker: MapLibreMarker): () => void {
    this.markers.add(marker);
    return () => {
      marker.remove();
      this.markers.delete(marker);
    };
  }

  public registerPopup(popup: MapLibrePopup): () => void {
    this.popups.add(popup);
    return () => {
      popup.remove();
      this.popups.delete(popup);
    };
  }

  public getMarkerCount(): number {
    return this.markers.size;
  }

  public getPopupCount(): number {
    return this.popups.size;
  }

  /**
   * Destroys all layers and unregisters from map
   */
  public destroy(): void {
    this.clearPoi();

    if (this.map.getLayer(this.config.symbolLayerId)) {
      this.map.removeLayer(this.config.symbolLayerId);
    }
    if (this.map.getLayer(this.config.circleLayerId)) {
      this.map.removeLayer(this.config.circleLayerId);
    }
    if (this.map.getSource(this.config.sourceId)) {
      this.map.removeSource(this.config.sourceId);
    }
    this.initialized = false;
  }
}
