import type { FeatureCollection, Feature, Geometry } from '../geojson/types.js';

export interface CameraOptions {
  center?: [number, number] | undefined;
  zoom?: number | undefined;
  bearing?: number | undefined;
  pitch?: number | undefined;
  padding?: number | { top: number; bottom: number; left: number; right: number } | undefined;
}

export interface FitBoundsOptions {
  padding?: number | { top: number; bottom: number; left: number; right: number } | undefined;
  linear?: boolean | undefined;
  duration?: number | undefined;
  maxZoom?: number | undefined;
}

export interface GeoJsonSourceSpecification {
  type: 'geojson';
  data: FeatureCollection<any, any> | string;
  cluster?: boolean | undefined;
  clusterMaxZoom?: number | undefined;
  clusterRadius?: number | undefined;
  clusterProperties?: Record<string, unknown> | undefined;
  lineMetrics?: boolean | undefined;
  promoteId?: string | undefined;
  generateId?: boolean | undefined;
  tolerance?: number | undefined;
  buffer?: number | undefined;
  maxzoom?: number | undefined;
}

/**
 * Interface compatible with MapLibre GL JS GeoJSONSource
 */
export interface MapLibreGeoJsonSource {
  setData(data: FeatureCollection<any, any> | string): MapLibreGeoJsonSource | void;
  getClusterExpansionZoom?(clusterId: number, callback: (error: Error | null, zoom: number) => void): void;
  getClusterChildren?(clusterId: number, callback: (error: Error | null, features: Feature[]) => void): void;
  getClusterLeaves?(clusterId: number, limit: number, offset: number, callback: (error: Error | null, features: Feature[]) => void): void;
}

/**
 * Interface compatible with MapLibre GL JS Layer specification
 */
export interface MapLibreLayerSpecification {
  id: string;
  type: 'line' | 'symbol' | 'circle' | 'fill' | 'fill-extrusion' | 'heatmap' | 'raster' | string;
  source: string;
  sourceLayer?: string | undefined;
  minzoom?: number | undefined;
  maxzoom?: number | undefined;
  filter?: unknown[] | undefined;
  layout?: Record<string, unknown> | undefined;
  paint?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export interface MapLibreFeatureStateFeature {
  source: string;
  id: string | number;
  sourceLayer?: string | undefined;
}

export interface MapLibreLayerEvent<F = Feature<Geometry, Record<string, unknown>>> {
  point?: { x: number; y: number } | undefined;
  lngLat?: { lng: number; lat: number } | undefined;
  features?: F[] | undefined;
  originalEvent?: Event | undefined;
  defaultPrevented?: boolean | undefined;
  [key: string]: unknown;
}

/**
 * Interface compatible with MapLibre GL JS Marker
 */
export interface MapLibreMarker {
  remove(): void;
  setLngLat(lnglat: [number, number]): this;
  addTo(map: MapLibreMapInstance): this;
  getElement(): HTMLElement;
}

/**
 * Interface compatible with MapLibre GL JS Popup
 */
export interface MapLibrePopup {
  remove(): void;
  isOpen(): boolean;
  setLngLat(lnglat: [number, number]): this;
  setHTML(html: string): this;
  setText(text: string): this;
  addTo(map: MapLibreMapInstance): this;
}

/**
 * MapLibre 3D Light Specification
 * https://maplibre.org/maplibre-style-spec/light/
 */
export interface MapLibreLightSpecification {
  anchor?: 'map' | 'viewport' | undefined;
  color?: string | undefined;
  intensity?: number | undefined;
  position?: [radial: number, azimuthal: number, polar: number] | undefined;
  'color-transition'?: { duration?: number; delay?: number } | undefined;
  'intensity-transition'?: { duration?: number; delay?: number } | undefined;
  'position-transition'?: { duration?: number; delay?: number } | undefined;
}

/**
 * Abstraction of the MapLibre GL JS Map instance
 */
export interface MapLibreMapInstance {
  getSource(id: string): MapLibreGeoJsonSource | undefined;
  addSource(id: string, source: GeoJsonSourceSpecification | { type: 'geojson'; data: FeatureCollection<any, any> | string }): void;
  removeSource(id: string): void;
  getLayer(id: string): unknown | undefined;
  addLayer(layer: MapLibreLayerSpecification, beforeId?: string): void;
  removeLayer(id: string): void;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  setFilter?(layerId: string, filter: unknown[] | null | undefined): void;
  getFilter?(layerId: string): unknown[] | undefined;
  setLight?(light: MapLibreLightSpecification): void;
  getLight?(): MapLibreLightSpecification | undefined;
  isStyleLoaded(): boolean;
  jumpTo?(options: CameraOptions): void;
  easeTo?(options: CameraOptions & { duration?: number }): void;
  flyTo?(options: CameraOptions & { duration?: number }): void;
  fitBounds?(bounds: [[number, number], [number, number]] | [number, number, number, number], options?: FitBoundsOptions): void;
  stop?(): void;
  setFeatureState?(feature: MapLibreFeatureStateFeature, state: Record<string, unknown>): void;
  getFeatureState?(feature: MapLibreFeatureStateFeature): Record<string, unknown> | undefined;
  removeFeatureState?(feature: MapLibreFeatureStateFeature, key?: string): void;
  getCanvas?(): { style: { cursor: string } } | HTMLCanvasElement;
  getContainer?(): HTMLElement;
  setStyle?(style: string | Record<string, unknown>, options?: { diff?: boolean }): void;
  getStyle?(): Record<string, unknown> | string | undefined;
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, layerId: string, listener: (e: MapLibreLayerEvent<any>) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, layerId: string, listener: (e: MapLibreLayerEvent<any>) => void): void;
}

/**
 * Adapter Configuration Definitions
 */
export interface AdapterLayerConfig {
  readonly id: string;
  readonly type: 'line' | 'symbol' | 'circle' | 'fill' | 'heatmap' | 'fill-extrusion' | string;
  readonly beforeId?: string | undefined;
  readonly minzoom?: number | undefined;
  readonly maxzoom?: number | undefined;
  readonly filter?: unknown[] | undefined;
  readonly layout?: Record<string, unknown> | undefined;
  readonly paint?: Record<string, unknown> | undefined;
}

export interface MapLibreAdapterOptions {
  readonly sourceId: string;
  readonly sourceOptions?: Omit<GeoJsonSourceSpecification, 'type' | 'data'> | undefined;
  readonly layers?: readonly AdapterLayerConfig[] | undefined;
  readonly debounceMs?: number | undefined;
  readonly changeCursorOnHover?: boolean | undefined;
  readonly hoverCursor?: string | undefined;
  readonly autoFitBounds?: boolean | undefined;
  readonly fitBoundsOptions?: FitBoundsOptions | undefined;
  readonly onItemSelect?: ((feature: Feature<Geometry, Record<string, unknown>> | null, event?: MapLibreLayerEvent<any>) => void) | undefined;
}

export interface MapLibreItemSelectionOptions {
  readonly centerCamera?: boolean | undefined;
  readonly zoom?: number | undefined;
  readonly showPopup?: boolean | undefined;
  readonly popupHtml?: string | undefined;
  readonly easeDurationMs?: number | undefined;
  readonly updateFeatureState?: boolean | undefined;
}

