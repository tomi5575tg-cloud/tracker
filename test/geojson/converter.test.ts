import { describe, it, expect } from 'vitest';
import { RouteGeoJsonConverter } from '../../src/geojson/converter.js';
import { GeoJsonValidator } from '../../src/geojson/validator.js';
import type { RouteData } from '../../src/types.js';

describe('RouteGeoJsonConverter & RFC 7946 GeoJSON Compliance', () => {
  it('should generate valid RFC 7946 FeatureCollections for empty routes', () => {
    const emptyGeoJson = RouteGeoJsonConverter.emptyGeoJson();

    expect(GeoJsonValidator.isRFC7946FeatureCollection(emptyGeoJson.routeCollection)).toBe(true);
    expect(GeoJsonValidator.isRFC7946FeatureCollection(emptyGeoJson.waypointCollection)).toBe(true);

    expect(emptyGeoJson.routeCollection.type).toBe('FeatureCollection');
    expect(emptyGeoJson.routeCollection.features).toHaveLength(0);
    expect(emptyGeoJson.waypointCollection.type).toBe('FeatureCollection');
    expect(emptyGeoJson.waypointCollection.features).toHaveLength(0);
  });

  it('should convert RouteData to LineString and Point GeoJSON with valid coordinates [lon, lat]', () => {
    const sampleRoute: RouteData = {
      routeId: 'route-101',
      userId: 'user-alpha',
      distanceMeters: 4500,
      durationSeconds: 900,
      createdAt: 1700000000000,
      updatedAt: 1700000900000,
      waypoints: [
        {
          id: 'wp-1',
          coordinate: [21.0122, 52.2297], // Warsaw [lon, lat]
          timestamp: 1700000000000,
          name: 'Start Point',
          speed: 0,
          heading: 90,
        },
        {
          id: 'wp-2',
          coordinate: [21.0180, 52.2350],
          timestamp: 1700000450000,
          name: 'Checkpoint 1',
          speed: 15,
          heading: 45,
        },
        {
          id: 'wp-3',
          coordinate: [21.0250, 52.2400],
          timestamp: 1700000900000,
          name: 'Finish Line',
          speed: 0,
          heading: 0,
        },
      ],
    };

    const geojson = RouteGeoJsonConverter.toGeoJson(sampleRoute);

    // Validate FeatureCollections
    expect(GeoJsonValidator.isRFC7946FeatureCollection(geojson.routeCollection)).toBe(true);
    expect(GeoJsonValidator.isRFC7946FeatureCollection(geojson.waypointCollection)).toBe(true);

    // Validate LineString Feature
    expect(geojson.routeCollection.features).toHaveLength(1);
    const lineFeature = geojson.routeCollection.features[0]!;
    expect(lineFeature.type).toBe('Feature');
    expect(lineFeature.id).toBe('route-101');
    expect(lineFeature.geometry.type).toBe('LineString');
    expect(lineFeature.geometry.coordinates).toEqual([
      [21.0122, 52.2297],
      [21.0180, 52.2350],
      [21.0250, 52.2400],
    ]);
    expect(lineFeature.properties.routeId).toBe('route-101');
    expect(lineFeature.properties.userId).toBe('user-alpha');
    expect(lineFeature.properties.pointCount).toBe(3);
    expect(lineFeature.properties.distanceMeters).toBe(4500);

    // Validate Waypoint Features
    expect(geojson.waypointCollection.features).toHaveLength(3);
    const firstWp = geojson.waypointCollection.features[0]!;
    expect(firstWp.type).toBe('Feature');
    expect(firstWp.id).toBe('wp-1');
    expect(firstWp.geometry.type).toBe('Point');
    expect(firstWp.geometry.coordinates).toEqual([21.0122, 52.2297]);
    expect(firstWp.properties.name).toBe('Start Point');
    expect(firstWp.properties.sequence).toBe(0);
  });

  it('should filter out invalid coordinates out of bounds according to RFC 7946', () => {
    const invalidRoute: RouteData = {
      routeId: 'route-invalid',
      userId: 'user-beta',
      distanceMeters: 100,
      durationSeconds: 60,
      createdAt: 1700000000000,
      updatedAt: 1700000060000,
      waypoints: [
        {
          id: 'wp-valid',
          coordinate: [19.9449, 50.0647], // Krakow
          timestamp: 1700000000000,
        },
        {
          id: 'wp-invalid-lon',
          coordinate: [250, 50.0647], // Out of bounds longitude (>180)
          timestamp: 1700000030000,
        },
        {
          id: 'wp-invalid-lat',
          coordinate: [19.9449, -120], // Out of bounds latitude (<-90)
          timestamp: 1700000060000,
        },
      ],
    };

    const geojson = RouteGeoJsonConverter.toGeoJson(invalidRoute);

    expect(geojson.routeCollection.features).toHaveLength(1);
    expect(geojson.routeCollection.features[0]!.geometry.coordinates).toEqual([[19.9449, 50.0647]]);
    expect(geojson.waypointCollection.features).toHaveLength(1);
    expect(geojson.waypointCollection.features[0]!.id).toBe('wp-valid');
  });
});
