import type { FeatureCollection } from '../geojson/types.js';

/**
 * Interface compatible with MapLibre GL JS GeoJSONSource
 */
export interface MapLibreGeoJsonSource {
  setData(data: FeatureCollection | string): MapLibreGeoJsonSource | void;
}

/**
 * Interface compatible with MapLibre GL JS Layer specification
 */
export interface MapLibreLayerSpecification {
  id: string;
  type: 'line' | 'symbol' | 'circle' | 'fill' | string;
  source: string;
  layout?: Record<string, unknown> | undefined;
  paint?: Record<string, unknown> | undefined;
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
 * Abstraction of the MapLibre GL JS Map instance
 */
export interface MapLibreMapInstance {
  getSource(id: string): MapLibreGeoJsonSource | undefined;
  addSource(id: string, source: { type: 'geojson'; data: FeatureCollection | string }): void;
  removeSource(id: string): void;
  getLayer(id: string): unknown | undefined;
  addLayer(layer: MapLibreLayerSpecification, beforeId?: string): void;
  removeLayer(id: string): void;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  isStyleLoaded(): boolean;
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}
