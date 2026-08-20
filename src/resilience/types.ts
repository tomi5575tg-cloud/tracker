import type { Position } from '../geojson/types.js';
import type { RouteData } from '../types.js';
import type { PoiItem } from '../poi/types.js';

export type MeshDegradationLevel =
  | 'LEVEL_0_NOMINAL'        // All systems nominal (WebGL 3D, Live GPS, Full Cloud AI, Online Tiles)
  | 'LEVEL_1_NETWORK_DEGRADED' // Cloud offline -> local Cache-First + Dead Reckoning estimation
  | 'LEVEL_2_GPS_LOST'       // GPS loss -> Inertial Extrapolation & Dead Reckoning Navigation
  | 'LEVEL_3_MAP_RENDER_LOST'// WebGL Context Lost -> Fallback to 2D Emergency Vector HUD Canvas
  | 'LEVEL_4_TOTAL_BLACKOUT';// Zero external sensors -> Standalone HUD Dead Reckoning Emergency Matrix

export type MeshSubsystemId =
  | 'GPS_POSITIONING'
  | 'MAP_RENDERER'
  | 'NETWORK_TELEMETRY'
  | 'AI_INFERENCE'
  | 'TILE_CACHE'
  | 'AUTH_SESSION';

export type SubsystemHealthStatus = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'RECOVERING';

export interface SubsystemHealthReport {
  readonly id: MeshSubsystemId;
  readonly status: SubsystemHealthStatus;
  readonly activeTier: string;
  readonly fallbackChain: readonly string[];
  readonly lastHeartbeat: number;
  readonly failureCount: number;
  readonly errorDetails?: string | undefined;
}

export interface DeadReckoningState {
  readonly estimatedCoordinate: Position;
  readonly lastKnownGpsCoordinate: Position;
  readonly currentSpeedKmh: number;
  readonly currentHeadingDeg: number;
  readonly extrapolationConfidencePct: number; // 0 - 100%
  readonly extrapolatedDurationMs: number;
  readonly totalExtrapolatedDistanceMeters: number;
  readonly isExtrapolating: boolean;
}

export interface InertialMotionReading {
  readonly timestamp: number;
  readonly speedKmh?: number | undefined;
  readonly headingDeg?: number | undefined;
  readonly yawRateDegPerSec?: number | undefined;
  readonly accelerationForwardG?: number | undefined;
  readonly wheelTicksDelta?: number | undefined;
}

export interface EmergencyRenderFrame {
  readonly width: number;
  readonly height: number;
  readonly center: Position;
  readonly heading: number;
  readonly zoom: number;
  readonly activeRoute: RouteData | null;
  readonly currentPosition: Position;
  readonly isDeadReckoning: boolean;
  readonly nearbyPois: readonly PoiItem[];
  readonly degradationLevel: MeshDegradationLevel;
  readonly healthReports: readonly SubsystemHealthReport[];
}

export interface MeshStatusSummary {
  readonly overallLevel: MeshDegradationLevel;
  readonly isScreenSafe: boolean; // Guaranteed screen availability (Never goes black)
  readonly isNavigationActive: boolean;
  readonly deadReckoning: DeadReckoningState;
  readonly activeRenderer: 'MAPLIBRE_WEBGL' | 'EMERGENCY_2D_CANVAS' | 'FALLBACK_SVG';
  readonly activeTelemetryChannel: 'SUPABASE_EDGE' | 'LOCAL_OFFLINE_BUFFER' | 'RADIO_SILENCE_DR';
  readonly subsystems: readonly SubsystemHealthReport[];
  readonly timestamp: number;
}
