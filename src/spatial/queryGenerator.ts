import type { Position } from '../geojson/types.js';
import { isValidCoordinate } from '../geojson/types.js';
import type {
  BoundingBoxInput,
  RadiusFilter,
  RouteCorridorFilter,
  PolygonSpatialFilter,
  SpatialQueryCriteria,
  GeneratedSpatialQuery,
  PostGisQueryClause,
  MongoSpatialQueryClause,
  SqliteSpatialQueryClause,
} from './types.js';
import { GeoSpatialUtils } from './geoUtils.js';

export class SpatialQueryGenerator {
  /**
   * Generates a spatial query based on a Bounding Box (BBox).
   */
  public static fromBBox(
    bboxInput: BoundingBoxInput,
    options: Omit<SpatialQueryCriteria, 'type' | 'bbox'> = {}
  ): GeneratedSpatialQuery {
    const bbox = GeoSpatialUtils.normalizeBBox(bboxInput);
    const [minLon, minLat, maxLon, maxLat] = bbox;

    const criteria: SpatialQueryCriteria = {
      type: 'BBOX',
      bbox,
      ...options,
    };

    const geoJsonPolygon = GeoSpatialUtils.bboxToGeoJsonPolygon(bbox, {
      queryType: 'BBOX',
      ...options,
    });

    // PostGIS: ST_MakeEnvelope(minLon, minLat, maxLon, maxLat, 4326)
    const postGis: PostGisQueryClause = {
      sql: 'ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))',
      parameters: [minLon, minLat, maxLon, maxLat],
    };

    // MongoDB: $geoWithin -> $box: [[minLon, minLat], [maxLon, maxLat]]
    const mongoDb: MongoSpatialQueryClause = {
      filter: {
        location: {
          $geoWithin: {
            $box: [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
          },
        },
      },
    };

    // SQLite / Standard SQL: (lon BETWEEN ? AND ?) AND (lat BETWEEN ? AND ?)
    const sqlite: SqliteSpatialQueryClause = {
      sql: '(longitude >= ? AND longitude <= ? AND latitude >= ? AND latitude <= ?)',
      parameters: [minLon, maxLon, minLat, maxLat],
    };

    const urlParams: Record<string, string> = {
      spatial_type: 'bbox',
      bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
      ...(options.categoryIds ? { categories: options.categoryIds.join(',') } : {}),
      ...(options.limit ? { limit: String(options.limit) } : {}),
    };

    return {
      criteria,
      geoJsonPolygon,
      bbox,
      postGis,
      mongoDb,
      sqlite,
      urlParams,
    };
  }

  /**
   * Generates a spatial query based on Center Point and Radius (Meters).
   */
  public static fromRadius(
    center: Position,
    radiusMeters: number,
    options: Omit<SpatialQueryCriteria, 'type' | 'radius'> = {}
  ): GeneratedSpatialQuery {
    if (!isValidCoordinate(center)) {
      throw new Error(`Invalid center coordinates: ${JSON.stringify(center)}`);
    }
    if (radiusMeters < 0) {
      throw new Error(`Radius must be >= 0, received: ${radiusMeters}`);
    }

    const [lon, lat] = center;
    const radiusFilter: RadiusFilter = { center, radiusMeters };
    const bbox = GeoSpatialUtils.bboxFromRadius(center, radiusMeters);

    const criteria: SpatialQueryCriteria = {
      type: 'RADIUS',
      radius: radiusFilter,
      bbox,
      ...options,
    };

    const geoJsonPolygon = GeoSpatialUtils.circleToGeoJsonPolygon(center, radiusMeters, 64, {
      queryType: 'RADIUS',
      ...options,
    });

    // PostGIS: ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
    const postGis: PostGisQueryClause = {
      sql: 'ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)',
      parameters: [lon, lat, radiusMeters],
    };

    // MongoDB: $nearSphere / $geoWithin with $centerSphere
    // $centerSphere radius in radians = radiusMeters / 6378137
    const radiusRadians = radiusMeters / 6378137.0;
    const mongoDb: MongoSpatialQueryClause = {
      filter: {
        location: {
          $geoWithin: {
            $centerSphere: [[lon, lat], radiusRadians],
          },
        },
      },
    };

    // SQLite: Bounding box pre-filter + distance check
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const sqlite: SqliteSpatialQueryClause = {
      sql: '(longitude >= ? AND longitude <= ? AND latitude >= ? AND latitude <= ?)',
      parameters: [minLon, maxLon, minLat, maxLat],
    };

    const urlParams: Record<string, string> = {
      spatial_type: 'radius',
      lat: String(lat),
      lon: String(lon),
      radius: String(radiusMeters),
      ...(options.categoryIds ? { categories: options.categoryIds.join(',') } : {}),
      ...(options.limit ? { limit: String(options.limit) } : {}),
    };

    return {
      criteria,
      geoJsonPolygon,
      bbox,
      postGis,
      mongoDb,
      sqlite,
      urlParams,
    };
  }

  /**
   * Generates a spatial query for a Route Corridor / Buffer (e.g. Find POIs within 5km along route).
   */
  public static fromCorridor(
    coordinates: readonly Position[],
    bufferMeters: number,
    options: Omit<SpatialQueryCriteria, 'type' | 'corridor'> = {}
  ): GeneratedSpatialQuery {
    if (!coordinates || coordinates.length === 0) {
      throw new Error('Coordinates list cannot be empty for route corridor');
    }

    const corridorFilter: RouteCorridorFilter = { coordinates, bufferMeters };
    const rawBbox = GeoSpatialUtils.bboxFromCoordinates(coordinates);
    const bbox = GeoSpatialUtils.expandBBox(rawBbox, bufferMeters);

    const criteria: SpatialQueryCriteria = {
      type: 'CORRIDOR',
      corridor: corridorFilter,
      bbox,
      ...options,
    };

    const geoJsonPolygon = GeoSpatialUtils.bboxToGeoJsonPolygon(bbox, {
      queryType: 'CORRIDOR',
      bufferMeters,
      waypointCount: coordinates.length,
      ...options,
    });

    // PostGIS LineString WKT
    const lineWktCoords = coordinates.map(([l, a]) => `${l} ${a}`).join(', ');
    const postGis: PostGisQueryClause = {
      sql: 'ST_DWithin(geom::geography, ST_GeomFromText($1, 4326)::geography, $2)',
      parameters: [`LINESTRING(${lineWktCoords})`, bufferMeters],
    };

    const mongoDb: MongoSpatialQueryClause = {
      filter: {
        location: {
          $geoWithin: {
            $geometry: {
              type: 'Polygon',
              coordinates: geoJsonPolygon.geometry.coordinates,
            },
          },
        },
      },
    };

    const [minLon, minLat, maxLon, maxLat] = bbox;
    const sqlite: SqliteSpatialQueryClause = {
      sql: '(longitude >= ? AND longitude <= ? AND latitude >= ? AND latitude <= ?)',
      parameters: [minLon, maxLon, minLat, maxLat],
    };

    const urlParams: Record<string, string> = {
      spatial_type: 'corridor',
      buffer: String(bufferMeters),
      points_count: String(coordinates.length),
      bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    };

    return {
      criteria,
      geoJsonPolygon,
      bbox,
      postGis,
      mongoDb,
      sqlite,
      urlParams,
    };
  }

  /**
   * Generates a spatial query from a custom Polygon (e.g. Geofence / administrative district).
   */
  public static fromPolygon(
    coordinates: readonly Position[][],
    options: Omit<SpatialQueryCriteria, 'type' | 'polygon'> = {}
  ): GeneratedSpatialQuery {
    if (!coordinates || coordinates.length === 0 || !coordinates[0] || coordinates[0].length < 3) {
      throw new Error('Polygon must contain at least one ring with 3 or more coordinates');
    }

    const polygonFilter: PolygonSpatialFilter = { coordinates };
    const bbox = GeoSpatialUtils.bboxFromCoordinates(coordinates[0]);

    const criteria: SpatialQueryCriteria = {
      type: 'POLYGON',
      polygon: polygonFilter,
      bbox,
      ...options,
    };

    const geoJsonPolygon = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: coordinates.map((ring) => [...ring]),
      },
      properties: {
        queryType: 'POLYGON',
        ...options,
      },
    };

    // PostGIS Polygon WKT
    const ringsWkt = coordinates
      .map((ring) => `(${ring.map(([l, a]) => `${l} ${a}`).join(', ')})`)
      .join(', ');

    const postGis: PostGisQueryClause = {
      sql: 'ST_Intersects(geom, ST_GeomFromText($1, 4326))',
      parameters: [`POLYGON(${ringsWkt})`],
    };

    const mongoDb: MongoSpatialQueryClause = {
      filter: {
        location: {
          $geoWithin: {
            $geometry: {
              type: 'Polygon',
              coordinates: geoJsonPolygon.geometry.coordinates,
            },
          },
        },
      },
    };

    const [minLon, minLat, maxLon, maxLat] = bbox;
    const sqlite: SqliteSpatialQueryClause = {
      sql: '(longitude >= ? AND longitude <= ? AND latitude >= ? AND latitude <= ?)',
      parameters: [minLon, maxLon, minLat, maxLat],
    };

    const urlParams: Record<string, string> = {
      spatial_type: 'polygon',
      bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    };

    return {
      criteria,
      geoJsonPolygon,
      bbox,
      postGis,
      mongoDb,
      sqlite,
      urlParams,
    };
  }
}
