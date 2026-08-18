import type { Position, FeatureCollection, LineStringGeometry, PointGeometry, Feature } from './geojson/types.js';

export interface UserSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly username: string;
  readonly token: string;
  readonly loginTimestamp: number;
  readonly lastActiveTimestamp: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AuthBoothState = 'EMPTY' | 'OCCUPYING' | 'OCCUPIED' | 'DRAINING';

export interface AuthLockBoothStatus {
  readonly state: AuthBoothState;
  readonly currentSession: UserSession | null;
  readonly isLocked: boolean;
}

export interface RouteWaypoint {
  readonly id: string;
  readonly coordinate: Position;
  readonly timestamp: number;
  readonly name?: string;
  readonly speed?: number;
  readonly heading?: number;
  readonly accuracy?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RouteData {
  readonly routeId: string;
  readonly userId: string;
  readonly waypoints: readonly RouteWaypoint[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RouteGeoJsonFeatureProperties {
  readonly routeId: string;
  readonly userId: string;
  readonly pointCount: number;
  readonly distanceMeters?: number;
  readonly durationSeconds?: number;
  [key: string]: unknown;
}

export interface WaypointGeoJsonFeatureProperties {
  readonly waypointId: string;
  readonly routeId: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly name?: string;
  readonly speed?: number;
  readonly heading?: number;
  [key: string]: unknown;
}

export type RouteLineFeature = Feature<LineStringGeometry, RouteGeoJsonFeatureProperties>;
export type WaypointPointFeature = Feature<PointGeometry, WaypointGeoJsonFeatureProperties>;

export interface RouteGeoJsonCollections {
  readonly routeCollection: FeatureCollection<LineStringGeometry, RouteGeoJsonFeatureProperties>;
  readonly waypointCollection: FeatureCollection<PointGeometry, WaypointGeoJsonFeatureProperties>;
}
