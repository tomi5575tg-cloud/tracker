import type { Position } from '../geojson/types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import type { GnssFix, GnssPort } from './types.js';

export interface SimulatedGnssConfig {
  readonly startCoordinate?: Position | undefined;
  readonly headingDeg?: number | undefined;
  readonly speedKmh?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly clock?: (() => number) | undefined;
}

/**
 * Labeled GNSS simulator for environments without a receiver (CI, Cloud Agent VM).
 * HUD and WeldAudit must surface kind === 'SIMULATED'. This is not a live fix.
 */
export class SimulatedGnssPort implements GnssPort {
  public readonly kind = 'SIMULATED' as const;

  private readonly startCoordinate: Position;
  private readonly headingDeg: number;
  private readonly speedKmh: number;
  private readonly intervalMs: number;
  private readonly clock: () => number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private coordinate: Position;
  private lastTick: number;

  constructor(config: SimulatedGnssConfig = {}) {
    this.startCoordinate = config.startCoordinate ?? [21.0122, 52.2297];
    this.headingDeg = config.headingDeg ?? 15;
    this.speedKmh = config.speedKmh ?? 42;
    this.intervalMs = config.intervalMs ?? 1000;
    this.clock = config.clock ?? (() => Date.now());
    this.coordinate = [this.startCoordinate[0], this.startCoordinate[1]];
    this.lastTick = this.clock();
  }

  public start(onFix: (fix: GnssFix) => void, onError: (error: Error) => void): void {
    this.stop();
    try {
      onFix(this.buildFix(this.clock()));
      this.timer = setInterval(() => {
        try {
          onFix(this.step());
        } catch (cause) {
          onError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }, this.intervalMs);
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public injectFix(fix: Omit<GnssFix, 'source'>): GnssFix {
    this.coordinate = [fix.coordinate[0], fix.coordinate[1]];
    this.lastTick = fix.timestamp;
    return { ...fix, source: 'SIMULATED' };
  }

  private step(): GnssFix {
    const now = this.clock();
    const dtSeconds = Math.max(0, (now - this.lastTick) / 1000);
    const distMeters = ((this.speedKmh * 1000) / 3600) * dtSeconds;
    if (distMeters > 0) {
      this.coordinate = GeoSpatialUtils.destinationPoint(this.coordinate, this.headingDeg, distMeters);
    }
    this.lastTick = now;
    return this.buildFix(now);
  }

  private buildFix(timestamp: number): GnssFix {
    return {
      timestamp,
      coordinate: [this.coordinate[0], this.coordinate[1]],
      source: 'SIMULATED',
      speedKmh: this.speedKmh,
      headingDeg: this.headingDeg,
      accuracyMeters: 8,
    };
  }
}
