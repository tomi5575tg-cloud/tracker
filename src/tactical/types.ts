import type { Position } from '../geojson/types.js';

export type TacticalAdvicePriority = 'CRITICAL' | 'HIGH' | 'ADVISORY' | 'NOMINAL';

export type ManeuverType =
  | 'STRAIGHT'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'SHARP_LEFT'
  | 'SHARP_RIGHT'
  | 'ROUNDABOUT'
  | 'EXIT'
  | 'MERGE'
  | 'UTURN';

export type BridgeFit = 'CLEAR' | 'MARGIN' | 'BLOCKED' | 'UNKNOWN';

export interface HgvProfile {
  readonly heightMeters: number;
  readonly widthMeters: number;
  readonly lengthMeters: number;
  readonly grossWeightTonnes: number;
  readonly axleCount?: number | undefined;
  readonly hasTrailer?: boolean | undefined;
  readonly limiterKmh?: number | undefined;
}

export interface NextManeuver {
  readonly type: ManeuverType;
  readonly distanceMeters: number;
  readonly instruction?: string | undefined;
  readonly exitAngleDeg?: number | undefined;
}

export interface UpcomingBridge {
  readonly id: string;
  readonly coordinate?: Position | undefined;
  readonly name?: string | undefined;
  readonly clearanceMeters?: number | undefined;
  readonly maxWeightTonnes?: number | undefined;
  readonly widthMeters?: number | undefined;
  readonly distanceMeters?: number | undefined;
}

export interface TacticalAdviceInput {
  readonly currentCoords: Position;
  readonly speed: number;
  readonly isNight: boolean;
  readonly nextManeuver?: NextManeuver | null | undefined;
  readonly hgvProfile: HgvProfile;
  readonly upcomingBridge?: UpcomingBridge | null | undefined;
}

export interface TacticalAdvisory {
  readonly code: string;
  readonly priority: TacticalAdvicePriority;
  readonly message: string;
}

export interface TacticalAdvice {
  readonly priority: TacticalAdvicePriority;
  readonly code: string;
  readonly headline: string;
  readonly detail: string;
  readonly recommendedSpeedKmh: number;
  readonly mustStop: boolean;
  readonly bridgeFit: BridgeFit;
  readonly maneuverWindowSec: number | null;
  readonly advisories: readonly TacticalAdvisory[];
  readonly coordinate: Position;
}

/** Vertical bounce / air-suspension margin before a posted clearance is treated as blocked. */
export const BRIDGE_HEIGHT_MARGIN_METERS = 0.2;
/** Mirror / tracking-width margin against posted bridge width. */
export const BRIDGE_WIDTH_MARGIN_METERS = 0.3;
/** Polish HGV (>3.5 t) motorway/expressway cap unless the limiter is lower. */
export const HGV_CRUISE_CAP_KMH = 80;

export const MANEUVER_SPEED_KMH: Readonly<Record<ManeuverType, number>> = Object.freeze({
  STRAIGHT: HGV_CRUISE_CAP_KMH,
  MERGE: 50,
  EXIT: 45,
  TURN_LEFT: 30,
  TURN_RIGHT: 30,
  ROUNDABOUT: 20,
  SHARP_LEFT: 15,
  SHARP_RIGHT: 15,
  UTURN: 10,
});
