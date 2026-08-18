import { RouteGeoJsonConverter } from '../geojson/converter.js';
import type { RouteData } from '../types.js';
import type {
  MapLibreMapInstance,
  MapLibreMarker,
  MapLibrePopup,
  MapLibreLayerSpecification,
} from './types.js';

export interface MapRouteLayerConfig {
  readonly routeSourceId: string;
  readonly waypointsSourceId: string;
  readonly routeLineLayerId: string;
  readonly routeLineCasingLayerId?: string | undefined;
  readonly waypointsSymbolLayerId?: string | undefined;
  readonly waypointsCircleLayerId?: string | undefined;
}

export const DEFAULT_ROUTE_LAYER_CONFIG: MapRouteLayerConfig = {
  routeSourceId: 'tracker-route-source',
  waypointsSourceId: 'tracker-waypoints-source',
  routeLineLayerId: 'tracker-route-line-layer',
  routeLineCasingLayerId: 'tracker-route-line-casing-layer',
  waypointsCircleLayerId: 'tracker-waypoints-circle-layer',
  waypointsSymbolLayerId: 'tracker-waypoints-symbol-layer',
};

export class MapLibreRouteManager {
  private readonly map: MapLibreMapInstance;
  private readonly config: MapRouteLayerConfig;
  private markers: MapLibreMarker[] = [];
  private popups: MapLibrePopup[] = [];
  private currentRoute: RouteData | null = null;

  constructor(map: MapLibreMapInstance, config: Partial<MapRouteLayerConfig> = {}) {
    this.map = map;
    this.config = { ...DEFAULT_ROUTE_LAYER_CONFIG, ...config };
  }

  public getConfig(): MapRouteLayerConfig {
    return this.config;
  }

  public getCurrentRoute(): RouteData | null {
    return this.currentRoute;
  }

  /**
   * Initializes or ensures sources and layers exist on the MapLibre map.
   * If style is still loading, schedules initialization once loaded.
   */
  public ensureLayers(): void {
    if (!this.map.isStyleLoaded()) {
      this.map.once('load', () => this.ensureLayers());
      return;
    }

    const emptyData = RouteGeoJsonConverter.emptyGeoJson();

    // 1. Route Source
    if (!this.map.getSource(this.config.routeSourceId)) {
      this.map.addSource(this.config.routeSourceId, {
        type: 'geojson',
        data: emptyData.routeCollection,
      });
    }

    // 2. Waypoints Source
    if (!this.map.getSource(this.config.waypointsSourceId)) {
      this.map.addSource(this.config.waypointsSourceId, {
        type: 'geojson',
        data: emptyData.waypointCollection,
      });
    }

    // 3. Route Line Casing Layer (optional outline)
    if (this.config.routeLineCasingLayerId && !this.map.getLayer(this.config.routeLineCasingLayerId)) {
      const casingLayer: MapLibreLayerSpecification = {
        id: this.config.routeLineCasingLayerId,
        type: 'line',
        source: this.config.routeSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 8,
          'line-opacity': 0.8,
        },
      };
      this.map.addLayer(casingLayer);
    }

    // 4. Route Line Layer
    if (!this.map.getLayer(this.config.routeLineLayerId)) {
      const lineLayer: MapLibreLayerSpecification = {
        id: this.config.routeLineLayerId,
        type: 'line',
        source: this.config.routeSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#0066FF',
          'line-width': 5,
          'line-opacity': 0.9,
        },
      };
      this.map.addLayer(lineLayer);
    }

    // 5. Waypoints Circle Layer
    if (this.config.waypointsCircleLayerId && !this.map.getLayer(this.config.waypointsCircleLayerId)) {
      const circleLayer: MapLibreLayerSpecification = {
        id: this.config.waypointsCircleLayerId,
        type: 'circle',
        source: this.config.waypointsSourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': '#FF3300',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        },
      };
      this.map.addLayer(circleLayer);
    }
  }

  /**
   * Sets route data on map by converting to RFC 7946 GeoJSON and calling setData on sources.
   */
  public setRoute(route: RouteData): void {
    this.currentRoute = route;
    this.ensureLayers();

    const geojson = RouteGeoJsonConverter.toGeoJson(route);

    const routeSource = this.map.getSource(this.config.routeSourceId);
    if (routeSource) {
      routeSource.setData(geojson.routeCollection);
    }

    const waypointsSource = this.map.getSource(this.config.waypointsSourceId);
    if (waypointsSource) {
      waypointsSource.setData(geojson.waypointCollection);
    }
  }

  /**
   * Register custom HTML Marker or Popup to track for clean drainage
   */
  public registerMarker(marker: MapLibreMarker): void {
    this.markers.push(marker);
  }

  public registerPopup(popup: MapLibrePopup): void {
    this.popups.push(popup);
  }

  /**
   * DRENAŻ WIDOKU MAPY (clearRoute):
   * 1. Zresetowanie danych GeoJSON w źródłach MapLibre do pustych FeatureCollection RFC 7946
   * 2. Usunięcie wszystkich aktywnych Popupów i Markerów ze sceny mapy
   * 3. Wyczyszczenie wewnętrznego stanu pamięci (currentRoute, references)
   */
  public clearRoute(): void {
    const emptyGeoJson = RouteGeoJsonConverter.emptyGeoJson();

    // 1. Reset route line source to empty RFC 7946 FeatureCollection
    const routeSource = this.map.getSource(this.config.routeSourceId);
    if (routeSource) {
      routeSource.setData(emptyGeoJson.routeCollection);
    }

    // 2. Reset waypoints source to empty RFC 7946 FeatureCollection
    const waypointsSource = this.map.getSource(this.config.waypointsSourceId);
    if (waypointsSource) {
      waypointsSource.setData(emptyGeoJson.waypointCollection);
    }

    // 3. Remove and destroy all registered Markers
    for (const marker of this.markers) {
      try {
        marker.remove();
      } catch {
        // Safe disposal
      }
    }
    this.markers = [];

    // 4. Remove and destroy all registered Popups
    for (const popup of this.popups) {
      try {
        popup.remove();
      } catch {
        // Safe disposal
      }
    }
    this.popups = [];

    // 5. Clear stored route state
    this.currentRoute = null;
  }

  /**
   * Complete destruction of layers and sources (for component unmount or map re-initialization)
   */
  public destroy(): void {
    this.clearRoute();

    const layersToRemove = [
      this.config.waypointsSymbolLayerId,
      this.config.waypointsCircleLayerId,
      this.config.routeLineLayerId,
      this.config.routeLineCasingLayerId,
    ].filter((id): id is string => typeof id === 'string');

    for (const layerId of layersToRemove) {
      if (this.map.getLayer(layerId)) {
        try {
          this.map.removeLayer(layerId);
        } catch {
          // ignore
        }
      }
    }

    const sourcesToRemove = [this.config.waypointsSourceId, this.config.routeSourceId];
    for (const sourceId of sourcesToRemove) {
      if (this.map.getSource(sourceId)) {
        try {
          this.map.removeSource(sourceId);
        } catch {
          // ignore
        }
      }
    }
  }
}
