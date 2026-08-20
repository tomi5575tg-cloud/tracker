import type { SessionDrainHook } from '../auth/drainManager.js';
import { CircuitBreaker } from '../resilience/circuitBreaker.js';
import type { InertialMotionReading } from '../resilience/types.js';
import { HardwarePortError } from '../weld/errors.js';
import type { GnssFix, GnssPort, HardwareBusStatus, InertialPort } from './types.js';

export interface HardwareTelemetryBusConfig {
  readonly gnss: GnssPort;
  readonly inertial?: InertialPort | undefined;
  readonly onFix?: ((fix: GnssFix) => void) | undefined;
  readonly onInertial?: ((reading: InertialMotionReading) => void) | undefined;
  readonly onError?: ((error: Error) => void) | undefined;
  readonly gnssFailureThreshold?: number | undefined;
}

/**
 * Iron hardware base: one GNSS port + optional IMU, gated by a fail-loud breaker.
 * The bus never swaps LIVE_GNSS for SIMULATED on its own.
 */
export class HardwareTelemetryBus implements SessionDrainHook {
  private readonly gnss: GnssPort;
  private readonly inertial: InertialPort | undefined;
  private readonly onFix: ((fix: GnssFix) => void) | undefined;
  private readonly onInertial: ((reading: InertialMotionReading) => void) | undefined;
  private readonly onError: ((error: Error) => void) | undefined;
  private readonly breaker: CircuitBreaker;

  private gnssRunning = false;
  private inertialRunning = false;
  private lastFix: GnssFix | null = null;
  private lastError: string | null = null;

  constructor(config: HardwareTelemetryBusConfig) {
    this.gnss = config.gnss;
    this.inertial = config.inertial;
    this.onFix = config.onFix;
    this.onInertial = config.onInertial;
    this.onError = config.onError;
    this.breaker = new CircuitBreaker({
      name: `GNSS:${config.gnss.kind}`,
      failureThreshold: config.gnssFailureThreshold ?? 3,
    });
  }

  public start(): void {
    this.gnss.start(
      (fix) => {
        try {
          this.breaker.execute(() => {
            this.lastFix = fix;
            this.lastError = null;
            this.onFix?.(fix);
            return fix;
          });
        } catch (cause) {
          this.reportError(cause);
        }
      },
      (error) => {
        try {
          this.breaker.execute(() => {
            throw error;
          });
        } catch (cause) {
          this.reportError(cause);
        }
      }
    );
    this.gnssRunning = true;

    if (this.inertial) {
      this.inertial.start(
        (reading) => {
          this.onInertial?.(reading);
        },
        (error) => this.reportError(new HardwarePortError('IMU', error))
      );
      this.inertialRunning = true;
    }
  }

  public stop(): void {
    this.gnss.stop();
    this.inertial?.stop();
    this.gnssRunning = false;
    this.inertialRunning = false;
  }

  public ingestFix(fix: GnssFix): GnssFix {
    return this.breaker.execute(() => {
      this.lastFix = fix;
      this.lastError = null;
      this.onFix?.(fix);
      return fix;
    });
  }

  public getStatus(): HardwareBusStatus {
    return {
      gnssKind: this.gnss.kind,
      gnssRunning: this.gnssRunning,
      inertialRunning: this.inertialRunning,
      lastFix: this.lastFix,
      lastError: this.lastError,
    };
  }

  public getBreakerState(): ReturnType<CircuitBreaker['getState']> {
    return this.breaker.getState();
  }

  public drain(_reason = 'HARDWARE_BUS_DRAIN', _previousSession?: unknown): void {
    this.stop();
    this.lastFix = null;
    this.lastError = null;
    this.breaker.reset();
  }

  private reportError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new HardwarePortError('GNSS', cause);
    this.lastError = error.message;
    this.onError?.(error);
  }
}
