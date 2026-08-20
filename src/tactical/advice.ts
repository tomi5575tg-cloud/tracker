import { isValidCoordinate } from '../geojson/types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import {
  BRIDGE_HEIGHT_MARGIN_METERS,
  BRIDGE_WIDTH_MARGIN_METERS,
  HGV_CRUISE_CAP_KMH,
  MANEUVER_SPEED_KMH,
  type BridgeFit,
  type HgvProfile,
  type TacticalAdvice,
  type TacticalAdviceInput,
  type TacticalAdvicePriority,
  type TacticalAdvisory,
  type UpcomingBridge,
} from './types.js';

export class TacticalAdviceError extends Error {
  override readonly name = 'TacticalAdviceError';

  constructor(message: string) {
    super(message);
  }
}

const PRIORITY_RANK: Record<TacticalAdvicePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  ADVISORY: 2,
  NOMINAL: 3,
};

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TacticalAdviceError(`${name} must be a finite number ≥ 0`);
  }
}

function assertHgvProfile(profile: HgvProfile): void {
  assertFiniteNonNegative('hgvProfile.heightMeters', profile.heightMeters);
  assertFiniteNonNegative('hgvProfile.widthMeters', profile.widthMeters);
  assertFiniteNonNegative('hgvProfile.lengthMeters', profile.lengthMeters);
  assertFiniteNonNegative('hgvProfile.grossWeightTonnes', profile.grossWeightTonnes);
  if (profile.heightMeters <= 0 || profile.widthMeters <= 0) {
    throw new TacticalAdviceError('hgvProfile height and width must be > 0');
  }
}

function cruiseCap(profile: HgvProfile, isNight: boolean): number {
  const limiter = profile.limiterKmh ?? HGV_CRUISE_CAP_KMH;
  const legal = Math.min(HGV_CRUISE_CAP_KMH, limiter);
  return isNight ? Math.min(legal, 70) : legal;
}

function evaluateBridge(profile: HgvProfile, bridge: UpcomingBridge): {
  fit: BridgeFit;
  advisories: TacticalAdvisory[];
} {
  const advisories: TacticalAdvisory[] = [];
  let fit: BridgeFit = 'UNKNOWN';

  const heightPosted = bridge.clearanceMeters;
  if (heightPosted !== undefined) {
    const needed = profile.heightMeters + BRIDGE_HEIGHT_MARGIN_METERS;
    if (needed > heightPosted) {
      fit = 'BLOCKED';
      advisories.push({
        code: 'BRIDGE_HEIGHT_BLOCKED',
        priority: 'CRITICAL',
        message: `Most ${bridge.name ?? bridge.id}: skrajnia ${heightPosted.toFixed(2)} m, zestaw ${profile.heightMeters.toFixed(2)} m + ${BRIDGE_HEIGHT_MARGIN_METERS} m zapasu — zakaz wjazdu`,
      });
    } else if (needed > heightPosted - 0.15) {
      fit = 'MARGIN';
      advisories.push({
        code: 'BRIDGE_HEIGHT_MARGIN',
        priority: 'HIGH',
        message: `Most ${bridge.name ?? bridge.id}: skrajnia na granicy zapasu — zwolnić, centralny tor, zablokować zawieszenie`,
      });
    } else {
      fit = 'CLEAR';
    }
  }

  const weightPosted = bridge.maxWeightTonnes;
  if (weightPosted !== undefined && profile.grossWeightTonnes > weightPosted) {
    fit = 'BLOCKED';
    advisories.push({
      code: 'BRIDGE_WEIGHT_BLOCKED',
      priority: 'CRITICAL',
      message: `Most ${bridge.name ?? bridge.id}: DMC ${profile.grossWeightTonnes.toFixed(1)} t > limit ${weightPosted.toFixed(1)} t — zakaz wjazdu`,
    });
  }

  const widthPosted = bridge.widthMeters;
  if (widthPosted !== undefined) {
    const neededWidth = profile.widthMeters + BRIDGE_WIDTH_MARGIN_METERS;
    if (neededWidth > widthPosted) {
      fit = 'BLOCKED';
      advisories.push({
        code: 'BRIDGE_WIDTH_BLOCKED',
        priority: 'CRITICAL',
        message: `Most ${bridge.name ?? bridge.id}: szerokość ${widthPosted.toFixed(2)} m za wąska dla zestawu ${profile.widthMeters.toFixed(2)} m`,
      });
    } else if (fit === 'UNKNOWN') {
      fit = 'CLEAR';
    }
  }

  if (fit === 'UNKNOWN') {
    advisories.push({
      code: 'BRIDGE_GAUGE_UNKNOWN',
      priority: 'ADVISORY',
      message: `Most ${bridge.name ?? bridge.id}: brak skrajni w kontrakcie — nie zgadywać, zweryfikować znak`,
    });
  }

  return { fit, advisories };
}

function maneuverSpeed(type: keyof typeof MANEUVER_SPEED_KMH, profile: HgvProfile): number {
  const base = MANEUVER_SPEED_KMH[type];
  const trailerPenalty = profile.hasTrailer && (type === 'SHARP_LEFT' || type === 'SHARP_RIGHT' || type === 'UTURN' || type === 'ROUNDABOUT')
    ? 5
    : 0;
  return Math.max(8, base - trailerPenalty);
}

function pickWinner(advisories: readonly TacticalAdvisory[]): TacticalAdvisory {
  return [...advisories].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0]!;
}

/**
 * Deterministic HGV tactical advisor for the cabin HUD.
 * Async so a future edge/model hop can replace the body without changing the contract —
 * this implementation does not call a model and does not invent missing gauge data.
 */
export const getTacticalAdvice = async ({
  currentCoords,
  speed,
  isNight,
  nextManeuver,
  hgvProfile,
  upcomingBridge,
}: TacticalAdviceInput): Promise<TacticalAdvice> => {
  if (!isValidCoordinate(currentCoords)) {
    throw new TacticalAdviceError('currentCoords is not a valid RFC 7946 WGS84 position');
  }
  assertFiniteNonNegative('speed', speed);
  assertHgvProfile(hgvProfile);

  const advisories: TacticalAdvisory[] = [];
  let recommendedSpeedKmh = cruiseCap(hgvProfile, isNight);
  let bridgeFit: BridgeFit = 'UNKNOWN';
  let maneuverWindowSec: number | null = null;

  if (isNight) {
    advisories.push({
      code: 'NIGHT_DUTY',
      priority: 'ADVISORY',
      message: 'Noc: światła mijania, ograniczona widoczność skrajni i pieszych przy jezdni',
    });
  }

  if (upcomingBridge) {
    const distance =
      upcomingBridge.distanceMeters ??
      (upcomingBridge.coordinate !== undefined
        ? GeoSpatialUtils.haversineDistance(currentCoords, upcomingBridge.coordinate)
        : undefined);

    const evaluated = evaluateBridge(hgvProfile, upcomingBridge);
    bridgeFit = evaluated.fit;
    advisories.push(...evaluated.advisories);

    if (evaluated.fit === 'BLOCKED') {
      recommendedSpeedKmh = 0;
      const range =
        distance !== undefined ? ` za ${Math.round(distance)} m` : '';
      advisories.push({
        code: 'BRIDGE_REROUTE',
        priority: 'CRITICAL',
        message: `Zatrzymać zestaw przed obiektem${range} i wyznaczyć objazd — wjazd uszkodzi ramę albo złamie przepis`,
      });
    } else if (evaluated.fit === 'MARGIN' && distance !== undefined && distance < 800) {
      recommendedSpeedKmh = Math.min(recommendedSpeedKmh, 25);
    }
  } else {
    bridgeFit = 'UNKNOWN';
  }

  if (nextManeuver) {
    assertFiniteNonNegative('nextManeuver.distanceMeters', nextManeuver.distanceMeters);
    const cap = maneuverSpeed(nextManeuver.type, hgvProfile);
    const etaSec =
      speed > 0.5 ? (nextManeuver.distanceMeters / ((speed * 1000) / 3600)) : null;
    maneuverWindowSec = etaSec !== null ? Number(etaSec.toFixed(1)) : null;

    if (nextManeuver.type !== 'STRAIGHT' && nextManeuver.distanceMeters <= 400) {
      recommendedSpeedKmh = Math.min(recommendedSpeedKmh, cap);
      if (speed > cap + 8) {
        advisories.push({
          code: 'MANEUVER_OVERSPEED',
          priority: 'HIGH',
          message: `Manewr ${nextManeuver.type} za ${Math.round(nextManeuver.distanceMeters)} m — zejść do ${cap} km/h (zestaw ${hgvProfile.lengthMeters.toFixed(1)} m)`,
        });
      } else {
        advisories.push({
          code: 'MANEUVER_PREP',
          priority: 'ADVISORY',
          message: nextManeuver.instruction ?? `Przygotować ${nextManeuver.type} za ${Math.round(nextManeuver.distanceMeters)} m, tor ${cap} km/h`,
        });
      }
    }
  }

  if (speed > cruiseCap(hgvProfile, isNight) + 5 && recommendedSpeedKmh > 0) {
    advisories.push({
      code: 'HGV_CRUISE_EXCEEDANCE',
      priority: 'HIGH',
      message: `Prędkość ${Math.round(speed)} km/h powyżej limitu zestawu ${cruiseCap(hgvProfile, isNight)} km/h`,
    });
    recommendedSpeedKmh = Math.min(recommendedSpeedKmh, cruiseCap(hgvProfile, isNight));
  }

  if (advisories.length === 0) {
    advisories.push({
      code: 'CORRIDOR_NOMINAL',
      priority: 'NOMINAL',
      message: 'Korytarz czysty — utrzymać tor i skrajnię zestawu',
    });
  }

  const winner = pickWinner(advisories);
  const mustStop = winner.priority === 'CRITICAL' && recommendedSpeedKmh === 0;

  return {
    priority: winner.priority,
    code: winner.code,
    headline: winner.message,
    detail: advisories.map((item) => item.message).join(' · '),
    recommendedSpeedKmh,
    mustStop,
    bridgeFit,
    maneuverWindowSec,
    advisories,
    coordinate: [currentCoords[0], currentCoords[1]],
  };
};
