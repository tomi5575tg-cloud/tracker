import { describe, it, expect } from 'vitest';
import { TelemetryDeadReckoning } from '../../src/mesh/deadReckoning.js';
import { PositioningSource, type TelemetryFix } from '../../src/mesh/types.js';
import type { Position } from '../../src/geojson/types.js';

describe('TelemetryDeadReckoning (Uninterrupted Positioning)', () => {
  const initialFix: TelemetryFix = {
    position: [21.0122, 52.2297], // Warsaw center
    speedKmh: 60, // 60 km/h = 16.67 m/s
    headingDegrees: 90, // East
    accuracyMeters: 5,
    timestamp: 1000000,
    source: PositioningSource.GPS_RTK,
  };

  it('should return live fix when GPS update is fresh (< 2500ms)', () => {
    const dr = new TelemetryDeadReckoning();
    dr.updateFix(initialFix);

    const state = dr.getCurrentState(1001000); // 1 sec later
    expect(state.isExtrapolated).toBe(false);
    expect(state.currentFix.position).toEqual([21.0122, 52.2297]);
    expect(state.currentFix.source).toBe(PositioningSource.GPS_RTK);
    expect(state.uncertaintyRadiusMeters).toBe(5);
  });

  it('should extrapolate position forward when GPS fix is delayed (> 2500ms)', () => {
    const dr = new TelemetryDeadReckoning();
    dr.updateFix(initialFix);

    // 10 seconds later without GPS update
    const state = dr.getCurrentState(1010000);
    expect(state.isExtrapolated).toBe(true);
    expect(state.extrapolationDurationMs).toBe(10000);
    expect(state.currentFix.source).toBe(PositioningSource.DEAD_RECKONING);

    // Vehicle was moving East (heading 90) -> Longitude should have increased
    const [lon, lat] = state.currentFix.position;
    expect(lon).toBeGreaterThan(21.0122);
    expect(lat).toBeCloseTo(52.2297, 4);

    // Uncertainty radius should have grown
    expect(state.uncertaintyRadiusMeters).toBeGreaterThan(5);
  });

  it('should snap dead reckoning forward along route coordinates when corridor is provided', () => {
    // Route going North from Warsaw
    const routeCoords: Position[] = [
      [21.0122, 52.2297],
      [21.0122, 52.2350],
      [21.0122, 52.2400],
    ];

    const dr = new TelemetryDeadReckoning({
      routeCoordinates: routeCoords,
    });

    const routeFix: TelemetryFix = {
      position: [21.0122, 52.2297],
      speedKmh: 72, // 20 m/s
      headingDegrees: 0, // North
      accuracyMeters: 4,
      timestamp: 1000000,
      source: PositioningSource.GPS_STANDARD,
    };

    dr.updateFix(routeFix);

    // 5 seconds later -> vehicle moved ~100m North along route
    const state = dr.getCurrentState(1005000);
    expect(state.isExtrapolated).toBe(true);
    expect(state.currentFix.source).toBe(PositioningSource.ROUTE_SNAPPED);
    expect(state.currentFix.position[1]).toBeGreaterThan(52.2297);
  });

  it('should transition to stationary LAST_KNOWN mode when max extrapolation duration is exceeded', () => {
    const dr = new TelemetryDeadReckoning({
      config: { maxExtrapolationDurationMs: 60000 },
    });
    dr.updateFix(initialFix);

    // 70 seconds later (exceeds 60s)
    const state = dr.getCurrentState(1070000);
    expect(state.isExtrapolated).toBe(true);
    expect(state.currentFix.source).toBe(PositioningSource.LAST_KNOWN);
    expect(state.currentFix.speedKmh).toBe(0);
    expect(state.uncertaintyRadiusMeters).toBe(500); // capped max uncertainty
  });

  it('should notify callbacks on GPS loss and restoration with outage duration', () => {
    let lostFix: TelemetryFix | null = null;
    let restoredFix: TelemetryFix | null = null;
    let outageDuration = 0;

    const dr = new TelemetryDeadReckoning({
      onGpsLost: (fix) => {
        lostFix = fix;
      },
      onGpsRestored: (fix, duration) => {
        restoredFix = fix;
        outageDuration = duration;
      },
    });

    dr.updateFix(initialFix);

    // Trigger dead reckoning
    dr.getCurrentState(1010000);
    expect(lostFix).toEqual(initialFix);

    // Restore GPS with fresh fix
    const freshFix: TelemetryFix = {
      position: [21.02, 52.23],
      speedKmh: 50,
      headingDegrees: 95,
      accuracyMeters: 3,
      timestamp: 1015000,
      source: PositioningSource.GPS_RTK,
    };

    dr.updateFix(freshFix);
    expect(restoredFix).toEqual(freshFix);
    expect(outageDuration).toBe(15000);
  });
});
