import { describe, it, expect } from 'vitest';
import { DegradedNavigationEngine } from '../../src/mesh/degradedNavigation.js';
import {
  DegradationLevel,
  NavigationGuidanceTier,
  PositioningSource,
  type TelemetryFix,
} from '../../src/mesh/types.js';
import type { RouteData } from '../../src/types.js';

describe('DegradedNavigationEngine (Fault-Tolerant Route Guidance)', () => {
  const sampleRoute: RouteData = {
    routeId: 'route-test-1',
    userId: 'driver-01',
    distanceMeters: 5000,
    durationSeconds: 300,
    createdAt: 1000,
    updatedAt: 1000,
    waypoints: [
      { id: 'wp1', coordinate: [21.0122, 52.2297], timestamp: 1000, name: 'Start' },
      { id: 'wp2', coordinate: [21.0122, 52.2400], timestamp: 1100, name: 'Punkt Kontrolny' },
      { id: 'wp3', coordinate: [21.0200, 52.2500], timestamp: 1200, name: 'Magazyn Docelowy' },
    ],
  };

  it('should generate corridor navigation when on-route with active route', () => {
    const nav = new DegradedNavigationEngine();
    nav.setRoute(sampleRoute);

    const fix: TelemetryFix = {
      position: [21.0122, 52.2350],
      speedKmh: 60,
      headingDegrees: 0, // Heading North along corridor
      accuracyMeters: 4,
      timestamp: Date.now(),
      source: PositioningSource.GPS_RTK,
    };

    const guidance = nav.computeGuidance(fix);
    expect(guidance.guidanceTier).toBe(NavigationGuidanceTier.OFFLINE_CACHED_CORRIDOR);
    expect(guidance.isOffRoute).toBe(false);
    expect(guidance.degradationLevel).toBe(DegradationLevel.OPTIMAL);
    expect(guidance.targetName).toBe('Magazyn Docelowy');
    expect(guidance.distanceToTargetMeters).toBeGreaterThan(1000);
    expect(guidance.maneuverInstruction).toContain('korytarz');
  });

  it('should switch to DIRECT_GEODETIC_BEARING when vehicle deviates off route corridor', () => {
    const nav = new DegradedNavigationEngine({ offRouteThresholdMeters: 100 });
    nav.setRoute(sampleRoute);

    // Vehicle 2 km West of the route
    const offRouteFix: TelemetryFix = {
      position: [20.9800, 52.2350],
      speedKmh: 50,
      headingDegrees: 45,
      accuracyMeters: 5,
      timestamp: Date.now(),
      source: PositioningSource.GPS_STANDARD,
    };

    const guidance = nav.computeGuidance(offRouteFix);
    expect(guidance.guidanceTier).toBe(NavigationGuidanceTier.DIRECT_GEODETIC_BEARING);
    expect(guidance.isOffRoute).toBe(true);
    expect(guidance.degradationLevel).toBe(DegradationLevel.DEGRADED_ONLINE);
    expect(guidance.maneuverInstruction).toContain('[AZYMUT BEZPOŚREDNI]');
  });

  it('should switch to DEAD_RECKONING_BEACON when fix is extrapolated', () => {
    const nav = new DegradedNavigationEngine();
    nav.setRoute(sampleRoute);

    const deadReckoningFix: TelemetryFix = {
      position: [20.9800, 52.2350],
      speedKmh: 40,
      headingDegrees: 45,
      accuracyMeters: 50,
      timestamp: Date.now(),
      source: PositioningSource.DEAD_RECKONING,
    };

    const guidance = nav.computeGuidance(deadReckoningFix);
    expect(guidance.guidanceTier).toBe(NavigationGuidanceTier.DEAD_RECKONING_BEACON);
    expect(guidance.degradationLevel).toBe(DegradationLevel.DEGRADED_FALLBACK);
    expect(guidance.maneuverInstruction).toContain('[ESTYMACJA DR]');
  });

  it('should guide to default Safe Haven when no route or target is set', () => {
    const nav = new DegradedNavigationEngine({
      fallbackSafeHaven: {
        name: 'BAZA BEZPIECZEŃSTWA',
        position: [21.0000, 52.2000],
      },
    });

    const fix: TelemetryFix = {
      position: [21.0500, 52.2500],
      speedKmh: 60,
      headingDegrees: 225,
      accuracyMeters: 10,
      timestamp: Date.now(),
      source: PositioningSource.GPS_STANDARD,
    };

    const guidance = nav.computeGuidance(fix);
    expect(guidance.targetName).toBe('BAZA BEZPIECZEŃSTWA');
    expect(guidance.distanceToTargetMeters).toBeGreaterThan(0);
  });
});
