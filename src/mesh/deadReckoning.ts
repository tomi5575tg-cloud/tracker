import type { Position } from '../geojson/types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import {
  PositioningSource,
  type TelemetryFix,
  type DeadReckoningConfig,
  type DeadReckoningState,
} from './types.js';

export interface TelemetryDeadReckoningOptions {
  readonly config?: Partial<DeadReckoningConfig> | undefined;
  readonly routeCoordinates?: readonly Position[] | undefined;
  readonly onGpsLost?: ((lastFix: TelemetryFix) => void) | undefined;
  readonly onGpsRestored?: ((newFix: TelemetryFix, outageDurationMs: number) => void) | undefined;
}

export class TelemetryDeadReckoning {
  private readonly config: Required<DeadReckoningConfig>;
  private lastValidatedFix: TelemetryFix | null = null;
  private routeCoordinates: Position[] = [];
  private isCurrentlyExtrapolating = false;
  private extrapolationStartTime: number | null = null;
  private readonly onGpsLost?: ((lastFix: TelemetryFix) => void) | undefined;
  private readonly onGpsRestored?: ((newFix: TelemetryFix, outageDurationMs: number) => void) | undefined;

  constructor(options: TelemetryDeadReckoningOptions = {}) {
    this.config = {
      maxExtrapolationDurationMs: options.config?.maxExtrapolationDurationMs ?? 60000, // 60s
      velocityDecayFactorPerSec: options.config?.velocityDecayFactorPerSec ?? 0.98,
      maxUncertaintyRadiusMeters: options.config?.maxUncertaintyRadiusMeters ?? 500,
      uncertaintyGrowthRateMps: options.config?.uncertaintyGrowthRateMps ?? 2.5,
      minMovementSpeedKmh: options.config?.minMovementSpeedKmh ?? 1.5,
    };

    if (options.routeCoordinates) {
      this.setRouteCoordinates(options.routeCoordinates);
    }

    this.onGpsLost = options.onGpsLost;
    this.onGpsRestored = options.onGpsRestored;
  }

  public setRouteCoordinates(coordinates: readonly Position[]): void {
    this.routeCoordinates = coordinates.slice() as Position[];
  }

  public getRouteCoordinates(): readonly Position[] {
    return this.routeCoordinates;
  }

  /**
   * Ingests a new validated GPS fix.
   */
  public updateFix(fix: TelemetryFix): void {
    if (this.isCurrentlyExtrapolating && this.lastValidatedFix) {
      const outageDuration = fix.timestamp - this.lastValidatedFix.timestamp;
      this.isCurrentlyExtrapolating = false;
      this.extrapolationStartTime = null;
      this.onGpsRestored?.(fix, outageDuration);
    }

    this.lastValidatedFix = fix;
  }

  /**
   * Returns current positioning state (either raw fix or extrapolated dead reckoning position).
   */
  public getCurrentState(nowMs: number = Date.now()): DeadReckoningState {
    if (!this.lastValidatedFix) {
      // Default safe haven (Warsaw center or zero) if no fix was ever received
      const defaultFix: TelemetryFix = {
        position: [21.0122, 52.2297],
        speedKmh: 0,
        headingDegrees: 0,
        accuracyMeters: 1000,
        timestamp: nowMs,
        source: PositioningSource.LAST_KNOWN,
      };
      return {
        currentFix: defaultFix,
        isExtrapolated: false,
        extrapolationDurationMs: 0,
        uncertaintyRadiusMeters: 1000,
        originalFix: defaultFix,
      };
    }

    const elapsedMs = Math.max(0, nowMs - this.lastValidatedFix.timestamp);

    // If fix is recent (< 2500ms), consider it live
    if (elapsedMs < 2500) {
      return {
        currentFix: this.lastValidatedFix,
        isExtrapolated: false,
        extrapolationDurationMs: 0,
        uncertaintyRadiusMeters: this.lastValidatedFix.accuracyMeters,
        originalFix: this.lastValidatedFix,
      };
    }

    // Fix is stale: trigger dead reckoning extrapolation
    if (!this.isCurrentlyExtrapolating) {
      this.isCurrentlyExtrapolating = true;
      this.extrapolationStartTime = this.lastValidatedFix.timestamp;
      this.onGpsLost?.(this.lastValidatedFix);
    }

    const extrapolationDurationMs = elapsedMs;
    const elapsedSeconds = extrapolationDurationMs / 1000;

    // If extrapolation exceeds max duration, lock into stationary LAST_KNOWN mode
    if (extrapolationDurationMs >= this.config.maxExtrapolationDurationMs) {
      const maxExtrapolatedFix = this.extrapolatePosition(
        this.lastValidatedFix,
        this.config.maxExtrapolationDurationMs / 1000,
        nowMs
      );

      const stationaryFix: TelemetryFix = {
        ...maxExtrapolatedFix,
        speedKmh: 0,
        timestamp: nowMs,
        source: PositioningSource.LAST_KNOWN,
      };

      return {
        currentFix: stationaryFix,
        isExtrapolated: true,
        extrapolationDurationMs,
        uncertaintyRadiusMeters: this.config.maxUncertaintyRadiusMeters,
        originalFix: this.lastValidatedFix,
      };
    }

    // Compute active dead reckoning position
    const currentExtrapolatedFix = this.extrapolatePosition(
      this.lastValidatedFix,
      elapsedSeconds,
      nowMs
    );

    const uncertainty = Math.min(
      this.config.maxUncertaintyRadiusMeters,
      this.lastValidatedFix.accuracyMeters + elapsedSeconds * this.config.uncertaintyGrowthRateMps
    );

    return {
      currentFix: currentExtrapolatedFix,
      isExtrapolated: true,
      extrapolationDurationMs,
      uncertaintyRadiusMeters: uncertainty,
      originalFix: this.lastValidatedFix,
    };
  }

  /**
   * Internal extrapolation math using kinematic formulas, velocity decay, and geodetic destination point
   */
  private extrapolatePosition(
    startFix: TelemetryFix,
    elapsedSeconds: number,
    nowMs: number
  ): TelemetryFix {
    const initialSpeedMps = (startFix.speedKmh * 1000) / 3600;

    // If speed is below movement threshold, vehicle is stationary
    if (startFix.speedKmh < this.config.minMovementSpeedKmh || initialSpeedMps < 0.1) {
      return {
        position: startFix.position,
        altitudeMeters: startFix.altitudeMeters,
        speedKmh: 0,
        headingDegrees: startFix.headingDegrees,
        accuracyMeters: Math.min(
          this.config.maxUncertaintyRadiusMeters,
          startFix.accuracyMeters + elapsedSeconds * 0.5
        ),
        timestamp: nowMs,
        source: PositioningSource.DEAD_RECKONING,
      };
    }

    // Exponential velocity decay integral: distance = initialSpeed * (1 - decay^t) / -ln(decay)
    const decay = this.config.velocityDecayFactorPerSec;
    let distanceMeters: number;
    let currentSpeedMps: number;

    if (decay >= 1 || Math.abs(decay - 1) < 1e-6) {
      distanceMeters = initialSpeedMps * elapsedSeconds;
      currentSpeedMps = initialSpeedMps;
    } else {
      const lnDecay = Math.log(decay);
      distanceMeters = initialSpeedMps * ((1 - Math.pow(decay, elapsedSeconds)) / -lnDecay);
      currentSpeedMps = initialSpeedMps * Math.pow(decay, elapsedSeconds);
    }

    const currentSpeedKmh = (currentSpeedMps * 3600) / 1000;

    // Check if we can follow the active route corridor forward
    let predictedPosition: Position;
    let predictedHeading = startFix.headingDegrees;
    let source = PositioningSource.DEAD_RECKONING;

    if (this.routeCoordinates.length >= 2) {
      const snapped = this.extrapolateAlongRoute(startFix.position, distanceMeters);
      if (snapped) {
        predictedPosition = snapped.position;
        predictedHeading = snapped.heading;
        source = PositioningSource.ROUTE_SNAPPED;
      } else {
        predictedPosition = GeoSpatialUtils.destinationPoint(
          startFix.position,
          startFix.headingDegrees,
          distanceMeters
        );
      }
    } else {
      predictedPosition = GeoSpatialUtils.destinationPoint(
        startFix.position,
        startFix.headingDegrees,
        distanceMeters
      );
    }

    return {
      position: predictedPosition,
      altitudeMeters: startFix.altitudeMeters,
      speedKmh: Math.max(0, currentSpeedKmh),
      headingDegrees: predictedHeading,
      accuracyMeters: Math.min(
        this.config.maxUncertaintyRadiusMeters,
        startFix.accuracyMeters + elapsedSeconds * this.config.uncertaintyGrowthRateMps
      ),
      timestamp: nowMs,
      source,
    };
  }

  /**
   * Follows route polyline vertices forward by remaining distanceMeters
   */
  private extrapolateAlongRoute(
    currentPos: Position,
    distanceMeters: number
  ): { position: Position; heading: number } | null {
    if (this.routeCoordinates.length < 2) return null;

    // Find nearest segment on the route
    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < this.routeCoordinates.length; i++) {
      const coord = this.routeCoordinates[i];
      if (!coord) continue;
      const d = GeoSpatialUtils.haversineDistance(currentPos, coord);
      if (d < minDistance) {
        minDistance = d;
        closestIndex = i;
      }
    }

    // If nearest point is too far (> 300m), corridor snap is unreliable
    if (minDistance > 300) return null;

    let remainingDist = distanceMeters;
    let curPoint = this.routeCoordinates[closestIndex] ?? currentPos;
    let curIndex = closestIndex;
    let finalHeading = 0;

    while (curIndex < this.routeCoordinates.length - 1 && remainingDist > 0) {
      const nextPoint = this.routeCoordinates[curIndex + 1];
      if (!nextPoint) break;

      const segLen = GeoSpatialUtils.haversineDistance(curPoint, nextPoint);
      finalHeading = GeoSpatialUtils.calculateBearing(curPoint, nextPoint);

      if (remainingDist <= segLen) {
        curPoint = GeoSpatialUtils.destinationPoint(curPoint, finalHeading, remainingDist);
        remainingDist = 0;
        break;
      } else {
        remainingDist -= segLen;
        curPoint = nextPoint;
        curIndex++;
      }
    }

    return {
      position: curPoint,
      heading: finalHeading,
    };
  }

  public reset(): void {
    this.lastValidatedFix = null;
    this.isCurrentlyExtrapolating = false;
    this.extrapolationStartTime = null;
  }

  public getExtrapolationStartTime(): number | null {
    return this.extrapolationStartTime;
  }

  public getLastValidatedFix(): TelemetryFix | null {
    return this.lastValidatedFix;
  }

  public getConfig(): Required<DeadReckoningConfig> {
    return { ...this.config };
  }
}
