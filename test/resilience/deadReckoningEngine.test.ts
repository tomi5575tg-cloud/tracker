import { describe, it, expect } from 'vitest';
import { DeadReckoningEngine } from '../../src/resilience/deadReckoningEngine.js';

describe('DeadReckoningEngine', () => {
  it('should maintain 100% confidence when receiving regular GPS fixes', () => {
    const dr = new DeadReckoningEngine([21.0122, 52.2297], { gpsLossTimeoutMs: 1000 });
    const now = Date.now();

    dr.updateGpsFix([21.0130, 52.2300], 60, 45, now);
    const state = dr.tick(now + 200);

    expect(state.isExtrapolating).toBe(false);
    expect(state.extrapolationConfidencePct).toBe(100);
    expect(state.estimatedCoordinate).toEqual([21.0130, 52.2300]);
    expect(state.currentSpeedKmh).toBe(60);
    expect(state.currentHeadingDeg).toBe(45);
  });

  it('should automatically extrapolate coordinates and decay confidence when GPS is lost', () => {
    const dr = new DeadReckoningEngine([21.0122, 52.2297], {
      gpsLossTimeoutMs: 1000,
      maxExtrapolationDurationMs: 60000,
    });
    const t0 = 100000;

    // Start with 120 km/h heading East (90 deg)
    dr.updateGpsFix([21.0122, 52.2297], 120, 90, t0);

    // Advance by 5000ms (5 seconds without GPS)
    const t1 = t0 + 5000;
    const state = dr.tick(t1);

    expect(state.isExtrapolating).toBe(true);
    expect(state.extrapolatedDurationMs).toBe(5000);
    expect(state.totalExtrapolatedDistanceMeters).toBeGreaterThan(100); // 120 km/h ~ 33.3 m/s * 4s = ~133m
    expect(state.estimatedCoordinate[0]).toBeGreaterThan(21.0122); // Extrapolated eastward
    expect(state.extrapolationConfidencePct).toBeLessThan(100);
    expect(state.extrapolationConfidencePct).toBeGreaterThan(0);
  });

  it('should fuse IMU yaw rate to update heading during Dead Reckoning', () => {
    const dr = new DeadReckoningEngine([21.0, 52.0], { gpsLossTimeoutMs: 500 });
    const t0 = 1000;

    dr.updateGpsFix([21.0, 52.0], 50, 0, t0); // Heading North (0 deg)

    // Ingest IMU yaw rate (turning right at 10 deg/sec for 3 seconds)
    const t1 = t0 + 3000;
    const state = dr.updateInertialReading({
      timestamp: t1,
      yawRateDegPerSec: 10,
    });

    expect(state.currentHeadingDeg).toBeCloseTo(30, 0);
  });

  it('should reconcile and reset extrapolation when fresh GPS fix arrives', () => {
    const dr = new DeadReckoningEngine([21.0, 52.0], { gpsLossTimeoutMs: 500 });
    const t0 = 1000;

    dr.updateGpsFix([21.0, 52.0], 100, 90, t0);
    dr.tick(t0 + 5000); // Lost GPS for 5 sec

    expect(dr.getState().isExtrapolating).toBe(true);

    // GPS returns
    dr.updateGpsFix([21.05, 52.01], 80, 85, t0 + 6000);
    const restoredState = dr.tick(t0 + 6000);

    expect(restoredState.isExtrapolating).toBe(false);
    expect(restoredState.extrapolationConfidencePct).toBe(100);
    expect(restoredState.estimatedCoordinate).toEqual([21.05, 52.01]);
  });
});
