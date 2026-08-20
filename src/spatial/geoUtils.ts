import type { Position, PolygonGeometry, Feature } from '../geojson/types.js';
import { isValidCoordinate } from '../geojson/types.js';
import type { BoundingBoxTuple, BoundingBoxInput } from './types.js';

export const EARTH_RADIUS_METERS = 6371008.8; // Mean Earth radius in meters (WGS84 IUGG)

export class GeoSpatialUtils {
  /**
   * Converts degrees to radians
   */
  public static toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Converts radians to degrees
   */
  public static toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }

  /**
   * Computes the Great-Circle Distance between two WGS84 points using the Haversine formula.
   * Input format: [longitude, latitude]
   * Output: distance in meters
   */
  public static haversineDistance(coordA: Position, coordB: Position): number {
    if (!isValidCoordinate(coordA) || !isValidCoordinate(coordB)) {
      throw new Error('Invalid coordinates passed to haversineDistance');
    }

    const [lon1, lat1] = coordA;
    const [lon2, lat2] = coordB;

    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const radLat1 = this.toRadians(lat1);
    const radLat2 = this.toRadians(lat2);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(radLat1) * Math.cos(radLat2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
  }

  /**
   * Computes initial bearing / azimuth (in degrees 0-360) from coordA to coordB
   */
  public static calculateBearing(coordA: Position, coordB: Position): number {
    const [lon1, lat1] = coordA;
    const [lon2, lat2] = coordB;

    const radLat1 = this.toRadians(lat1);
    const radLat2 = this.toRadians(lat2);
    const dLon = this.toRadians(lon2 - lon1);

    const y = Math.sin(dLon) * Math.cos(radLat2);
    const x =
      Math.cos(radLat1) * Math.sin(radLat2) -
      Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLon);

    const brng = this.toDegrees(Math.atan2(y, x));
    return (brng + 360) % 360;
  }

  /**
   * Computes destination coordinate given a starting coordinate, bearing (degrees), and distance (meters).
   */
  public static destinationPoint(start: Position, bearingDegrees: number, distanceMeters: number): Position {
    const [lon, lat] = start;
    const radLat = this.toRadians(lat);
    const radLon = this.toRadians(lon);
    const radBearing = this.toRadians(bearingDegrees);
    const angularDist = distanceMeters / EARTH_RADIUS_METERS;

    const destLat = Math.asin(
      Math.sin(radLat) * Math.cos(angularDist) +
      Math.cos(radLat) * Math.sin(angularDist) * Math.cos(radBearing)
    );

    const destLon =
      radLon +
      Math.atan2(
        Math.sin(radBearing) * Math.sin(angularDist) * Math.cos(radLat),
        Math.cos(angularDist) - Math.sin(radLat) * Math.sin(destLat)
      );

    const normalizedLon = ((this.toDegrees(destLon) + 540) % 360) - 180;
    const normalizedLat = Math.max(-90, Math.min(90, this.toDegrees(destLat)));

    return [normalizedLon, normalizedLat];
  }

  /**
   * Normalizes any supported BoundingBoxInput into standard BoundingBoxTuple [minLon, minLat, maxLon, maxLat].
   */
  public static normalizeBBox(input: BoundingBoxInput): BoundingBoxTuple {
    let minLon: number;
    let minLat: number;
    let maxLon: number;
    let maxLat: number;

    if (Array.isArray(input)) {
      [minLon, minLat, maxLon, maxLat] = input;
    } else if ('southWest' in input && 'northEast' in input) {
      minLon = input.southWest[0];
      minLat = input.southWest[1];
      maxLon = input.northEast[0];
      maxLat = input.northEast[1];
    } else {
      minLon = input.minLon;
      minLat = input.minLat;
      maxLon = input.maxLon;
      maxLat = input.maxLat;
    }

    // Ensure min <= max
    const trueMinLon = Math.max(-180, Math.min(minLon, maxLon));
    const trueMaxLon = Math.min(180, Math.max(minLon, maxLon));
    const trueMinLat = Math.max(-90, Math.min(minLat, maxLat));
    const trueMaxLat = Math.min(90, Math.max(minLat, maxLat));

    return [trueMinLon, trueMinLat, trueMaxLon, trueMaxLat];
  }

  /**
   * Calculates a bounding box from a center point and radius in meters.
   */
  public static bboxFromRadius(center: Position, radiusMeters: number): BoundingBoxTuple {
    if (!isValidCoordinate(center)) {
      throw new Error('Invalid center coordinate');
    }
    if (radiusMeters < 0) {
      throw new Error('Radius must be non-negative');
    }

    const [lon, lat] = center;
    const radLat = this.toRadians(lat);

    // Latitude delta: 1 deg lat ~ 111,320m
    const latDelta = this.toDegrees(radiusMeters / EARTH_RADIUS_METERS);
    const minLat = Math.max(-90, lat - latDelta);
    const maxLat = Math.min(90, lat + latDelta);

    // Longitude delta: depends on latitude
    const cosLat = Math.cos(radLat);
    let lonDelta: number;
    if (Math.abs(cosLat) < 1e-7) {
      // Near poles
      lonDelta = 180;
    } else {
      lonDelta = this.toDegrees(radiusMeters / (EARTH_RADIUS_METERS * cosLat));
    }

    const minLon = Math.max(-180, lon - lonDelta);
    const maxLon = Math.min(180, lon + lonDelta);

    return [minLon, minLat, maxLon, maxLat];
  }

  /**
   * Calculates the encompassing BBox for a collection of positions.
   */
  public static bboxFromCoordinates(coordinates: readonly Position[]): BoundingBoxTuple {
    if (!coordinates || coordinates.length === 0) {
      return [0, 0, 0, 0];
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const [lon, lat] of coordinates) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }

    return [
      Math.max(-180, minLon),
      Math.max(-90, minLat),
      Math.min(180, maxLon),
      Math.min(90, maxLat),
    ];
  }

  /**
   * Expands an existing BBox by a buffer in meters.
   */
  public static expandBBox(bbox: BoundingBoxTuple, bufferMeters: number): BoundingBoxTuple {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const centerLat = (minLat + maxLat) / 2;
    const radLat = this.toRadians(centerLat);

    const latDelta = this.toDegrees(bufferMeters / EARTH_RADIUS_METERS);
    const cosLat = Math.max(0.01, Math.cos(radLat));
    const lonDelta = this.toDegrees(bufferMeters / (EARTH_RADIUS_METERS * cosLat));

    return [
      Math.max(-180, minLon - lonDelta),
      Math.max(-90, minLat - latDelta),
      Math.min(180, maxLon + lonDelta),
      Math.min(90, maxLat + latDelta),
    ];
  }

  /**
   * Checks whether a point [lon, lat] lies inside a BoundingBoxTuple.
   */
  public static isPointInBBox(point: Position, bbox: BoundingBoxTuple): boolean {
    const [lon, lat] = point;
    const [minLon, minLat, maxLon, maxLat] = bbox;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  }

  /**
   * Checks whether a point lies within a circular radius from center.
   */
  public static isPointInRadius(point: Position, center: Position, radiusMeters: number): boolean {
    const dist = this.haversineDistance(point, center);
    return dist <= radiusMeters;
  }

  /**
   * Checks whether a point lies within a polygon (Ray Casting algorithm with winding number).
   */
  public static isPointInPolygon(point: Position, polygonRing: readonly Position[]): boolean {
    if (polygonRing.length < 3) {
      return false;
    }

    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygonRing.length - 1; i < polygonRing.length; j = i++) {
      const xi = polygonRing[i]![0];
      const yi = polygonRing[i]![1];
      const xj = polygonRing[j]![0];
      const yj = polygonRing[j]![1];

      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Computes shortest distance from a point to a line segment (in meters).
   */
  public static distanceToSegment(point: Position, segStart: Position, segEnd: Position): number {
    const distStart = this.haversineDistance(point, segStart);
    const segLength = this.haversineDistance(segStart, segEnd);

    if (segLength === 0) {
      return distStart;
    }

    // Vector projection in local approximation
    const [px, py] = point;
    const [x1, y1] = segStart;
    const [x2, y2] = segEnd;

    const dx = x2 - x1;
    const dy = y2 - y1;

    let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));

    const projPoint: Position = [x1 + t * dx, y1 + t * dy];
    return this.haversineDistance(point, projPoint);
  }

  /**
   * Computes minimum distance from a point to a polyline / corridor of waypoints.
   */
  public static distanceToPolyline(point: Position, polyline: readonly Position[]): number {
    if (polyline.length === 0) return Infinity;
    if (polyline.length === 1) return this.haversineDistance(point, polyline[0]!);

    let minDist = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
      const segDist = this.distanceToSegment(point, polyline[i]!, polyline[i + 1]!);
      if (segDist < minDist) {
        minDist = segDist;
      }
    }
    return minDist;
  }

  /**
   * Converts a BoundingBoxTuple to a GeoJSON Polygon Feature.
   */
  public static bboxToGeoJsonPolygon(
    bbox: BoundingBoxTuple,
    properties: Record<string, unknown> = {}
  ): Feature<PolygonGeometry, Record<string, unknown>> {
    const [minLon, minLat, maxLon, maxLat] = bbox;

    // RFC 7946 GeoJSON: exterior ring must follow right-hand rule (counter-clockwise)
    const ring: Position[] = [
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat], // Closed ring
    ];

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
      properties: {
        bbox,
        ...properties,
      },
    };
  }

  /**
   * Converts a circular radius into an approximated N-gon GeoJSON Polygon.
   */
  public static circleToGeoJsonPolygon(
    center: Position,
    radiusMeters: number,
    steps = 64,
    properties: Record<string, unknown> = {}
  ): Feature<PolygonGeometry, Record<string, unknown>> {
    const coordinates: Position[] = [];

    for (let i = 0; i < steps; i++) {
      const angle = (i * 360) / steps;
      const point = this.destinationPoint(center, angle, radiusMeters);
      coordinates.push(point);
    }

    // Close polygon
    coordinates.push(coordinates[0]!);

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates],
      },
      properties: {
        center,
        radiusMeters,
        ...properties,
      },
    };
  }
}
