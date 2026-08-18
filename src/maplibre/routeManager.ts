import { RouteGeoJsonConverter } from '../geojson/converter.js';
import type { RouteData } from '../types.js';
import type {
  MapLibreMapInstance,
  MapLibreMarker,
  MapLibrePopup,
  MapLibreLayerSpecification,
  CameraOptions,
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

export interface ClearRouteOptions {
  /**
   * Whether to reset camera view to default position/zoom upon clearing
   */
  readonly resetCamera?: boolean | undefined;
  /**
   * Default camera position for reset
   */
  readonly defaultCamera?: CameraOptions | undefined;
  /**
   * Whether to stop any ongoing map animations/transitions
   */
  readonly stopAnimations?: boolean | undefined;
}

export class MapLibreRouteManager {
  private readonly map: MapLibreMapInstance;
  private readonly config: MapRouteLayerConfig;
  private readonly defaultCamera: CameraOptions;
  private markers: MapLibreMarker[] = [];
  private popups: MapLibrePopup[] = [];
  private currentRoute: RouteData | null = null;

  constructor(
    map: MapLibreMapInstance,
    config: Partial<MapRouteLayerConfig> = {},
    defaultCamera: CameraOptions = { center: [0, 0], zoom: 1 }
  ) {
    this.map = map;
    this.config = { ...DEFAULT_ROUTE_LAYER_CONFIG, ...config };
    this.defaultCamera = defaultCamera;
  }

  public getConfig(): MapRouteLayerConfig {
    return this.config;
  }

  public getCurrentRoute(): RouteData | null {
    return this.currentRoute;
  }

  /**
   * Returns list of currently tracked active markers
   */
  public getRegisteredMarkers(): readonly MapLibreMarker[] {
    return this.markers;
  }

  /**
   * Returns list of currently tracked active popups
   */
  public getRegisteredPopups(): readonly MapLibrePopup[] {
    return this.popups;
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
   * Register custom HTML Marker to track for clean drainage
   */
  public registerMarker(marker: MapLibreMarker): void {
    this.markers.push(marker);
  }

  /**
   * Unregister a marker manually if removed before drainage
   */
  public unregisterMarker(marker: MapLibreMarker): void {
    const idx = this.markers.indexOf(marker);
    if (idx !== -1) {
      this.markers.splice(idx, 1);
    }
  }

  /**
   * Register custom HTML Popup to track for clean drainage
   */
  public registerPopup(popup: MapLibrePopup): void {
    this.popups.push(popup);
  }

  /**
   * Unregister a popup manually if closed before drainage
   */
  public unregisterPopup(popup: MapLibrePopup): void {
    const idx = this.popups.indexOf(popup);
    if (idx !== -1) {
      this.popups.splice(idx, 1);
    }
  }

  /**
   * PANERNY DRENAŻ WIDOKU MAPY (clearRoute & Reset Mapy):
   * 
   * 1. Zatrzymanie wszelkich trwających animacji kamery (stop())
   * 2. Zresetowanie danych GeoJSON w źródłach MapLibre do pustych FeatureCollection RFC 7946
   * 3. Usunięcie i zniszczenie wszystkich aktywnych Markerów HTML
   * 4. Usunięcie i zniszczenie wszystkich aktywnych Popupów
   * 5. Opcjonalny reset pozycji kamery (jumpTo domyślnego widoku)
   * 6. Całkowite wyczyszczenie wewnętrznego stanu pamięci (currentRoute, tablice referencji)
   */
  public clearRoute(options: ClearRouteOptions = {}): void {
    const { resetCamera = false, defaultCamera, stopAnimations = true } = options;

    // 1. Stop any ongoing flyTo/easeTo camera transitions
    if (stopAnimations && typeof this.map.stop === 'function') {
      try {
        this.map.stop();
      } catch {
        // Safe disposal
      }
    }

    // 2. Reset GeoJSON sources to RFC 7946 empty collections
    const emptyGeoJson = RouteGeoJsonConverter.emptyGeoJson();

    const routeSource = this.map.getSource(this.config.routeSourceId);
    if (routeSource) {
      routeSource.setData(emptyGeoJson.routeCollection);
    }

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

    // 5. Reset camera position if requested
    if (resetCamera && typeof this.map.jumpTo === 'function') {
      try {
        this.map.jumpTo(defaultCamera ?? this.defaultCamera);
      } catch {
        // Safe disposal
      }
    }

    // 6. Clear stored route state
    this.currentRoute = null;
  }

  /**
   * Complete destruction of layers, sources and tracked elements (for unmounting)
   */
  public destroy(): void {
    this.clearRoute({ resetCamera: false, stopAnimations: true });

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
