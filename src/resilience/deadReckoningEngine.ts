import type { Position } from '../geojson/types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import type { DeadReckoningState, InertialMotionReading } from './types.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface DeadReckoningConfig {
  /**
   * Timeout in ms after which lack of GPS triggers Dead Reckoning (default: 2500ms)
   */
  readonly gpsLossTimeoutMs?: number | undefined;
  /**
   * Maximum duration in ms before confidence drops to 0% (default: 180000ms - 3 minutes)
   */
  readonly maxExtrapolationDurationMs?: number | undefined;
  /**
   * Speed decay factor per second when zero motion inputs are received (default: 0.98)
   */
  readonly speedDecayPerSec?: number | undefined;
}

/**
 * DeadReckoningEngine:
 * Inertial extrapolation & dead reckoning navigation engine.
 *
 * Guarantees that GPS loss or satellite denial (e.g. tunnels, urban canyons, EW jamming)
 * never halts route guidance or position estimation.
 *
 * Features:
 * 1. Automatic GPS loss detection and seamless switch to inertial kinematic projection.
 * 2. High-precision Geodetic Great-Circle projection (`destinationPoint`).
 * 3. Confidence score decay modeling based on elapsed time without absolute fixes.
 * 4. Fuses wheel speed / IMU yaw rate if available, falling back to last-known kinematics.
 * 5. Instant reconciliation when fresh GPS fixes arrive.
 */
export class DeadReckoningEngine implements SessionDrainHook {
  private readonly config: Required<DeadReckoningConfig>;

  private lastGpsPosition: Position;
  private lastGpsTimestamp: number;
  private lastKnownSpeedKmh: number;
  private lastKnownHeadingDeg: number;

  private currentEstimatedPosition: Position;
  private currentSpeedKmh: number;
  private currentHeadingDeg: number;
  private lastExtrapolationTimestamp: number;
  private totalExtrapolatedMeters = 0;
  private isExtrapolating = false;

  constructor(
    initialPosition: Position = [21.0122, 52.2297],
    config: DeadReckoningConfig = {}
  ) {
    this.config = {
      gpsLossTimeoutMs: config.gpsLossTimeoutMs ?? 2500,
      maxExtrapolationDurationMs: config.maxExtrapolationDurationMs ?? 180000,
      speedDecayPerSec: config.speedDecayPerSec ?? 0.98,
    };

    const now = Date.now();
    this.lastGpsPosition = [...initialPosition];
    this.currentEstimatedPosition = [...initialPosition];
    this.lastGpsTimestamp = now;
    this.lastExtrapolationTimestamp = now;
    this.lastKnownSpeedKmh = 0;
    this.lastKnownHeadingDeg = 0;
    this.currentSpeedKmh = 0;
    this.currentHeadingDeg = 0;
  }

  /**
   * Ingests a fresh absolute GPS coordinate fix
   */
  public updateGpsFix(
    coordinate: Position,
    speedKmh?: number,
    headingDeg?: number,
    timestamp: number = Date.now()
  ): void {
    this.lastGpsPosition = [coordinate[0], coordinate[1]];
    this.currentEstimatedPosition = [coordinate[0], coordinate[1]];
    this.lastGpsTimestamp = timestamp;
    this.lastExtrapolationTimestamp = timestamp;

    if (speedKmh !== undefined) {
      this.lastKnownSpeedKmh = Math.max(0, speedKmh);
      this.currentSpeedKmh = this.lastKnownSpeedKmh;
    }
    if (headingDeg !== undefined) {
      this.lastKnownHeadingDeg = (headingDeg + 360) % 360;
      this.currentHeadingDeg = this.lastKnownHeadingDeg;
    }

    this.totalExtrapolatedMeters = 0;
    this.isExtrapolating = false;
  }

  /**
   * Ingests inertial sensor readings (IMU accelerometer, gyroscope yaw rate, wheel speed)
   */
  public updateInertialReading(reading: InertialMotionReading): DeadReckoningState {
    const now = reading.timestamp;
    const dtSeconds = Math.max(0, (now - this.lastExtrapolationTimestamp) / 1000);

    if (reading.speedKmh !== undefined) {
      this.currentSpeedKmh = Math.max(0, reading.speedKmh);
    }
    if (reading.headingDeg !== undefined) {
      this.currentHeadingDeg = (reading.headingDeg + 360) % 360;
    } else if (reading.yawRateDegPerSec !== undefined) {
      this.currentHeadingDeg = (this.currentHeadingDeg + reading.yawRateDegPerSec * dtSeconds + 360) % 360;
    }

    return this.tick(now);
  }

  /**
   * Evaluates current dead reckoning navigation state and steps position forward if GPS is lost.
   */
  public tick(currentTime: number = Date.now()): DeadReckoningState {
    const elapsedSinceGps = currentTime - this.lastGpsTimestamp;
    const dtSeconds = Math.max(0, (currentTime - this.lastExtrapolationTimestamp) / 1000);

    const lossTimeout = this.config.gpsLossTimeoutMs ?? 2500;
    const decay = this.config.speedDecayPerSec ?? 0.98;

    if (elapsedSinceGps >= lossTimeout) {
      this.isExtrapolating = true;

      if (dtSeconds > 0 && this.currentSpeedKmh > 0.1) {
        // Distance traveled in dt: (speed in km/h) * (1000m / 3600s) * dt
        const speedMps = (this.currentSpeedKmh * 1000) / 3600;
        const distMeters = speedMps * dtSeconds;

        this.currentEstimatedPosition = GeoSpatialUtils.destinationPoint(
          this.currentEstimatedPosition,
          this.currentHeadingDeg,
          distMeters
        );

        this.totalExtrapolatedMeters += distMeters;

        // Apply slight kinematic decay if no active throttle/speed inputs
        this.currentSpeedKmh *= Math.pow(decay, dtSeconds);
      }
    } else {
      this.isExtrapolating = false;
    }

    this.lastExtrapolationTimestamp = currentTime;

    const confidencePct = this.calculateConfidence(elapsedSinceGps);

    return {
      estimatedCoordinate: [this.currentEstimatedPosition[0], this.currentEstimatedPosition[1]],
      lastKnownGpsCoordinate: [this.lastGpsPosition[0], this.lastGpsPosition[1]],
      currentSpeedKmh: Number(this.currentSpeedKmh.toFixed(1)),
      currentHeadingDeg: Number(this.currentHeadingDeg.toFixed(1)),
      extrapolationConfidencePct: confidencePct,
      extrapolatedDurationMs: this.isExtrapolating ? elapsedSinceGps : 0,
      totalExtrapolatedDistanceMeters: Number(this.totalExtrapolatedMeters.toFixed(1)),
      isExtrapolating: this.isExtrapolating,
    };
  }

  public getState(): DeadReckoningState {
    return this.tick(Date.now());
  }

  /**
   * Resets position and navigation state
   */
  public reset(position: Position = [21.0122, 52.2297]): void {
    const now = Date.now();
    this.lastGpsPosition = [...position];
    this.currentEstimatedPosition = [...position];
    this.lastGpsTimestamp = now;
    this.lastExtrapolationTimestamp = now;
    this.lastKnownSpeedKmh = 0;
    this.lastKnownHeadingDeg = 0;
    this.currentSpeedKmh = 0;
    this.currentHeadingDeg = 0;
    this.totalExtrapolatedMeters = 0;
    this.isExtrapolating = false;
  }

  /**
   * PANIC/DRAIN: SessionDrainHook implementation
   */
  public drain(_reason = 'DEAD_RECKONING_DRAIN', _previousSession?: unknown): void {
    this.reset();
  }

  public destroy(): void {
    this.reset();
  }

  private calculateConfidence(elapsedSinceGpsMs: number): number {
    const lossTimeout = this.config.gpsLossTimeoutMs ?? 2500;
    if (elapsedSinceGpsMs < lossTimeout) {
      return 100;
    }
    const maxDur = this.config.maxExtrapolationDurationMs ?? 180000;
    const remainingRatio = Math.max(0, 1 - (elapsedSinceGpsMs - lossTimeout) / maxDur);
    return Math.round(remainingRatio * 90); // max 90% during dead reckoning, down to 0%
  }
}
