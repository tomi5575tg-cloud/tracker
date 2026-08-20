import type { Position } from '../geojson/types.js';
import type { InertialMotionReading } from '../resilience/types.js';

/**
 * Provenance of a GNSS sample. SIMULATED is a first-class, labeled source —
 * never disguised as LIVE_GNSS.
 */
export type GnssSourceKind = 'LIVE_GNSS' | 'SIMULATED' | 'INERTIAL_DEAD_RECKONING' | 'LAST_KNOWN';

export interface GnssFix {
  readonly timestamp: number;
  readonly coordinate: Position;
  readonly source: GnssSourceKind;
  readonly speedKmh?: number | undefined;
  readonly headingDeg?: number | undefined;
  readonly accuracyMeters?: number | undefined;
}

export interface GnssPort {
  readonly kind: GnssSourceKind;
  start(onFix: (fix: GnssFix) => void, onError: (error: Error) => void): void;
  stop(): void;
}

export interface InertialPort {
  start(onReading: (reading: InertialMotionReading) => void, onError: (error: Error) => void): void;
  stop(): void;
}

export interface HardwareBusStatus {
  readonly gnssKind: GnssSourceKind;
  readonly gnssRunning: boolean;
  readonly inertialRunning: boolean;
  readonly lastFix: GnssFix | null;
  readonly lastError: string | null;
}
