import { HardwarePortError } from '../weld/errors.js';
import type { GnssFix, GnssPort } from './types.js';

export interface BrowserGnssConfig {
  readonly geolocation?: Geolocation | undefined;
  readonly enableHighAccuracy?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maximumAgeMs?: number | undefined;
}

/**
 * Live GNSS via the Geolocation API. Failures are reported through onError —
 * this port never pretends a simulated fix is a satellite fix.
 */
export class BrowserGnssPort implements GnssPort {
  public readonly kind = 'LIVE_GNSS' as const;

  private readonly geolocation: Geolocation | undefined;
  private readonly enableHighAccuracy: boolean;
  private readonly timeoutMs: number;
  private readonly maximumAgeMs: number;
  private watchId: number | null = null;

  constructor(config: BrowserGnssConfig = {}) {
    this.geolocation = config.geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);
    this.enableHighAccuracy = config.enableHighAccuracy ?? true;
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.maximumAgeMs = config.maximumAgeMs ?? 1000;
  }

  public start(onFix: (fix: GnssFix) => void, onError: (error: Error) => void): void {
    this.stop();
    if (!this.geolocation) {
      onError(new HardwarePortError('LIVE_GNSS', new Error('Geolocation API is not available')));
      return;
    }

    this.watchId = this.geolocation.watchPosition(
      (pos) => {
        const heading = pos.coords.heading;
        const speedMps = pos.coords.speed;
        onFix({
          timestamp: pos.timestamp,
          coordinate: [pos.coords.longitude, pos.coords.latitude],
          source: 'LIVE_GNSS',
          ...(speedMps !== null && Number.isFinite(speedMps)
            ? { speedKmh: Math.max(0, speedMps * 3.6) }
            : {}),
          ...(heading !== null && Number.isFinite(heading) ? { headingDeg: heading } : {}),
          ...(Number.isFinite(pos.coords.accuracy) ? { accuracyMeters: pos.coords.accuracy } : {}),
        });
      },
      (err) => {
        onError(new HardwarePortError('LIVE_GNSS', new Error(err.message || `geolocation error ${err.code}`)));
      },
      {
        enableHighAccuracy: this.enableHighAccuracy,
        timeout: this.timeoutMs,
        maximumAge: this.maximumAgeMs,
      }
    );
  }

  public stop(): void {
    if (this.watchId !== null && this.geolocation) {
      this.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}
