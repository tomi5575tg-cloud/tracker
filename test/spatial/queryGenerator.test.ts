import { describe, it, expect } from 'vitest';
import { SpatialQueryGenerator } from '../../src/spatial/queryGenerator.js';
import { GeoJsonValidator } from '../../src/geojson/validator.js';
import type { Position } from '../../src/geojson/types.js';

describe('SpatialQueryGenerator (BBox, Radius, Corridor, Polygon)', () => {
  const warsaw: Position = [21.0122, 52.2297];

  describe('fromBBox Generator', () => {
    it('should generate complete spatial query structure from BBox tuple', () => {
      const query = SpatialQueryGenerator.fromBBox([20.5, 52.0, 21.5, 52.5], {
        categoryIds: ['fuel_station', 'warehouse_logistics'],
        limit: 50,
      });

      expect(query.criteria.type).toBe('BBOX');
      expect(query.bbox).toEqual([20.5, 52.0, 21.5, 52.5]);

      // PostGIS
      expect(query.postGis.sql).toContain('ST_MakeEnvelope');
      expect(query.postGis.parameters).toEqual([20.5, 52.0, 21.5, 52.5]);

      // MongoDB
      expect(query.mongoDb.filter).toBeDefined();
      expect(query.mongoDb.filter['location']).toHaveProperty('$geoWithin');

      // SQLite
      expect(query.sqlite.sql).toContain('longitude >= ?');
      expect(query.sqlite.parameters).toEqual([20.5, 21.5, 52.0, 52.5]);

      // URL Params
      expect(query.urlParams['spatial_type']).toBe('bbox');
      expect(query.urlParams['bbox']).toBe('20.5,52,21.5,52.5');
      expect(query.urlParams['categories']).toBe('fuel_station,warehouse_logistics');

      // GeoJSON Polygon
      expect(GeoJsonValidator.isValidFeature(query.geoJsonPolygon)).toBe(true);
      expect(query.geoJsonPolygon.geometry.type).toBe('Polygon');
    });
  });

  describe('fromRadius Generator', () => {
    it('should generate circular spatial query and calculated BBox envelope', () => {
      const query = SpatialQueryGenerator.fromRadius(warsaw, 25000, {
        categoryIds: ['fuel_station'],
        limit: 20,
      });

      expect(query.criteria.type).toBe('RADIUS');
      expect(query.criteria.radius?.radiusMeters).toBe(25000);
      expect(query.criteria.radius?.center).toEqual(warsaw);

      // PostGIS
      expect(query.postGis.sql).toContain('ST_DWithin');
      expect(query.postGis.parameters).toEqual([warsaw[0], warsaw[1], 25000]);

      // MongoDB ($centerSphere with radians)
      expect(query.mongoDb.filter).toBeDefined();

      // SQLite
      expect(query.sqlite.sql).toContain('latitude >= ?');

      // URL Params
      expect(query.urlParams['spatial_type']).toBe('radius');
      expect(query.urlParams['lat']).toBe(String(warsaw[1]));
      expect(query.urlParams['lon']).toBe(String(warsaw[0]));
      expect(query.urlParams['radius']).toBe('25000');

      // GeoJSON Polygon
      expect(GeoJsonValidator.isValidFeature(query.geoJsonPolygon)).toBe(true);
    });

    it('should reject invalid radius or coordinate', () => {
      expect(() => SpatialQueryGenerator.fromRadius([250, 50], 1000)).toThrow();
      expect(() => SpatialQueryGenerator.fromRadius(warsaw, -50)).toThrow();
    });
  });

  describe('fromCorridor Generator', () => {
    it('should generate corridor buffer query along route waypoints', () => {
      const routeWaypoints: Position[] = [
        [21.0, 52.0],
        [21.2, 52.2],
        [21.4, 52.4],
      ];

      const query = SpatialQueryGenerator.fromCorridor(routeWaypoints, 5000);

      expect(query.criteria.type).toBe('CORRIDOR');
      expect(query.criteria.corridor?.bufferMeters).toBe(5000);
      expect(query.criteria.corridor?.coordinates).toHaveLength(3);

      // PostGIS LINESTRING WKT
      expect(query.postGis.sql).toContain('ST_DWithin');
      expect(query.postGis.parameters[0]).toBe('LINESTRING(21 52, 21.2 52.2, 21.4 52.4)');
      expect(query.postGis.parameters[1]).toBe(5000);

      expect(GeoJsonValidator.isValidFeature(query.geoJsonPolygon)).toBe(true);
    });
  });

  describe('fromPolygon Generator', () => {
    it('should generate arbitrary polygon geofence query', () => {
      const ring: Position[] = [
        [20.0, 50.0],
        [22.0, 50.0],
        [22.0, 52.0],
        [20.0, 52.0],
        [20.0, 50.0],
      ];

      const query = SpatialQueryGenerator.fromPolygon([ring]);

      expect(query.criteria.type).toBe('POLYGON');
      expect(query.postGis.sql).toContain('ST_Intersects');
      expect(query.postGis.parameters[0]).toContain('POLYGON((20 50, 22 50, 22 52, 20 52, 20 50))');
      expect(GeoJsonValidator.isValidFeature(query.geoJsonPolygon)).toBe(true);
    });
  });
});
