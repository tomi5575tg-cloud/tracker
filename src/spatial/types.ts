import type { Position, PolygonGeometry, Feature, FeatureCollection } from '../geojson/types.js';
import type { PoiStatus, UserRoleContext } from '../poi/types.js';
import type { UserSession } from '../types.js';

/**
 * Bounding Box representation in RFC 7946 GeoJSON order:
 * [minLongitude, minLatitude, maxLongitude, maxLatitude]
 * or as structured 2D corners.
 */
export type BoundingBoxTuple = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface BoundingBoxCorners {
  readonly southWest: Position; // [minLon, minLat]
  readonly northEast: Position; // [maxLon, maxLat]
}

export type BoundingBoxInput = BoundingBoxTuple | BoundingBoxCorners | {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
};

/**
 * Circular Spatial Filter (Radius / Point + Distance)
 */
export interface RadiusFilter {
  readonly center: Position; // [longitude, latitude]
  readonly radiusMeters: number;
}

/**
 * Route Buffer / Corridor Spatial Filter
 */
export interface RouteCorridorFilter {
  readonly coordinates: readonly Position[];
  readonly bufferMeters: number;
}

/**
 * Polygon Area Spatial Filter
 */
export interface PolygonSpatialFilter {
  readonly coordinates: readonly Position[][]; // outer ring + optional inner rings
}

/**
 * Types of Spatial Queries
 */
export type SpatialQueryType = 'BBOX' | 'RADIUS' | 'CORRIDOR' | 'POLYGON';

/**
 * Unified Spatial Query Criteria
 */
export interface SpatialQueryCriteria {
  readonly type: SpatialQueryType;
  readonly bbox?: BoundingBoxTuple | undefined;
  readonly radius?: RadiusFilter | undefined;
  readonly corridor?: RouteCorridorFilter | undefined;
  readonly polygon?: PolygonSpatialFilter | undefined;
  readonly categoryIds?: readonly string[] | undefined;
  readonly statuses?: readonly PoiStatus[] | undefined;
  readonly tenantId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly sortByDistance?: boolean | undefined;
}

/**
 * Target format for SQL/PostGIS and MongoDB spatial queries
 */
export interface PostGisQueryClause {
  readonly sql: string;
  readonly parameters: readonly (string | number | boolean)[];
}

export interface MongoSpatialQueryClause {
  readonly filter: Record<string, unknown>;
}

export interface SqliteSpatialQueryClause {
  readonly sql: string;
  readonly parameters: readonly (string | number | boolean)[];
}

/**
 * Exported representation of a generated spatial query
 */
export interface GeneratedSpatialQuery {
  readonly criteria: SpatialQueryCriteria;
  readonly geoJsonPolygon: Feature<PolygonGeometry, Record<string, unknown>>;
  readonly bbox: BoundingBoxTuple;
  readonly postGis: PostGisQueryClause;
  readonly mongoDb: MongoSpatialQueryClause;
  readonly sqlite: SqliteSpatialQueryClause;
  readonly urlParams: Record<string, string>;
}

/**
 * Search and Spatial Evaluation Result
 */
export interface SpatialMatchResult<T> {
  readonly item: T;
  readonly distanceMeters: number;
  readonly inside: boolean;
}

export interface SpatialSearchResult<T> {
  readonly items: readonly T[];
  readonly totalMatches: number;
  readonly query: SpatialQueryCriteria;
  readonly featureCollection: FeatureCollection;
}

/**
 * Spatial Filter Options with Access Control
 */
export interface SpatialExecutionOptions {
  readonly subject?: UserSession | UserRoleContext | undefined;
  readonly categoryIds?: readonly string[] | undefined;
  readonly statuses?: readonly PoiStatus[] | undefined;
  readonly tenantId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly sortByDistance?: boolean | undefined;
}
