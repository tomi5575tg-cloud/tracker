import type {
  TurboBoostLevel,
  UnitLoadLevel,
  AiAnalysisTier,
  PowerDosingEvaluation,
  TelemetryPointPayload,
} from './types.js';

export interface AdaptiveSamplerConfig {
  /**
   * Minimal sampling interval in ms at maximum speed/turbo (default: 200ms)
   */
  readonly minSamplingIntervalMs?: number | undefined;
  /**
   * Maximum sampling interval in ms at standstill/idle (default: 5000ms)
   */
  readonly maxSamplingIntervalMs?: number | undefined;
  /**
   * Idle speed threshold in km/h (default: 3 km/h)
   */
  readonly idleSpeedThresholdKmh?: number | undefined;
  /**
   * Cruise speed threshold in km/h (default: 50 km/h)
   */
  readonly cruiseSpeedThresholdKmh?: number | undefined;
  /**
   * Sport speed threshold in km/h (default: 90 km/h)
   */
  readonly sportSpeedThresholdKmh?: number | undefined;
  /**
   * Turbo Max speed threshold in km/h (default: 130 km/h)
   */
  readonly turboMaxSpeedThresholdKmh?: number | undefined;
  /**
   * High unit load threshold percentage (default: 80%)
   */
  readonly highLoadThresholdPct?: number | undefined;
  /**
   * Critical unit load threshold percentage (default: 95%)
   */
  readonly criticalLoadThresholdPct?: number | undefined;
}

/**
 * AdaptiveSampler & PowerThrottler:
 * Translates titanium potentiometer hardware telemetry & unit load into software-controlled
 * dynamic power dosing, sampling frequency, and batch limits.
 */
export class AdaptiveSampler {
  private readonly config: Required<AdaptiveSamplerConfig>;

  constructor(config: AdaptiveSamplerConfig = {}) {
    this.config = {
      minSamplingIntervalMs: config.minSamplingIntervalMs ?? 200,
      maxSamplingIntervalMs: config.maxSamplingIntervalMs ?? 5000,
      idleSpeedThresholdKmh: config.idleSpeedThresholdKmh ?? 3,
      cruiseSpeedThresholdKmh: config.cruiseSpeedThresholdKmh ?? 50,
      sportSpeedThresholdKmh: config.sportSpeedThresholdKmh ?? 90,
      turboMaxSpeedThresholdKmh: config.turboMaxSpeedThresholdKmh ?? 130,
      highLoadThresholdPct: config.highLoadThresholdPct ?? 80,
      criticalLoadThresholdPct: config.criticalLoadThresholdPct ?? 95,
    };
  }

  /**
   * Evaluates Turbo Boost level based on vehicle kinematics (speed, throttle, RPM, g-force).
   */
  public determineTurboBoostLevel(point: TelemetryPointPayload): TurboBoostLevel {
    const speed = point.speedKmh ?? 0;
    const throttle = point.throttlePct ?? 0;
    const gForce = Math.abs(point.gForce ?? 0);

    const turboMaxSpeed = this.config.turboMaxSpeedThresholdKmh ?? 130;
    const sportSpeed = this.config.sportSpeedThresholdKmh ?? 90;
    const cruiseSpeed = this.config.cruiseSpeedThresholdKmh ?? 50;
    const idleSpeed = this.config.idleSpeedThresholdKmh ?? 3;

    if (speed >= turboMaxSpeed || throttle >= 95 || gForce >= 1.5) {
      return 'TURBO_MAX';
    }
    if (speed >= sportSpeed || throttle >= 75 || gForce >= 0.8) {
      return 'SPORT';
    }
    if (speed >= cruiseSpeed || throttle >= 30) {
      return 'CRUISE';
    }
    if (speed > idleSpeed || throttle > 5) {
      return 'ECO';
    }
    return 'IDLE';
  }

  /**
   * Evaluates unit load level based on engine/hardware load percentage.
   */
  public determineUnitLoadLevel(unitLoadPct: number = 0): UnitLoadLevel {
    const critLoad = this.config.criticalLoadThresholdPct ?? 95;
    const highLoad = this.config.highLoadThresholdPct ?? 80;

    if (unitLoadPct >= critLoad) {
      return 'CRITICAL';
    }
    if (unitLoadPct >= highLoad) {
      return 'HIGH';
    }
    if (unitLoadPct >= 35) {
      return 'NORMAL';
    }
    return 'LOW';
  }

  /**
   * Resolves target AI analysis tier based on Turbo Boost & Unit Load.
   */
  public determineAiAnalysisTier(turbo: TurboBoostLevel, load: UnitLoadLevel): AiAnalysisTier {
    // If unit is in critical overload, protect throughput by capping heavy deep models
    if (load === 'CRITICAL' && turbo !== 'TURBO_MAX') {
      return 'TIER_1_KINEMATICS';
    }

    switch (turbo) {
      case 'TURBO_MAX':
        return 'TIER_4_FULL_COCKPIT_AI';
      case 'SPORT':
        return 'TIER_3_DEEP_ANOMALY';
      case 'CRUISE':
        return 'TIER_2_SAFETY_CORRIDOR';
      case 'ECO':
        return 'TIER_1_KINEMATICS';
      case 'IDLE':
      default:
        return 'TIER_0_RAW_INGEST';
    }
  }

  /**
   * Calculates dynamic power dosing ratio, sampling rate, and batch constraints.
   */
  public evaluatePowerDosing(
    point: TelemetryPointPayload,
    unitLoadPct: number = 0
  ): PowerDosingEvaluation {
    const turboBoostLevel = this.determineTurboBoostLevel(point);
    const unitLoadLevel = this.determineUnitLoadLevel(unitLoadPct);
    const targetAiTier = this.determineAiAnalysisTier(turboBoostLevel, unitLoadLevel);

    let powerRatio: number;
    let samplingMs: number;
    let maxBatchSize: number;
    let alertPriority: PowerDosingEvaluation['alertPriority'];

    const minSampling = this.config.minSamplingIntervalMs ?? 200;
    const maxSampling = this.config.maxSamplingIntervalMs ?? 5000;

    switch (turboBoostLevel) {
      case 'TURBO_MAX':
        powerRatio = 1.0;
        samplingMs = minSampling;
        maxBatchSize = 100;
        alertPriority = 'CRITICAL';
        break;
      case 'SPORT':
        powerRatio = 0.8;
        samplingMs = Math.max(minSampling, 500);
        maxBatchSize = 50;
        alertPriority = 'HIGH';
        break;
      case 'CRUISE':
        powerRatio = 0.55;
        samplingMs = 1000;
        maxBatchSize = 30;
        alertPriority = 'NORMAL';
        break;
      case 'ECO':
        powerRatio = 0.3;
        samplingMs = 2500;
        maxBatchSize = 20;
        alertPriority = 'LOW';
        break;
      case 'IDLE':
      default:
        powerRatio = 0.1;
        samplingMs = maxSampling;
        maxBatchSize = 10;
        alertPriority = 'LOW';
        break;
    }

    // High unit load throttling: slightly throttle batch sizes and increase interval if overloaded
    if (unitLoadLevel === 'CRITICAL') {
      samplingMs = Math.min(maxSampling, samplingMs * 2);
      maxBatchSize = Math.max(5, Math.floor(maxBatchSize / 2));
    } else if (unitLoadLevel === 'HIGH') {
      samplingMs = Math.min(maxSampling, Math.floor(samplingMs * 1.3));
    }

    return {
      turboBoostLevel,
      unitLoadLevel,
      samplingIntervalMs: samplingMs,
      maxBatchSize,
      targetAiTier,
      powerDosingRatio: Number(powerRatio.toFixed(2)),
      compressionEnabled: turboBoostLevel === 'TURBO_MAX' || unitLoadLevel === 'HIGH' || unitLoadLevel === 'CRITICAL',
      alertPriority,
    };
  }

  /**
   * Filters a stream of raw telemetry points using adaptive velocity-aware decimation.
   * Preserves critical directional turns, sudden stops, high-g events, or turbo bursts.
   */
  public filterStream(
    points: readonly TelemetryPointPayload[],
    evaluation: PowerDosingEvaluation
  ): TelemetryPointPayload[] {
    if (points.length <= 2) {
      return [...points];
    }

    const result: TelemetryPointPayload[] = [];
    let lastKept = points[0]!;
    result.push(lastKept);

    const minTimeDeltaMs = evaluation.samplingIntervalMs * 0.8;

    for (let i = 1; i < points.length - 1; i++) {
      const curr = points[i]!;
      const timeDelta = curr.timestamp - lastKept.timestamp;

      // Always preserve high-g or extreme throttle events (Turbo spikes)
      const isExtremeG = Math.abs(curr.gForce ?? 0) >= 0.7;
      const isExtremeThrottle = (curr.throttlePct ?? 0) >= 90;

      // Significant heading change (> 15 deg)
      const headingDiff =
        lastKept.headingDeg !== undefined && curr.headingDeg !== undefined
          ? Math.abs(curr.headingDeg - lastKept.headingDeg)
          : 0;
      const isSignificantTurn = headingDiff > 15 && headingDiff < 345;

      if (isExtremeG || isExtremeThrottle || isSignificantTurn || timeDelta >= minTimeDeltaMs) {
        result.push(curr);
        lastKept = curr;
      }
    }

    // Always preserve last point in batch
    result.push(points[points.length - 1]!);
    return result;
  }
}
