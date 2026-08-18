import type { Position } from '../geojson/types.js';
import { createEmptyFeatureCollection, isValidCoordinate } from '../geojson/types.js';
import type {
  RouteData,
  RouteGeoJsonCollections,
  RouteLineFeature,
  WaypointPointFeature,
  RouteGeoJsonFeatureProperties,
  WaypointGeoJsonFeatureProperties,
} from '../types.js';

export class RouteGeoJsonConverter {
  /**
   * Converts a domain RouteData model to RFC 7946 compliant GeoJSON FeatureCollections:
   * 1. Route LineString FeatureCollection (the trajectory line)
   * 2. Waypoints Point FeatureCollection (individual markers/stops)
   */
  public static toGeoJson(route: RouteData): RouteGeoJsonCollections {
    if (!route || !route.waypoints || route.waypoints.length === 0) {
      return {
        routeCollection: createEmptyFeatureCollection<RouteLineFeature['geometry'], RouteGeoJsonFeatureProperties>(),
        waypointCollection: createEmptyFeatureCollection<WaypointPointFeature['geometry'], WaypointGeoJsonFeatureProperties>(),
      };
    }

    const validWaypoints = route.waypoints.filter((wp) => isValidCoordinate(wp.coordinate));

    if (validWaypoints.length === 0) {
      return {
        routeCollection: createEmptyFeatureCollection<RouteLineFeature['geometry'], RouteGeoJsonFeatureProperties>(),
        waypointCollection: createEmptyFeatureCollection<WaypointPointFeature['geometry'], WaypointGeoJsonFeatureProperties>(),
      };
    }

    // Build LineString coordinates [lon, lat]
    const coordinates: Position[] = validWaypoints.map((wp) => [wp.coordinate[0], wp.coordinate[1]]);

    const routeFeature: RouteLineFeature = {
      type: 'Feature',
      id: route.routeId,
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        routeId: route.routeId,
        userId: route.userId,
        pointCount: validWaypoints.length,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      },
    };

    const waypointFeatures: WaypointPointFeature[] = validWaypoints.map((wp, index) => {
      const pointProps: WaypointGeoJsonFeatureProperties = {
        waypointId: wp.id,
        routeId: route.routeId,
        sequence: index,
        timestamp: wp.timestamp,
        ...(wp.name !== undefined ? { name: wp.name } : {}),
        ...(wp.speed !== undefined ? { speed: wp.speed } : {}),
        ...(wp.heading !== undefined ? { heading: wp.heading } : {}),
        ...(wp.metadata ? { ...wp.metadata } : {}),
      };

      return {
        type: 'Feature',
        id: wp.id,
        geometry: {
          type: 'Point',
          coordinates: [wp.coordinate[0], wp.coordinate[1]],
        },
        properties: pointProps,
      };
    });

    return {
      routeCollection: {
        type: 'FeatureCollection',
        features: [routeFeature],
      },
      waypointCollection: {
        type: 'FeatureCollection',
        features: waypointFeatures,
      },
    };
  }

  /**
   * Generates completely empty, valid RFC 7946 FeatureCollections for clearing layers
   */
  public static emptyGeoJson(): RouteGeoJsonCollections {
    return {
      routeCollection: createEmptyFeatureCollection<RouteLineFeature['geometry'], RouteGeoJsonFeatureProperties>(),
      waypointCollection: createEmptyFeatureCollection<WaypointPointFeature['geometry'], WaypointGeoJsonFeatureProperties>(),
    };
  }
}
