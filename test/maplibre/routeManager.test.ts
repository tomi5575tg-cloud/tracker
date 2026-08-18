import { describe, it, expect, vi } from 'vitest';
import { MapLibreRouteManager } from '../../src/maplibre/routeManager.js';
import type {
  MapLibreMapInstance,
  MapLibreGeoJsonSource,
  MapLibreMarker,
  MapLibrePopup,
  MapLibreLayerSpecification,
  CameraOptions,
} from '../../src/maplibre/types.js';
import type { RouteData } from '../../src/types.js';
import type { FeatureCollection } from '../../src/geojson/types.js';

class MockMapLibreMap implements MapLibreMapInstance {
  private styleLoaded = true;
  private sources = new Map<string, { type: 'geojson'; data: FeatureCollection | string }>();
  private layers = new Map<string, MapLibreLayerSpecification>();

  public stopped = false;
  public cameraState: CameraOptions = { center: [0, 0], zoom: 1 };

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
  public once(_event: string, listener: (...args: unknown[]) => void): void {
    if (this.styleLoaded) listener();
  }
  public on(): void {}
  public off(): void {}

  public stop(): void {
    this.stopped = true;
  }

  public jumpTo(options: CameraOptions): void {
    this.cameraState = { ...this.cameraState, ...options };
  }
}

describe('MapLibreRouteManager & clearRoute (Pancerny Drenaz i Reset Mapy)', () => {
  it('should initialize layers and render route onto MapLibre sources', () => {
    const mockMap = new MockMapLibreMap();
    const routeManager = new MapLibreRouteManager(mockMap);

    const sampleRoute: RouteData = {
      routeId: 'route-test-1',
      userId: 'user-test',
      distanceMeters: 1200,
      durationSeconds: 300,
      createdAt: 1700000000000,
      updatedAt: 1700000300000,
      waypoints: [
        { id: 'wp-1', coordinate: [21.0, 52.0], timestamp: 1700000000000 },
        { id: 'wp-2', coordinate: [21.1, 52.1], timestamp: 1700000300000 },
      ],
    };

    routeManager.setRoute(sampleRoute);

    expect(routeManager.getCurrentRoute()?.routeId).toBe('route-test-1');

    const routeSourceData = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    const waypointsSourceData = mockMap.getSourceData('tracker-waypoints-source') as FeatureCollection;

    expect(routeSourceData).toBeDefined();
    expect(routeSourceData.type).toBe('FeatureCollection');
    expect(routeSourceData.features).toHaveLength(1);
    expect(routeSourceData.features[0]!.geometry.type).toBe('LineString');

    expect(waypointsSourceData).toBeDefined();
    expect(waypointsSourceData.type).toBe('FeatureCollection');
    expect(waypointsSourceData.features).toHaveLength(2);
  });

  it('should completely purge GeoJSON data, markers, and popups on clearRoute', () => {
    const mockMap = new MockMapLibreMap();
    const routeManager = new MapLibreRouteManager(mockMap);

    const sampleRoute: RouteData = {
      routeId: 'route-test-2',
      userId: 'user-test',
      distanceMeters: 500,
      durationSeconds: 120,
      createdAt: 1700000000000,
      updatedAt: 1700000120000,
      waypoints: [{ id: 'wp-1', coordinate: [21.0, 52.0], timestamp: 1700000000000 }],
    };

    routeManager.setRoute(sampleRoute);

    // Register mock marker and popup
    const removeMarker = vi.fn();
    const mockMarker = { remove: removeMarker } as unknown as MapLibreMarker;
    routeManager.registerMarker(mockMarker);

    const removePopup = vi.fn();
    const mockPopup = { remove: removePopup } as unknown as MapLibrePopup;
    routeManager.registerPopup(mockPopup);

    expect(routeManager.getRegisteredMarkers()).toHaveLength(1);
    expect(routeManager.getRegisteredPopups()).toHaveLength(1);

    // Trigger clearRoute
    routeManager.clearRoute();

    // Verify route state cleared
    expect(routeManager.getCurrentRoute()).toBeNull();
    expect(routeManager.getRegisteredMarkers()).toHaveLength(0);
    expect(routeManager.getRegisteredPopups()).toHaveLength(0);

    // Verify GeoJSON sources reset to empty RFC 7946 collections
    const routeSourceData = mockMap.getSourceData('tracker-route-source') as FeatureCollection;
    const waypointsSourceData = mockMap.getSourceData('tracker-waypoints-source') as FeatureCollection;

    expect(routeSourceData.type).toBe('FeatureCollection');
    expect(routeSourceData.features).toEqual([]);

    expect(waypointsSourceData.type).toBe('FeatureCollection');
    expect(waypointsSourceData.features).toEqual([]);

    // Verify Markers and Popups were destroyed
    expect(removeMarker).toHaveBeenCalledTimes(1);
    expect(removePopup).toHaveBeenCalledTimes(1);
  });

  it('should stop active camera animations and reset camera view if resetCamera option is enabled', () => {
    const mockMap = new MockMapLibreMap();
    const defaultCam: CameraOptions = { center: [19.0, 52.0], zoom: 6 };
    const routeManager = new MapLibreRouteManager(mockMap, {}, defaultCam);

    // Set camera to some route focus
    mockMap.cameraState = { center: [21.0, 52.2], zoom: 16 };

    routeManager.clearRoute({ resetCamera: true, stopAnimations: true });

    expect(mockMap.stopped).toBe(true);
    expect(mockMap.cameraState.center).toEqual([19.0, 52.0]);
    expect(mockMap.cameraState.zoom).toBe(6);
  });

  it('should handle unregisterMarker and unregisterPopup gracefully', () => {
    const mockMap = new MockMapLibreMap();
    const routeManager = new MapLibreRouteManager(mockMap);

    const marker = { remove: vi.fn() } as unknown as MapLibreMarker;
    const popup = { remove: vi.fn() } as unknown as MapLibrePopup;

    routeManager.registerMarker(marker);
    routeManager.registerPopup(popup);

    expect(routeManager.getRegisteredMarkers()).toHaveLength(1);
    expect(routeManager.getRegisteredPopups()).toHaveLength(1);

    routeManager.unregisterMarker(marker);
    routeManager.unregisterPopup(popup);

    expect(routeManager.getRegisteredMarkers()).toHaveLength(0);
    expect(routeManager.getRegisteredPopups()).toHaveLength(0);
  });

  it('should safely destroy all map layers and sources upon destroy()', () => {
    const mockMap = new MockMapLibreMap();
    const routeManager = new MapLibreRouteManager(mockMap);

    routeManager.ensureLayers();
    expect(mockMap.getSource('tracker-route-source')).toBeDefined();

    routeManager.destroy();

    expect(mockMap.getSource('tracker-route-source')).toBeUndefined();
    expect(mockMap.getSource('tracker-waypoints-source')).toBeUndefined();
  });
});
