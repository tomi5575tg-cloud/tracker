import type {
  TelemetryBatchFrame,
  TelemetryBridgeResult,
} from './types.js';
import { AdaptiveSampler } from './adaptiveSampler.js';
import { AiAnalysisTierEngine, type AiInferenceOutput } from './aiTierEngine.js';
import type { RouteData, RouteWaypoint, UserSession } from '../types.js';
import type { FeatureCollection, LineStringGeometry, PointGeometry } from '../geojson/types.js';
import { RouteGeoJsonConverter } from '../geojson/converter.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import { AuthLockBooth } from '../auth/authBooth.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface EdgeFunctionRequest {
  readonly headers?: Record<string, string> | undefined;
  readonly body?: unknown;
  readonly method?: string | undefined;
}

export interface EdgeFunctionResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface SupabaseTelemetryBridgeConfig {
  readonly adaptiveSampler?: AdaptiveSampler | undefined;
  readonly aiEngine?: AiAnalysisTierEngine | undefined;
  readonly authBooth?: AuthLockBooth | undefined;
  readonly onBridgeProcessed?: ((result: TelemetryBridgeResult, route: RouteData) => void) | undefined;
}

/**
 * SupabaseTelemetryBridgeHandler:
 * Autonomous Edge Function bridge handler ingesting high-throughput telemetry streams,
 * scaling sampling and AI depth, and formatting output to RFC 7946 GeoJSON collections.
 */
export class SupabaseTelemetryBridgeHandler implements SessionDrainHook {
  private readonly sampler: AdaptiveSampler;
  private readonly aiEngine: AiAnalysisTierEngine;
  private readonly authBooth?: AuthLockBooth | undefined;
  private readonly onBridgeProcessed?: ((result: TelemetryBridgeResult, route: RouteData) => void) | undefined;
  private readonly activeRoutes = new Map<string, RouteData>();

  constructor(config: SupabaseTelemetryBridgeConfig = {}) {
    this.sampler = config.adaptiveSampler ?? new AdaptiveSampler();
    this.aiEngine = config.aiEngine ?? new AiAnalysisTierEngine();
    this.authBooth = config.authBooth;
    this.onBridgeProcessed = config.onBridgeProcessed;
  }

  public getSampler(): AdaptiveSampler {
    return this.sampler;
  }

  public getAiEngine(): AiAnalysisTierEngine {
    return this.aiEngine;
  }

  /**
   * Main HTTP Edge Function entry point compatible with Deno / Supabase Edge Runtime.
   */
  public async handleEdgeRequest(req: EdgeFunctionRequest): Promise<EdgeFunctionResponse> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    };

    if (req.method === 'OPTIONS') {
      return {
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true }),
      };
    }

    try {
      // 1. Authenticate session if AuthLockBooth is attached
      let session: UserSession | null = null;
      if (this.authBooth) {
        session = this.authBooth.getSession();
        if (!session) {
          return {
            status: 401,
            headers: corsHeaders,
            body: JSON.stringify({
              error: 'UNAUTHORIZED_SINGLE_BOOTH',
              message: 'No active session found in AuthLockBooth śluza',
            }),
          };
        }
      }

      // 2. Parse batch frame payload
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const frame = this.validateAndNormalizeFrame(payload);

      // 3. Process telemetry through power dosing and AI tier scaling
      const { result, route, geojson } = this.processTelemetryFrame(frame, session ?? undefined);

      return {
        status: 200,
        headers: {
          ...corsHeaders,
          'x-tracker-turbo-level': result.evaluation.turboBoostLevel,
          'x-tracker-ai-tier': result.evaluation.targetAiTier,
          'x-tracker-power-dosing': result.evaluation.powerDosingRatio.toString(),
        },
        body: JSON.stringify({
          success: true,
          result,
          route,
          geojson,
        }),
      };
    } catch (err: unknown) {
      return {
        status: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'BAD_TELEMETRY_REQUEST',
          message: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  /**
   * Ingests and processes a TelemetryBatchFrame locally.
   */
  public processTelemetryFrame(
    frame: TelemetryBatchFrame,
    session?: UserSession
  ): {
    result: TelemetryBridgeResult;
    route: RouteData;
    geojson: {
      routeCollection: FeatureCollection<LineStringGeometry>;
      waypointCollection: FeatureCollection<PointGeometry>;
    };
    aiOutput: AiInferenceOutput;
  } {
    if (!frame.points || frame.points.length === 0) {
      throw new Error('Invalid telemetry frame: points array is empty');
    }

    const latestPoint = frame.points[frame.points.length - 1]!;
    const unitLoadPct = frame.unitLoadPct ?? 0;

    // 1. Evaluate power dosing & sampling constraints
    const evaluation = this.sampler.evaluatePowerDosing(latestPoint, unitLoadPct);

    // 2. Filter / decimate points based on power dosing & speed
    const filteredPoints = this.sampler.filterStream(frame.points, evaluation);

    // 3. Run AI inference tier
    const aiOutput = this.aiEngine.analyzeBatch(filteredPoints, evaluation);

    // 4. Update or construct RouteData
    const route = this.updateOrCreateRoute(frame, filteredPoints, session);

    // 5. Convert to RFC 7946 GeoJSON collections
    const geojson = RouteGeoJsonConverter.toGeoJson(route);

    // Calculate speeds
    let sumSpeed = 0;
    let maxSpeed = 0;
    let countSpeed = 0;
    for (const p of filteredPoints) {
      if (p.speedKmh !== undefined) {
        sumSpeed += p.speedKmh;
        if (p.speedKmh > maxSpeed) maxSpeed = p.speedKmh;
        countSpeed++;
      }
    }
    const avgSpeed = countSpeed > 0 ? sumSpeed / countSpeed : 0;

    const result: TelemetryBridgeResult = {
      frameId: frame.frameId,
      processedPointsCount: filteredPoints.length,
      evaluation,
      routeDistanceIncrementMeters: aiOutput.kinematics.totalSegmentDistanceMeters,
      averageSpeedKmh: Number(avgSpeed.toFixed(1)),
      maxSpeedKmh: Number(maxSpeed.toFixed(1)),
      detectedAnomalies: aiOutput.detectedAnomalies,
      aiInsights: aiOutput.deepInsights,
      processedAt: Date.now(),
    };

    this.onBridgeProcessed?.(result, route);

    return {
      result,
      route,
      geojson,
      aiOutput,
    };
  }

  public getActiveRoute(vehicleId: string): RouteData | undefined {
    return this.activeRoutes.get(vehicleId);
  }

  public clear(): void {
    this.activeRoutes.clear();
  }

  /**
   * SessionDrainHook implementation
   */
  public drain(_reason = 'BRIDGE_DRAIN', _previousSession?: unknown): void {
    this.clear();
  }

  public destroy(): void {
    this.clear();
  }

  private validateAndNormalizeFrame(raw: any): TelemetryBatchFrame {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Payload must be a valid JSON object');
    }
    if (!raw.frameId || typeof raw.frameId !== 'string') {
      throw new Error('Field "frameId" is required');
    }
    if (!raw.vehicleId || typeof raw.vehicleId !== 'string') {
      throw new Error('Field "vehicleId" is required');
    }
    if (!Array.isArray(raw.points)) {
      throw new Error('Field "points" must be an array');
    }

    return {
      frameId: raw.frameId,
      vehicleId: raw.vehicleId,
      driverId: raw.driverId,
      tenantId: raw.tenantId,
      points: raw.points,
      unitLoadPct: raw.unitLoadPct,
      batteryVoltage: raw.batteryVoltage,
      timestamp: raw.timestamp ?? Date.now(),
    };
  }

  private updateOrCreateRoute(
    frame: TelemetryBatchFrame,
    points: readonly import('./types.js').TelemetryPointPayload[],
    session?: UserSession
  ): RouteData {
    const existing = this.activeRoutes.get(frame.vehicleId);
    const userId = session?.userId ?? frame.driverId ?? frame.vehicleId;

    const newWaypoints: RouteWaypoint[] = points.map((p, idx) => {
      const wp: RouteWaypoint = {
        id: `${frame.frameId}_pt_${idx}`,
        coordinate: p.coordinate,
        timestamp: p.timestamp,
        ...(p.speedKmh !== undefined ? { speed: p.speedKmh } : {}),
        ...(p.headingDeg !== undefined ? { heading: p.headingDeg } : {}),
        ...(p.metadata ? { metadata: p.metadata } : {}),
      };
      return wp;
    });

    let allWaypoints: readonly RouteWaypoint[];
    let distanceMeters = 0;
    let durationSeconds = 0;

    if (existing) {
      allWaypoints = [...existing.waypoints, ...newWaypoints];
      // Estimate cumulative metrics
      const firstTs = allWaypoints[0]!.timestamp;
      const lastTs = allWaypoints[allWaypoints.length - 1]!.timestamp;
      durationSeconds = Math.max(0, (lastTs - firstTs) / 1000);

      distanceMeters = existing.distanceMeters;
      for (let i = 0; i < newWaypoints.length; i++) {
        const prevCoord =
          i === 0
            ? existing.waypoints[existing.waypoints.length - 1]?.coordinate
            : newWaypoints[i - 1]?.coordinate;
        if (prevCoord) {
          distanceMeters += GeoSpatialUtils.haversineDistance(
            prevCoord,
            newWaypoints[i]!.coordinate
          );
        }
      }
    } else {
      allWaypoints = newWaypoints;
      const firstTs = allWaypoints[0]?.timestamp ?? Date.now();
      const lastTs = allWaypoints[allWaypoints.length - 1]?.timestamp ?? firstTs;
      durationSeconds = Math.max(0, (lastTs - firstTs) / 1000);

      for (let i = 1; i < allWaypoints.length; i++) {
        distanceMeters += GeoSpatialUtils.haversineDistance(
          allWaypoints[i - 1]!.coordinate,
          allWaypoints[i]!.coordinate
        );
      }
    }

    const updatedRoute: RouteData = {
      routeId: existing?.routeId ?? `route_${frame.vehicleId}_${Date.now()}`,
      userId,
      waypoints: allWaypoints,
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.round(durationSeconds),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    this.activeRoutes.set(frame.vehicleId, updatedRoute);
    return updatedRoute;
  }
}
