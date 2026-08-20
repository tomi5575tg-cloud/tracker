import type { Position } from '../geojson/types.js';

/**
 * 5-level Graceful Degradation Hierarchy.
 * Level 0 = OPTIMAL (Full hardware acceleration, live telemetry, online routing, ephemeris lighting)
 * Level 1 = DEGRADED_ONLINE (Network jitter/polling fallback, reduced shader frequencies)
 * Level 2 = OFFLINE_CACHED (Network loss, 100% local spatial cache, offline route replay, local buffer)
 * Level 3 = DEGRADED_FALLBACK (WebGL/GPU failure or GPS signal loss, Canvas/SVG schematic, Dead Reckoning)
 * Level 4 = CRITICAL_SURVIVAL (Safe mode, zero-crash guarantee, high-contrast emergency HUD, screen NEVER goes black)
 */
export enum DegradationLevel {
  OPTIMAL = 0,
  DEGRADED_ONLINE = 1,
  OFFLINE_CACHED = 2,
  DEGRADED_FALLBACK = 3,
  CRITICAL_SURVIVAL = 4,
}

/**
 * Subsystem identifiers within the Fault-Tolerant Mesh
 */
export enum MeshSubsystem {
  POSITIONING = 'POSITIONING',
  RENDERING = 'RENDERING',
  ROUTING = 'ROUTING',
  LIGHTING = 'LIGHTING',
  CONNECTIVITY = 'CONNECTIVITY',
  POI_DISCOVERY = 'POI_DISCOVERY',
  AUTH_SESSION = 'AUTH_SESSION',
  UI_CONTROLS = 'UI_CONTROLS',
}

/**
 * Circuit Breaker States
 */
export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation, calls allowed
  OPEN = 'OPEN',           // Fault threshold exceeded, calls rejected / routed to fallback
  HALF_OPEN = 'HALF_OPEN', // Trial period testing if upstream recovered
}

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;       // Consecutive failures or error rate before opening (default: 3)
  readonly resetTimeoutMs: number;          // Time to wait in OPEN state before trying HALF_OPEN (default: 5000ms)
  readonly halfOpenSuccessThreshold: number;// Successful calls in HALF_OPEN to transition to CLOSED (default: 2)
  readonly callTimeoutMs?: number | undefined; // Maximum execution time per call before timing out (default: 5000ms)
}

export interface SubsystemHealthReport {
  readonly subsystem: MeshSubsystem;
  readonly activeTierIndex: number;
  readonly totalTiers: number;
  readonly activeTierName: string;
  readonly circuitState: CircuitState;
  readonly degradationLevel: DegradationLevel;
  readonly isHealthy: boolean;
  readonly consecutiveFailures: number;
  readonly lastError?: string | undefined;
  readonly lastSuccessTimestamp: number;
  readonly lastFailureTimestamp?: number | undefined;
}

export interface MeshHealthSummary {
  readonly overallDegradationLevel: DegradationLevel;
  readonly isFullyOperational: boolean;
  readonly isSurvivalMode: boolean;
  readonly degradedSubsystemCount: number;
  readonly subsystems: Record<MeshSubsystem, SubsystemHealthReport>;
  readonly timestamp: number;
}

/**
 * Fallback Tier Handler definition
 */
export interface FallbackTier<TInput, TOutput> {
  readonly tierName: string;
  readonly degradationLevel: DegradationLevel;
  readonly execute: (input: TInput) => Promise<TOutput> | TOutput;
  readonly timeoutMs?: number | undefined;
  readonly isAvailable?: () => boolean;
}

export interface FallbackExecutionResult<TOutput> {
  readonly data: TOutput;
  readonly tierIndex: number;
  readonly tierName: string;
  readonly degradationLevel: DegradationLevel;
  readonly executionTimeMs: number;
  readonly isFallback: boolean;
  readonly errorChain: ReadonlyArray<{ tierName: string; error: Error }>;
}

/**
 * Telemetry & Dead Reckoning Data
 */
export enum PositioningSource {
  GPS_RTK = 'GPS_RTK',
  GPS_STANDARD = 'GPS_STANDARD',
  CELLULAR_WIFI = 'CELLULAR_WIFI',
  DEAD_RECKONING = 'DEAD_RECKONING',
  ROUTE_SNAPPED = 'ROUTE_SNAPPED',
  MANUAL_BEACON = 'MANUAL_BEACON',
  LAST_KNOWN = 'LAST_KNOWN',
}

export interface TelemetryFix {
  readonly position: Position; // [longitude, latitude]
  readonly altitudeMeters?: number | undefined;
  readonly speedKmh: number;
  readonly headingDegrees: number; // 0-360
  readonly accuracyMeters: number;
  readonly timestamp: number;
  readonly source: PositioningSource;
}

export interface DeadReckoningConfig {
  readonly maxExtrapolationDurationMs: number; // Max time to extrapolate without fix (default: 60000ms)
  readonly velocityDecayFactorPerSec: number;  // Velocity friction decay (default: 0.98)
  readonly maxUncertaintyRadiusMeters: number; // Max uncertainty limit (default: 500m)
  readonly uncertaintyGrowthRateMps: number;   // Uncertainty growth rate in m/s (default: 2.0 m/s)
  readonly minMovementSpeedKmh: number;       // Speed threshold below which stationary is assumed (default: 1.5 km/h)
}

export interface DeadReckoningState {
  readonly currentFix: TelemetryFix;
  readonly isExtrapolated: boolean;
  readonly extrapolationDurationMs: number;
  readonly uncertaintyRadiusMeters: number;
  readonly originalFix: TelemetryFix;
}

/**
 * Screen Guardian & Fallback Rendering
 */
export enum ScreenRenderMode {
  WEBGL_VECTOR = 'WEBGL_VECTOR',           // MapLibre GPU Vector rendering
  CANVAS_2D = 'CANVAS_2D',                 // 2D Canvas emergency schematic
  SVG_VECTOR = 'SVG_VECTOR',               // Pure SVG tactical HUD
  TEXT_EMERGENCY_HUD = 'TEXT_EMERGENCY_HUD' // High-contrast text telemetry HUD (zero crash fallback)
}

export interface ScreenGuardianState {
  readonly renderMode: ScreenRenderMode;
  readonly webGlContextAvailable: boolean;
  readonly renderFps: number;
  readonly isScreenAlive: boolean;
  readonly lastHeartbeatTimestamp: number;
  readonly totalRecoveries: number;
  readonly lastError?: string | undefined;
}

/**
 * Degraded Navigation Guidance
 */
export enum NavigationGuidanceTier {
  FULL_TURN_BY_TURN = 'FULL_TURN_BY_TURN',
  OFFLINE_CACHED_CORRIDOR = 'OFFLINE_CACHED_CORRIDOR',
  DIRECT_GEODETIC_BEARING = 'DIRECT_GEODETIC_BEARING',
  DEAD_RECKONING_BEACON = 'DEAD_RECKONING_BEACON',
  EMERGENCY_SAFE_HAVEN = 'EMERGENCY_SAFE_HAVEN',
}

export interface NavigationGuidance {
  readonly guidanceTier: NavigationGuidanceTier;
  readonly currentPosition: Position;
  readonly targetPosition: Position;
  readonly targetName: string;
  readonly distanceToTargetMeters: number;
  readonly bearingToTargetDegrees: number;
  readonly relativeBearingDegrees: number; // Angle relative to vehicle heading (-180 to +180)
  readonly crossTrackErrorMeters?: number | undefined;
  readonly estimatedTimeEnRouteSeconds: number;
  readonly maneuverInstruction: string;
  readonly isOffRoute: boolean;
  readonly degradationLevel: DegradationLevel;
}

/**
 * Offline Telemetry Mesh Buffer
 */
export enum MeshMessagePriority {
  EMERGENCY_CRITICAL = 0, // Panic/SOS/Security Drain
  TELEMETRY_HIGH = 1,     // Live GPS breadcrumbs
  POI_MEDIUM = 2,         // POI updates/inspections
  DIAGNOSTIC_LOW = 3,     // Health/metrics logs
}

export interface MeshBufferMessage<TPayload = unknown> {
  readonly id: string;
  readonly timestamp: number;
  readonly priority: MeshMessagePriority;
  readonly topic: string;
  readonly payload: TPayload;
  readonly attempts: number;
  readonly maxAttempts?: number | undefined;
}

export interface MeshBufferConfig {
  readonly maxBufferSize: number;           // Max messages before dropping/compacting low priority (default: 1000)
  readonly emergencyReserveSlots: number;    // Guaranteed slots for EMERGENCY_CRITICAL (default: 100)
  readonly compactionEnabled: boolean;       // Compacting intermediate high-frequency telemetry (default: true)
}

/**
 * Mesh Events
 */
export type MeshEventType =
  | 'DEGRADATION_CHANGED'
  | 'SUBSYSTEM_FAULT'
  | 'SUBSYSTEM_RECOVERY'
  | 'CIRCUIT_STATE_CHANGED'
  | 'SCREEN_MODE_CHANGED'
  | 'NAVIGATION_TIER_CHANGED'
  | 'TELEMETRY_FIX_LOST'
  | 'TELEMETRY_EXTRAPOLATED'
  | 'EMERGENCY_MODE_ACTIVATED';

export interface MeshEvent {
  readonly type: MeshEventType;
  readonly subsystem?: MeshSubsystem | undefined;
  readonly degradationLevel: DegradationLevel;
  readonly timestamp: number;
  readonly details: Record<string, unknown>;
}

export type MeshEventListener = (event: MeshEvent) => void;
