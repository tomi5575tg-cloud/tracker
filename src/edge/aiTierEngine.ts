import type {
  AiAnalysisTier,
  TelemetryPointPayload,
  PowerDosingEvaluation,
} from './types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';

export interface AiInferenceOutput {
  readonly tier: AiAnalysisTier;
  readonly confidenceScore: number;
  readonly detectedAnomalies: readonly string[];
  readonly kinematics: {
    readonly currentSpeedKmh: number;
    readonly accelerationG: number;
    readonly totalSegmentDistanceMeters: number;
    readonly headingVariance: number;
  };
  readonly tacticalRecommendation?: string | undefined;
  readonly safetyCorridorBreached: boolean;
  readonly deepInsights?: Readonly<Record<string, unknown>> | undefined;
}

export interface AiAnalysisEngineConfig {
  /**
   * Safety speed limit threshold in km/h for corridor warnings (default: 130 km/h)
   */
  readonly speedWarningThresholdKmh?: number | undefined;
  /**
   * Maximum lateral/longitudinal g-force tolerance before flagging harsh maneuver (default: 0.65g)
   */
  readonly maxSafeGForce?: number | undefined;
  /**
   * Maximum engine load percentage before flagging thermal stress (default: 92%)
   */
  readonly maxEngineThermalStressPct?: number | undefined;
}

/**
 * AiAnalysisTierEngine:
 * Deep telematics inference scaling engine executing tiered AI evaluation
 * based on hardware Turbo Boost and Unit Load state.
 */
export class AiAnalysisTierEngine {
  private readonly config: Required<AiAnalysisEngineConfig>;

  constructor(config: AiAnalysisEngineConfig = {}) {
    this.config = {
      speedWarningThresholdKmh: config.speedWarningThresholdKmh ?? 130,
      maxSafeGForce: config.maxSafeGForce ?? 0.65,
      maxEngineThermalStressPct: config.maxEngineThermalStressPct ?? 92,
    };
  }

  /**
   * Runs scaled AI inference over a batch of filtered telemetry points.
   */
  public analyzeBatch(
    points: readonly TelemetryPointPayload[],
    evaluation: PowerDosingEvaluation
  ): AiInferenceOutput {
    const tier = evaluation.targetAiTier;
    const anomalies: string[] = [];

    if (points.length === 0) {
      return {
        tier,
        confidenceScore: 0,
        detectedAnomalies: ['EMPTY_BATCH_PAYLOAD'],
        kinematics: {
          currentSpeedKmh: 0,
          accelerationG: 0,
          totalSegmentDistanceMeters: 0,
          headingVariance: 0,
        },
        safetyCorridorBreached: false,
      };
    }

    const lastPoint = points[points.length - 1]!;
    const currentSpeed = lastPoint.speedKmh ?? 0;
    const currentG = lastPoint.gForce ?? 0;

    // Calculate total segment distance and speeds
    let totalDistMeters = 0;
    let maxSpeed = currentSpeed;
    const speeds: number[] = [];
    const headings: number[] = [];

    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (p.speedKmh !== undefined) {
        speeds.push(p.speedKmh);
        if (p.speedKmh > maxSpeed) maxSpeed = p.speedKmh;
      }
      if (p.headingDeg !== undefined) {
        headings.push(p.headingDeg);
      }
      if (i > 0) {
        const prev = points[i - 1]!;
        totalDistMeters += GeoSpatialUtils.haversineDistance(prev.coordinate, p.coordinate);
      }
    }

    // Heading variance
    const headingVariance = this.calculateHeadingVariance(headings);

    // --- TIER 0: Raw Ingest Validation ---
    if (tier === 'TIER_0_RAW_INGEST') {
      return {
        tier,
        confidenceScore: 0.95,
        detectedAnomalies: anomalies,
        kinematics: {
          currentSpeedKmh: currentSpeed,
          accelerationG: currentG,
          totalSegmentDistanceMeters: Number(totalDistMeters.toFixed(1)),
          headingVariance: Number(headingVariance.toFixed(1)),
        },
        safetyCorridorBreached: false,
      };
    }

    // --- TIER 1: Kinematics Analysis ---
    const speedWarn = this.config.speedWarningThresholdKmh ?? 130;
    const maxSafeG = this.config.maxSafeGForce ?? 0.65;
    const maxThermal = this.config.maxEngineThermalStressPct ?? 92;

    if (currentSpeed > speedWarn) {
      anomalies.push(`HIGH_SPEED_EXCEEDANCE_${Math.round(currentSpeed)}KMH`);
    }
    if (Math.abs(currentG) > maxSafeG) {
      anomalies.push(`HARSH_MANEUVER_G_FORCE_${currentG.toFixed(2)}G`);
    }

    if (tier === 'TIER_1_KINEMATICS') {
      return {
        tier,
        confidenceScore: 0.96,
        detectedAnomalies: anomalies,
        kinematics: {
          currentSpeedKmh: currentSpeed,
          accelerationG: currentG,
          totalSegmentDistanceMeters: Number(totalDistMeters.toFixed(1)),
          headingVariance: Number(headingVariance.toFixed(1)),
        },
        safetyCorridorBreached: anomalies.length > 0,
      };
    }

    // --- TIER 2: Safety Corridor Geofencing & Engine Stress ---
    let safetyCorridorBreached = false;
    if (lastPoint.engineLoadPct && lastPoint.engineLoadPct >= maxThermal) {
      anomalies.push(`ENGINE_THERMAL_STRESS_${lastPoint.engineLoadPct}%`);
    }
    if (headingVariance > 45) {
      anomalies.push('ERRATIC_DIRECTIONAL_OSCILLATION');
      safetyCorridorBreached = true;
    }

    if (tier === 'TIER_2_SAFETY_CORRIDOR') {
      return {
        tier,
        confidenceScore: 0.98,
        detectedAnomalies: anomalies,
        kinematics: {
          currentSpeedKmh: currentSpeed,
          accelerationG: currentG,
          totalSegmentDistanceMeters: Number(totalDistMeters.toFixed(1)),
          headingVariance: Number(headingVariance.toFixed(1)),
        },
        safetyCorridorBreached: safetyCorridorBreached || anomalies.length > 0,
        tacticalRecommendation:
          anomalies.length > 0 ? 'ADVISE_CRUISE_THROTTLE_REDUCTION' : 'CORRIDOR_OPTIMAL',
      };
    }

    // --- TIER 3 & TIER 4: Deep Anomaly Fusion & Tactical Full Cockpit AI ---
    const isTurboActive = evaluation.turboBoostLevel === 'TURBO_MAX' || evaluation.turboBoostLevel === 'SPORT';
    const deepInsights: Record<string, unknown> = {
      turboBoostLevel: evaluation.turboBoostLevel,
      powerDosingRatio: evaluation.powerDosingRatio,
      estimatedFuelFlowRatePct: isTurboActive ? 85 : 35,
      powertrainThermalMarginDegC: isTurboActive ? 18 : 45,
      brakingEnergyRecoveryKWh: Number((totalDistMeters * 0.00004).toFixed(3)),
    };

    let tacticalRecommendation = 'POWERTRAIN_NOMINAL';
    if (tier === 'TIER_4_FULL_COCKPIT_AI') {
      if (currentSpeed >= 120 && headingVariance > 30) {
        tacticalRecommendation = 'TACTICAL_STABILITY_ALERT_REDUCE_YAW';
      } else if (evaluation.turboBoostLevel === 'TURBO_MAX') {
        tacticalRecommendation = 'MAX_EFFORT_BURST_ENGAGED_MAINTAIN_TRAJECTORY';
      } else {
        tacticalRecommendation = 'OPTIMAL_AUTONOMOUS_ENERGY_HARVESTING';
      }
    } else {
      tacticalRecommendation = anomalies.length > 0 ? 'ADVISE_STABILIZATION' : 'SPORT_MODE_ENGAGED';
    }

    return {
      tier,
      confidenceScore: 0.99,
      detectedAnomalies: anomalies,
      kinematics: {
        currentSpeedKmh: currentSpeed,
        accelerationG: currentG,
        totalSegmentDistanceMeters: Number(totalDistMeters.toFixed(1)),
        headingVariance: Number(headingVariance.toFixed(1)),
      },
      safetyCorridorBreached: safetyCorridorBreached || anomalies.length > 0,
      tacticalRecommendation,
      deepInsights,
    };
  }

  private calculateHeadingVariance(headings: readonly number[]): number {
    if (headings.length <= 1) return 0;
    let sumDiff = 0;
    for (let i = 1; i < headings.length; i++) {
      let diff = Math.abs(headings[i]! - headings[i - 1]!);
      if (diff > 180) diff = 360 - diff;
      sumDiff += diff;
    }
    return sumDiff / (headings.length - 1);
  }
}
