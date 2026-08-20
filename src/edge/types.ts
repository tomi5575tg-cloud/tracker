import type { Position } from '../geojson/types.js';

export type TurboBoostLevel = 'IDLE' | 'ECO' | 'CRUISE' | 'SPORT' | 'TURBO_MAX';

export type UnitLoadLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type AiAnalysisTier =
  | 'TIER_0_RAW_INGEST'        // Low speed/idle: minimal processing, simple coordinate validation
  | 'TIER_1_KINEMATICS'        // City/Eco: speed, bearing, acceleration, distance metrics
  | 'TIER_2_SAFETY_CORRIDOR'   // Cruise/Highway: corridor geofencing, hazard prediction, proximity scans
  | 'TIER_3_DEEP_ANOMALY'      // Sport/Heavy Load: high-g detection, route deviation, predictive ETA, sensor fusion
  | 'TIER_4_FULL_COCKPIT_AI';  // Turbo Max/Emergency: real-time tactical recommendation, 3D vector collision alert

export interface TelemetryPointPayload {
  readonly coordinate: Position;
  readonly timestamp: number;
  readonly speedKmh?: number | undefined;
  readonly headingDeg?: number | undefined;
  readonly engineLoadPct?: number | undefined;
  readonly rpm?: number | undefined;
  readonly throttlePct?: number | undefined;
  readonly gForce?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface TelemetryBatchFrame {
  readonly frameId: string;
  readonly vehicleId: string;
  readonly driverId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly points: readonly TelemetryPointPayload[];
  readonly unitLoadPct?: number | undefined; // 0 - 100%
  readonly batteryVoltage?: number | undefined;
  readonly timestamp: number;
}

export interface PowerDosingEvaluation {
  readonly turboBoostLevel: TurboBoostLevel;
  readonly unitLoadLevel: UnitLoadLevel;
  readonly samplingIntervalMs: number;
  readonly maxBatchSize: number;
  readonly targetAiTier: AiAnalysisTier;
  readonly powerDosingRatio: number; // 0.0 - 1.0 (potentiometer ratio)
  readonly compressionEnabled: boolean;
  readonly alertPriority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

export interface TelemetryBridgeResult {
  readonly frameId: string;
  readonly processedPointsCount: number;
  readonly evaluation: PowerDosingEvaluation;
  readonly routeDistanceIncrementMeters: number;
  readonly averageSpeedKmh: number;
  readonly maxSpeedKmh: number;
  readonly detectedAnomalies: readonly string[];
  readonly aiInsights?: Readonly<Record<string, unknown>> | undefined;
  readonly processedAt: number;
}
