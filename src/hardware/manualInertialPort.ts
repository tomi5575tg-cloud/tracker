import type { InertialMotionReading } from '../resilience/types.js';
import type { InertialPort } from './types.js';

export interface ManualInertialPortConfig {
  readonly clock?: (() => number) | undefined;
}

/**
 * Explicit IMU ingest. DeviceMotion can feed push(); tests inject kinematics
 * without pretending a browser sensor exists.
 */
export class ManualInertialPort implements InertialPort {
  private readonly clock: () => number;
  private onReading: ((reading: InertialMotionReading) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private running = false;

  constructor(config: ManualInertialPortConfig = {}) {
    this.clock = config.clock ?? (() => Date.now());
  }

  public start(
    onReading: (reading: InertialMotionReading) => void,
    onError: (error: Error) => void
  ): void {
    this.onReading = onReading;
    this.onError = onError;
    this.running = true;
  }

  public stop(): void {
    this.running = false;
    this.onReading = null;
    this.onError = null;
  }

  public push(partial: Omit<InertialMotionReading, 'timestamp'> & { timestamp?: number | undefined }): void {
    if (!this.running || !this.onReading) {
      this.onError?.(new Error('ManualInertialPort.push called while stopped'));
      return;
    }
    this.onReading({
      timestamp: partial.timestamp ?? this.clock(),
      ...(partial.speedKmh !== undefined ? { speedKmh: partial.speedKmh } : {}),
      ...(partial.headingDeg !== undefined ? { headingDeg: partial.headingDeg } : {}),
      ...(partial.yawRateDegPerSec !== undefined ? { yawRateDegPerSec: partial.yawRateDegPerSec } : {}),
      ...(partial.accelerationForwardG !== undefined
        ? { accelerationForwardG: partial.accelerationForwardG }
        : {}),
      ...(partial.wheelTicksDelta !== undefined ? { wheelTicksDelta: partial.wheelTicksDelta } : {}),
    });
  }
}
