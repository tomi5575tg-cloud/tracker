import type { FeatureCollection, Feature, Geometry, Position } from '../geojson/types.js';
import { createEmptyFeatureCollection } from '../geojson/types.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreLayerSpecification,
  MapLibreLayerEvent,
  MapLibreMarker,
  MapLibrePopup,
  MapLibreAdapterOptions,
  AdapterLayerConfig,
  FitBoundsOptions,
} from './types.js';
import type { SessionDrainHook } from '../auth/drainManager.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';

export interface FeatureEventHandler<G extends Geometry = Geometry, P = Record<string, unknown>> {
  (feature: Feature<G, P>, event: MapLibreLayerEvent<Feature<G, P>>): void;
}

export interface FeatureHoverHandler<G extends Geometry = Geometry, P = Record<string, unknown>> {
  (feature: Feature<G, P> | null, event: MapLibreLayerEvent<Feature<G, P>>): void;
}

export class MapLibreGeoJsonAdapter<G extends Geometry = Geometry, P = Record<string, unknown>>
  implements SessionDrainHook
{
  private readonly map: MapLibreMapInstance;
  private readonly options: MapLibreAdapterOptions;
  private readonly registeredLayers: Map<string, AdapterLayerConfig> = new Map();
  private readonly markers = new Set<MapLibreMarker>();
  private readonly popups = new Set<MapLibrePopup>();
  private readonly cleanupCallbacks: Array<() => void> = [];

  private currentData: FeatureCollection<G, P>;
  private isInitialized = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingData: FeatureCollection<G, P> | null = null;
  private activeHoveredFeatureId: string | number | null = null;
  private activeSelectedFeatureId: string | number | null = null;

  constructor(map: MapLibreMapInstance, options: MapLibreAdapterOptions) {
    this.map = map;
    this.options = {
      debounceMs: 0,
      changeCursorOnHover: true,
      hoverCursor: 'pointer',
      autoFitBounds: false,
      ...options,
    };

    this.currentData = createEmptyFeatureCollection<G, P>();

    if (options.layers) {
      for (const layer of options.layers) {
        this.registeredLayers.set(layer.id, layer);
      }
    }

    this.setupLifecycle();
  }

  /**
   * Initializes source and registered layers on the map.
   */
  public ensureInitialized(): void {
    if (this.isInitialized) {
      return;
    }

    if (!this.map.isStyleLoaded()) {
      this.map.once('load', () => this.ensureInitialized());
      return;
    }

    // 1. Add GeoJSON Source
    const sourceId = this.options.sourceId;
    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: this.currentData,
        ...(this.options.sourceOptions ?? {}),
      });
    }

    // 2. Add Registered Layers
    for (const layerConfig of this.registeredLayers.values()) {
      if (!this.map.getLayer(layerConfig.id)) {
        const spec: MapLibreLayerSpecification = {
          id: layerConfig.id,
          type: layerConfig.type,
          source: sourceId,
          ...(layerConfig.minzoom !== undefined ? { minzoom: layerConfig.minzoom } : {}),
          ...(layerConfig.maxzoom !== undefined ? { maxzoom: layerConfig.maxzoom } : {}),
          ...(layerConfig.filter !== undefined ? { filter: layerConfig.filter } : {}),
          ...(layerConfig.layout !== undefined ? { layout: layerConfig.layout } : {}),
          ...(layerConfig.paint !== undefined ? { paint: layerConfig.paint } : {}),
        };
        this.map.addLayer(spec, layerConfig.beforeId);
      }
    }

    this.isInitialized = true;
  }

  /**
   * Adds or registers a new layer configuration to this adapter.
   */
  public addLayer(layerConfig: AdapterLayerConfig): this {
    this.registeredLayers.set(layerConfig.id, layerConfig);

    if (this.isInitialized && this.map.isStyleLoaded() && !this.map.getLayer(layerConfig.id)) {
      const spec: MapLibreLayerSpecification = {
        id: layerConfig.id,
        type: layerConfig.type,
        source: this.options.sourceId,
        ...(layerConfig.minzoom !== undefined ? { minzoom: layerConfig.minzoom } : {}),
        ...(layerConfig.maxzoom !== undefined ? { maxzoom: layerConfig.maxzoom } : {}),
        ...(layerConfig.filter !== undefined ? { filter: layerConfig.filter } : {}),
        ...(layerConfig.layout !== undefined ? { layout: layerConfig.layout } : {}),
        ...(layerConfig.paint !== undefined ? { paint: layerConfig.paint } : {}),
      };
      this.map.addLayer(spec, layerConfig.beforeId);
    }

    return this;
  }

  /**
   * Removes a layer from the adapter and map.
   */
  public removeLayer(layerId: string): this {
    this.registeredLayers.delete(layerId);
    if (this.map.getLayer(layerId)) {
      this.map.removeLayer(layerId);
    }
    return this;
  }

  /**
   * Sets GeoJSON data immediately.
   */
  public setData(data: FeatureCollection<G, P>): void {
    this.currentData = data;
    this.ensureInitialized();

    const source = this.map.getSource(this.options.sourceId);
    if (source) {
      source.setData(data);
    }

    if (this.options.autoFitBounds && data.features && data.features.length > 0) {
      this.fitToData(this.options.fitBoundsOptions);
    }
  }

  /**
   * Updates GeoJSON data with debouncing (useful for rapid telemetry streaming).
   */
  public setDataDebounced(data: FeatureCollection<G, P>, delayMs?: number): void {
    const delay = delayMs ?? this.options.debounceMs ?? 16;
    if (delay <= 0) {
      this.setData(data);
      return;
    }

    this.pendingData = data;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      if (this.pendingData) {
        this.setData(this.pendingData);
        this.pendingData = null;
      }
      this.debounceTimer = null;
    }, delay);
  }

  /**
   * Flushes any pending debounced updates immediately.
   */
  public flushPendingUpdates(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingData) {
      this.setData(this.pendingData);
      this.pendingData = null;
    }
  }

  /**
   * Returns current active dataset
   */
  public getData(): FeatureCollection<G, P> {
    return this.currentData;
  }

  /**
   * Gets the underlying MapLibre GeoJSON source instance
   */
  public getSource(): MapLibreGeoJsonSource | undefined {
    return this.map.getSource(this.options.sourceId);
  }

  /**
   * Updates feature state for interactive styling
   */
  public setFeatureState(featureId: string | number, state: Record<string, unknown>): void {
    if (this.map.setFeatureState) {
      this.map.setFeatureState(
        {
          source: this.options.sourceId,
          id: featureId,
        },
        state
      );
    }
  }

  /**
   * Clears feature state for a specific feature or all features
   */
  public removeFeatureState(featureId?: string | number, key?: string): void {
    if (this.map.removeFeatureState) {
      if (featureId !== undefined) {
        this.map.removeFeatureState(
          {
            source: this.options.sourceId,
            id: featureId,
          },
          key
        );
      } else {
        this.map.removeFeatureState(
          {
            source: this.options.sourceId,
            id: '',
          },
          key
        );
      }
    }
  }

  /**
   * Sets hovered feature state and handles cursor
   */
  public setHoveredFeature(featureId: string | number | null): void {
    if (this.activeHoveredFeatureId !== null && this.activeHoveredFeatureId !== featureId) {
      this.setFeatureState(this.activeHoveredFeatureId, { hover: false });
    }

    if (featureId !== null) {
      this.setFeatureState(featureId, { hover: true });
    }

    this.activeHoveredFeatureId = featureId;
  }

  /**
   * Sets selected feature state
   */
  public setSelectedFeature(featureId: string | number | null): void {
    if (this.activeSelectedFeatureId !== null && this.activeSelectedFeatureId !== featureId) {
      this.setFeatureState(this.activeSelectedFeatureId, { selected: false });
    }

    if (featureId !== null) {
      this.setFeatureState(featureId, { selected: true });
    }

    this.activeSelectedFeatureId = featureId;
  }

  /**
   * Registers click event handler on a specific layer
   */
  public onFeatureClick(layerId: string, handler: FeatureEventHandler<G, P>): () => void {
    const listener = (e: MapLibreLayerEvent<any>) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0] as Feature<G, P>;
        handler(feature, e);
      }
    };

    this.map.on('click', layerId, listener);

    const unregister = () => {
      this.map.off('click', layerId, listener);
    };

    this.cleanupCallbacks.push(unregister);
    return unregister;
  }

  /**
   * Registers hover (mouseenter & mouseleave) handlers with automatic cursor and state handling
   */
  public onFeatureHover(layerId: string, handler: FeatureHoverHandler<G, P>): () => void {
    const onEnter = (e: MapLibreLayerEvent<any>) => {
      if (this.options.changeCursorOnHover) {
        this.setCursor(this.options.hoverCursor ?? 'pointer');
      }

      if (e.features && e.features.length > 0) {
        const feature = e.features[0] as Feature<G, P>;
        if (feature.id !== undefined) {
          this.setHoveredFeature(feature.id);
        }
        handler(feature, e);
      }
    };

    const onLeave = (e: MapLibreLayerEvent<any>) => {
      if (this.options.changeCursorOnHover) {
        this.setCursor('');
      }

      this.setHoveredFeature(null);
      handler(null, e);
    };

    this.map.on('mouseenter', layerId, onEnter);
    this.map.on('mouseleave', layerId, onLeave);

    const unregister = () => {
      this.map.off('mouseenter', layerId, onEnter);
      this.map.off('mouseleave', layerId, onLeave);
    };

    this.cleanupCallbacks.push(unregister);
    return unregister;
  }

  /**
   * Computes geographic bounding box for the current data
   */
  public getBounds(): [[number, number], [number, number]] | null {
    const coordinates: Position[] = [];

    const extractCoords = (geom: Geometry | null) => {
      if (!geom) return;
      if (geom.type === 'Point') {
        coordinates.push(geom.coordinates);
      } else if (geom.type === 'MultiPoint' || geom.type === 'LineString') {
        coordinates.push(...geom.coordinates);
      } else if (geom.type === 'MultiLineString' || geom.type === 'Polygon') {
        for (const ring of geom.coordinates) {
          coordinates.push(...ring);
        }
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          for (const ring of poly) {
            coordinates.push(...ring);
          }
        }
      }
    };

    for (const feat of this.currentData.features) {
      extractCoords(feat.geometry);
    }

    if (coordinates.length === 0) {
      return null;
    }

    const bbox = GeoSpatialUtils.bboxFromCoordinates(coordinates);
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ];
  }

  /**
   * Positions map camera to encompass all current features
   */
  public fitToData(options?: FitBoundsOptions): void {
    const bounds = this.getBounds();
    if (bounds && this.map.fitBounds) {
      this.map.fitBounds(bounds, {
        padding: 40,
        maxZoom: 16,
        ...options,
      });
    }
  }

  /**
   * Registers a MapLibre Marker for memory management and cleanup
   */
  public registerMarker(marker: MapLibreMarker): () => void {
    this.markers.add(marker);
    return () => {
      marker.remove();
      this.markers.delete(marker);
    };
  }

  /**
   * Registers a MapLibre Popup for memory management and cleanup
   */
  public registerPopup(popup: MapLibrePopup): () => void {
    this.popups.add(popup);
    return () => {
      popup.remove();
      this.popups.delete(popup);
    };
  }

  /**
   * PANIC/DRAIN: Clears GeoJSON data to empty RFC 7946 FeatureCollection,
   * removes all feature states, markers, and popups.
   */
  public clear(): void {
    this.flushPendingUpdates();
    this.setData(createEmptyFeatureCollection<G, P>());

    if (this.activeHoveredFeatureId !== null || this.activeSelectedFeatureId !== null) {
      this.removeFeatureState();
      this.activeHoveredFeatureId = null;
      this.activeSelectedFeatureId = null;
    }

    for (const marker of this.markers) {
      try {
        marker.remove();
      } catch {
        // ignore errors during cleanup
      }
    }
    this.markers.clear();

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
   * SessionDrainHook implementation for AuthLockBooth / Coordinator
   */
  public drain(_reason: string, _previousSession: unknown): void {
    this.clear();
  }

  /**
   * Completely destroys adapter, unregisters event listeners and removes layers/source
   */
  public destroy(): void {
    this.clear();

    for (const unregister of this.cleanupCallbacks) {
      unregister();
    }
    this.cleanupCallbacks.length = 0;

    for (const layerId of this.registeredLayers.keys()) {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    }

    if (this.map.getSource(this.options.sourceId)) {
      this.map.removeSource(this.options.sourceId);
    }

    this.isInitialized = false;
  }

  private setupLifecycle(): void {
    this.ensureInitialized();

    // Re-initialize on style load (e.g. when changing map style / theme)
    this.map.on('style.load', () => {
      this.isInitialized = false;
      this.ensureInitialized();
      if (this.currentData.features.length > 0) {
        this.setData(this.currentData);
      }
    });
  }

  private setCursor(cursor: string): void {
    const canvas = this.map.getCanvas?.();
    if (canvas && typeof canvas === 'object' && 'style' in canvas) {
      (canvas as { style: { cursor: string } }).style.cursor = cursor;
    }
  }
}
