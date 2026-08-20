import type { Position } from '../geojson/types.js';
import type { RouteData } from '../types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import {
  DegradationLevel,
  NavigationGuidanceTier,
  type NavigationGuidance,
  type TelemetryFix,
} from './types.js';

export interface DegradedNavigationOptions {
  readonly offRouteThresholdMeters?: number | undefined;
  readonly defaultAverageSpeedKmh?: number | undefined;
  readonly fallbackSafeHaven?: { name: string; position: Position } | undefined;
}

export class DegradedNavigationEngine {
  private readonly offRouteThresholdMeters: number;
  private readonly defaultAverageSpeedKmh: number;
  private readonly fallbackSafeHaven: { name: string; position: Position };
  private activeRoute: RouteData | null = null;
  private targetPosition: Position | null = null;
  private targetName: string = 'CEL';

  constructor(options: DegradedNavigationOptions = {}) {
    this.offRouteThresholdMeters = options.offRouteThresholdMeters ?? 150;
    this.defaultAverageSpeedKmh = options.defaultAverageSpeedKmh ?? 50;
    this.fallbackSafeHaven = options.fallbackSafeHaven ?? {
      name: 'BAZA BEZPIECZEŃSTWA (SAFE HAVEN)',
      position: [21.0122, 52.2297],
    };
  }

  public setRoute(route: RouteData | null): void {
    this.activeRoute = route;
    if (route && route.waypoints && route.waypoints.length > 0) {
      const lastWp = route.waypoints[route.waypoints.length - 1];
      if (lastWp) {
        this.targetPosition = lastWp.coordinate;
        this.targetName = lastWp.name ?? `PUNKT #${route.waypoints.length}`;
      }
    }
  }

  public setTarget(targetPosition: Position, targetName = 'CEL'): void {
    this.targetPosition = targetPosition;
    this.targetName = targetName;
  }

  public getActiveRoute(): RouteData | null {
    return this.activeRoute;
  }

  public getTargetPosition(): Position | null {
    return this.targetPosition;
  }

  /**
   * Computes multi-level degraded navigation guidance for the current telemetry fix.
   */
  public computeGuidance(fix: TelemetryFix): NavigationGuidance {
    const currentPos = fix.position;
    const effectiveTarget = this.targetPosition ?? this.fallbackSafeHaven.position;
    const effectiveTargetName = this.targetPosition ? this.targetName : this.fallbackSafeHaven.name;

    const directDistance = GeoSpatialUtils.haversineDistance(currentPos, effectiveTarget);
    const directBearing = GeoSpatialUtils.calculateBearing(currentPos, effectiveTarget);

    // Compute relative bearing (-180 to +180) relative to current heading
    let relativeBearing = directBearing - fix.headingDegrees;
    while (relativeBearing > 180) relativeBearing -= 360;
    while (relativeBearing < -180) relativeBearing += 360;

    const currentSpeedKmh = fix.speedKmh > 5 ? fix.speedKmh : this.defaultAverageSpeedKmh;
    const speedMps = (currentSpeedKmh * 1000) / 3600;

    // Check if we have an active route with valid waypoints
    if (this.activeRoute && this.activeRoute.waypoints.length >= 2) {
      const coords = this.activeRoute.waypoints.map((w) => w.coordinate);
      const crossTrackDistance = GeoSpatialUtils.distanceToPolyline(currentPos, coords);
      const isOffRoute = crossTrackDistance > this.offRouteThresholdMeters;

      if (!isOffRoute) {
        // Tier 1: OFFLINE_CACHED_CORRIDOR (Smooth corridor guidance)
        const remainingRouteDist = this.computeRemainingRouteDistance(currentPos, coords);
        const etaSeconds = Math.round(remainingRouteDist / Math.max(1, speedMps));
        const maneuver = this.generateCorridorManeuver(relativeBearing, remainingRouteDist);

        return {
          guidanceTier: NavigationGuidanceTier.OFFLINE_CACHED_CORRIDOR,
          currentPosition: currentPos,
          targetPosition: effectiveTarget,
          targetName: effectiveTargetName,
          distanceToTargetMeters: Math.round(remainingRouteDist),
          bearingToTargetDegrees: Math.round(directBearing),
          relativeBearingDegrees: Math.round(relativeBearing),
          crossTrackErrorMeters: Math.round(crossTrackDistance),
          estimatedTimeEnRouteSeconds: etaSeconds,
          maneuverInstruction: maneuver,
          isOffRoute: false,
          degradationLevel: DegradationLevel.OPTIMAL,
        };
      }
    }

    // Tier 2 & 3: DIRECT_GEODETIC_BEARING or DEAD_RECKONING_BEACON
    const isDeadReckoning = fix.source === 'DEAD_RECKONING' || fix.source === 'LAST_KNOWN';
    const tier = isDeadReckoning
      ? NavigationGuidanceTier.DEAD_RECKONING_BEACON
      : NavigationGuidanceTier.DIRECT_GEODETIC_BEARING;

    const degradationLevel = isDeadReckoning
      ? DegradationLevel.DEGRADED_FALLBACK
      : DegradationLevel.DEGRADED_ONLINE;

    const etaSeconds = Math.round(directDistance / Math.max(1, speedMps));
    const maneuver = this.generateDirectBearingManeuver(
      directBearing,
      relativeBearing,
      directDistance,
      effectiveTargetName,
      isDeadReckoning
    );

    return {
      guidanceTier: tier,
      currentPosition: currentPos,
      targetPosition: effectiveTarget,
      targetName: effectiveTargetName,
      distanceToTargetMeters: Math.round(directDistance),
      bearingToTargetDegrees: Math.round(directBearing),
      relativeBearingDegrees: Math.round(relativeBearing),
      crossTrackErrorMeters: undefined,
      estimatedTimeEnRouteSeconds: etaSeconds,
      maneuverInstruction: maneuver,
      isOffRoute: this.activeRoute !== null,
      degradationLevel,
    };
  }

  private computeRemainingRouteDistance(
    currentPos: Position,
    coords: readonly Position[]
  ): number {
    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      if (!coord) continue;
      const d = GeoSpatialUtils.haversineDistance(currentPos, coord);
      if (d < minDistance) {
        minDistance = d;
        closestIndex = i;
      }
    }

    let total = 0;
    const nextVertex = coords[closestIndex + 1];
    if (nextVertex) {
      total += GeoSpatialUtils.haversineDistance(currentPos, nextVertex);
    }

    for (let i = closestIndex + 1; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      if (p1 && p2) {
        total += GeoSpatialUtils.haversineDistance(p1, p2);
      }
    }

    return total > 0 ? total : minDistance;
  }

  private generateCorridorManeuver(
    relativeBearing: number,
    remainingDist: number
  ): string {
    const distKm = (remainingDist / 1000).toFixed(1);
    if (remainingDist < 50) {
      return 'Dotarłeś do celu podróży.';
    }

    if (Math.abs(relativeBearing) < 15) {
      return `Podążaj korytarzem trasy prosto (${distKm} km do celu)`;
    } else if (relativeBearing > 15 && relativeBearing < 60) {
      return `Łagodnie w prawo w korytarz (${distKm} km do celu)`;
    } else if (relativeBearing >= 60 && relativeBearing < 120) {
      return `Skręć w prawo na trasę (${distKm} km)`;
    } else if (relativeBearing < -15 && relativeBearing > -60) {
      return `Łagodnie w lewo w korytarz (${distKm} km do celu)`;
    } else if (relativeBearing <= -60 && relativeBearing > -120) {
      return `Skręć w lewo na trasę (${distKm} km)`;
    } else {
      return `Zawróć w stronę korytarza trasy (${distKm} km)`;
    }
  }

  private generateDirectBearingManeuver(
    directBearing: number,
    relativeBearing: number,
    distanceMeters: number,
    targetName: string,
    isDeadReckoning: boolean
  ): string {
    const distKm = (distanceMeters / 1000).toFixed(1);
    const bearingFormatted = Math.round(directBearing).toString().padStart(3, '0');
    const prefix = isDeadReckoning ? '[ESTYMACJA DR] ' : '[AZYMUT BEZPOŚREDNI] ';

    if (Math.abs(relativeBearing) < 15) {
      return `${prefix}Utrzymuj azymut ${bearingFormatted}° wprost do ${targetName} (${distKm} km)`;
    } else if (relativeBearing > 0) {
      return `${prefix}Koryguj w prawo o ${Math.round(relativeBearing)}° (kurs ${bearingFormatted}°) do ${targetName} (${distKm} km)`;
    } else {
      return `${prefix}Koryguj w lewo o ${Math.round(Math.abs(relativeBearing))}° (kurs ${bearingFormatted}°) do ${targetName} (${distKm} km)`;
    }
  }
}
