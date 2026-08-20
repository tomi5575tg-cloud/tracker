/**
 * RFC 7946 GeoJSON TypeScript Definitions
 * Standard: https://datatracker.ietf.org/doc/html/rfc7946
 */

export type Position = [longitude: number, latitude: number] | [longitude: number, latitude: number, elevation: number];

export type GeoJsonGeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | 'GeometryCollection';

export interface GeoJsonObject {
  readonly type: string;
  readonly bbox?: [number, number, number, number] | [number, number, number, number, number, number];
}

export interface PointGeometry extends GeoJsonObject {
  readonly type: 'Point';
  readonly coordinates: Position;
}

export interface MultiPointGeometry extends GeoJsonObject {
  readonly type: 'MultiPoint';
  readonly coordinates: Position[];
}

export interface LineStringGeometry extends GeoJsonObject {
  readonly type: 'LineString';
  readonly coordinates: Position[];
}

export interface MultiLineStringGeometry extends GeoJsonObject {
  readonly type: 'MultiLineString';
  readonly coordinates: Position[][];
}

export interface PolygonGeometry extends GeoJsonObject {
  readonly type: 'Polygon';
  readonly coordinates: Position[][];
}

export interface MultiPolygonGeometry extends GeoJsonObject {
  readonly type: 'MultiPolygon';
  readonly coordinates: Position[][][];
}

export interface GeometryCollection extends GeoJsonObject {
  readonly type: 'GeometryCollection';
  readonly geometries: Geometry[];
}

export type Geometry =
  | PointGeometry
  | MultiPointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry
  | GeometryCollection;

export interface Feature<G extends Geometry | null = Geometry, P = Record<string, unknown>> extends GeoJsonObject {
  readonly type: 'Feature';
  readonly id?: string | number;
  readonly geometry: G;
  readonly properties: P;
}

export interface FeatureCollection<G extends Geometry | null = Geometry, P = Record<string, unknown>> extends GeoJsonObject {
  readonly type: 'FeatureCollection';
  readonly features: Feature<G, P>[];
}

/**
 * Creates a compliant RFC 7946 empty FeatureCollection
 */
export function createEmptyFeatureCollection<G extends Geometry | null = Geometry, P = Record<string, unknown>>(): FeatureCollection<G, P> {
  return Object.freeze({
    type: 'FeatureCollection',
    features: [],
  });
}

/**
 * Validates coordinate ranges according to WGS84 / RFC 7946
 * Longitude: [-180, 180], Latitude: [-90, 90]
 */
export function isValidCoordinate(coord: Position): boolean {
  if (!Array.isArray(coord) || coord.length < 2) {
    return false;
  }
  const [lon, lat] = coord;
  if (typeof lon !== 'number' || typeof lat !== 'number') {
    return false;
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return false;
  }
  return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}
