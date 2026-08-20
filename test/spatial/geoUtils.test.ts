import { describe, it, expect } from 'vitest';
import { GeoSpatialUtils } from '../../src/spatial/geoUtils.js';
import type { Position } from '../../src/geojson/types.js';

describe('GeoSpatialUtils (Geodetic Calculations & Spatial Math)', () => {
  // Warsaw [21.0122, 52.2297], Krakow [19.9449, 50.0647]
  const warsaw: Position = [21.0122, 52.2297];
  const krakow: Position = [19.9449, 50.0647];
  const gdansk: Position = [18.6466, 54.3520];

  describe('Haversine Great-Circle Distance', () => {
    it('should compute zero distance for identical coordinates', () => {
      expect(GeoSpatialUtils.haversineDistance(warsaw, warsaw)).toBe(0);
    });

    it('should accurately calculate distance between Warsaw and Krakow (~252 km)', () => {
      const dist = GeoSpatialUtils.haversineDistance(warsaw, krakow);
      // Expected ~ 252,000 meters (+/- 2km tolerance)
      expect(dist).toBeGreaterThan(250000);
      expect(dist).toBeLessThan(255000);
    });

    it('should throw error for invalid coordinates outside RFC 7946 range', () => {
      expect(() => GeoSpatialUtils.haversineDistance([200, 50], warsaw)).toThrow();
    });
  });

  describe('Bearing & Destination Point', () => {
    it('should calculate bearing from Warsaw to Gdansk (~335 degrees / North-West)', () => {
      const bearing = GeoSpatialUtils.calculateBearing(warsaw, gdansk);
      expect(bearing).toBeGreaterThan(320);
      expect(bearing).toBeLessThan(350);
    });

    it('should calculate destination point heading North (0 deg) for 100km', () => {
      const dest = GeoSpatialUtils.destinationPoint(warsaw, 0, 100000);
      expect(dest[0]).toBeCloseTo(warsaw[0], 2); // Lon roughly same
      expect(dest[1]).toBeGreaterThan(warsaw[1]); // Lat increased
      const actualDist = GeoSpatialUtils.haversineDistance(warsaw, dest);
      expect(actualDist).toBeCloseTo(100000, -2); // ~100,000m
    });
  });

  describe('Bounding Box Calculations', () => {
    it('should normalize bbox from tuple or object', () => {
      const tupleBbox = GeoSpatialUtils.normalizeBBox([20, 50, 22, 53]);
      expect(tupleBbox).toEqual([20, 50, 22, 53]);

      const objectBbox = GeoSpatialUtils.normalizeBBox({ minLon: 20, minLat: 50, maxLon: 22, maxLat: 53 });
      expect(objectBbox).toEqual([20, 50, 22, 53]);

      const cornersBbox = GeoSpatialUtils.normalizeBBox({
        southWest: [20, 50],
        northEast: [22, 53],
      });
      expect(cornersBbox).toEqual([20, 50, 22, 53]);
    });

    it('should calculate BBox from Radius around center', () => {
      const bbox = GeoSpatialUtils.bboxFromRadius(warsaw, 50000); // 50km
      const [minLon, minLat, maxLon, maxLat] = bbox;

      expect(minLon).toBeLessThan(warsaw[0]);
      expect(maxLon).toBeGreaterThan(warsaw[0]);
      expect(minLat).toBeLessThan(warsaw[1]);
      expect(maxLat).toBeGreaterThan(warsaw[1]);

      // Verify point inside
      expect(GeoSpatialUtils.isPointInBBox(warsaw, bbox)).toBe(true);
    });

    it('should expand BBox by buffer in meters', () => {
      const baseBbox = GeoSpatialUtils.normalizeBBox([20, 50, 22, 52]);
      const expanded = GeoSpatialUtils.expandBBox(baseBbox, 10000); // 10km buffer

      expect(expanded[0]).toBeLessThan(baseBbox[0]);
      expect(expanded[1]).toBeLessThan(baseBbox[1]);
      expect(expanded[2]).toBeGreaterThan(baseBbox[2]);
      expect(expanded[3]).toBeGreaterThan(baseBbox[3]);
    });
  });

  describe('Containment & Proximity Evaluations', () => {
    it('should check if point is in radius', () => {
      const nearbyPoint: Position = [21.05, 52.23];
      expect(GeoSpatialUtils.isPointInRadius(nearbyPoint, warsaw, 10000)).toBe(true);
      expect(GeoSpatialUtils.isPointInRadius(krakow, warsaw, 10000)).toBe(false);
    });

    it('should check if point is inside polygon ring', () => {
      // Polygon around Warsaw
      const polygonRing: Position[] = [
        [20.8, 52.1],
        [21.2, 52.1],
        [21.2, 52.4],
        [20.8, 52.4],
        [20.8, 52.1],
      ];

      expect(GeoSpatialUtils.isPointInPolygon(warsaw, polygonRing)).toBe(true);
      expect(GeoSpatialUtils.isPointInPolygon(krakow, polygonRing)).toBe(false);
    });

    it('should calculate distance from point to line segment and polyline corridor', () => {
      const routePolyline: Position[] = [
        [21.0, 52.0],
        [21.0, 52.5],
        [21.0, 53.0],
      ];

      const onRoutePoint: Position = [21.0, 52.25];
      const nearRoutePoint: Position = [21.01, 52.25]; // ~700m away
      const farPoint: Position = [22.0, 52.25];

      expect(GeoSpatialUtils.distanceToPolyline(onRoutePoint, routePolyline)).toBeCloseTo(0, 0);
      const nearDist = GeoSpatialUtils.distanceToPolyline(nearRoutePoint, routePolyline);
      expect(nearDist).toBeGreaterThan(500);
      expect(nearDist).toBeLessThan(1000);

      const farDist = GeoSpatialUtils.distanceToPolyline(farPoint, routePolyline);
      expect(farDist).toBeGreaterThan(60000); // > 60km
    });

    it('should convert BBox to valid RFC 7946 Polygon Feature', () => {
      const bboxFeature = GeoSpatialUtils.bboxToGeoJsonPolygon([20, 50, 22, 52], { name: 'Test BBox' });
      expect(bboxFeature.type).toBe('Feature');
      expect(bboxFeature.geometry.type).toBe('Polygon');
      expect(bboxFeature.geometry.coordinates[0]).toHaveLength(5); // closed ring
      expect(bboxFeature.properties['name']).toBe('Test BBox');
    });

    it('should convert Circle/Radius to approximate GeoJSON Polygon Feature', () => {
      const circleFeature = GeoSpatialUtils.circleToGeoJsonPolygon(warsaw, 5000, 32);
      expect(circleFeature.type).toBe('Feature');
      expect(circleFeature.geometry.type).toBe('Polygon');
      expect(circleFeature.geometry.coordinates[0]).toHaveLength(33); // 32 steps + closed ring
    });
  });
});
