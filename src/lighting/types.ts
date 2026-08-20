import type { Position } from '../geojson/types.js';
import type { MapLibreLightSpecification } from '../maplibre/types.js';

export type CelestialBodyType = 'SUN' | 'MOON';

export type DayNightPhase =
  | 'NIGHT'
  | 'ASTRONOMICAL_DAWN'
  | 'NAUTICAL_DAWN'
  | 'CIVIL_DAWN'
  | 'GOLDEN_HOUR_MORNING'
  | 'DAY'
  | 'GOLDEN_HOUR_EVENING'
  | 'CIVIL_DUSK'
  | 'NAUTICAL_DUSK'
  | 'ASTRONOMICAL_DUSK';

export type MoonPhaseName =
  | 'NEW_MOON'
  | 'WAXING_CRESCENT'
  | 'FIRST_QUARTER'
  | 'WAXING_GIBBOUS'
  | 'FULL_MOON'
  | 'WANING_GIBBOUS'
  | 'LAST_QUARTER'
  | 'WANING_CRESCENT';

/**
 * Astronomical and directional angles
 */
export interface CelestialPosition {
  readonly azimuthDegrees: number; // 0=North, 90=East, 180=South, 270=West
  readonly altitudeDegrees: number; // -90 to +90 degrees above horizon
  readonly zenithDegrees: number; // 90 - altitude
  readonly distanceFactor?: number | undefined; // Normalized distance
}

/**
 * Solar & Lunar lighting evaluation
 */
export interface SolarEphemeris {
  readonly position: CelestialPosition;
  readonly phase: DayNightPhase;
  readonly isDaylight: boolean;
  readonly sunriseTimestamp: number;
  readonly sunsetTimestamp: number;
  readonly solarNoonTimestamp: number;
}

export interface LunarEphemeris {
  readonly position: CelestialPosition;
  readonly phaseName: MoonPhaseName;
  readonly illuminatedFraction: number; // 0.0 (New Moon) to 1.0 (Full Moon)
  readonly ageDays: number; // 0 to 29.53 days
}

export interface DynamicLightingState {
  readonly timestamp: number;
  readonly observerCoordinate: Position;
  readonly dominantBody: CelestialBodyType;
  readonly sun: SolarEphemeris;
  readonly moon: LunarEphemeris;
  readonly lightSpecification: MapLibreLightSpecification;
  readonly ambientLightColor: string;
  readonly diffuseLightColor: string;
  readonly shadowColor: string;
  readonly fogColor?: string | undefined;
  readonly skyColor?: string | undefined;
  readonly terrainExaggeration?: number | undefined;
}

export interface DynamicLightingThemePalette {
  readonly noonSunColor: string;
  readonly goldenHourColor: string;
  readonly sunsetColor: string;
  readonly civilDuskColor: string;
  readonly fullMoonColor: string;
  readonly newMoonColor: string;
  readonly ambientDayColor: string;
  readonly ambientNightColor: string;
}

export const DEFAULT_LIGHTING_PALETTE: DynamicLightingThemePalette = Object.freeze({
  noonSunColor: '#FFFDF0',      // Jasne, ciepłe biało-żółte światło
  goldenHourColor: '#FFA726',   // Złocisto-bursztynowe światło
  sunsetColor: '#FF5722',       // Głęboka czerwień / pomarańcz zachodu
  civilDuskColor: '#5C6BC0',    // Indygo / fiolet zmierzchu
  fullMoonColor: '#C5CAE9',     // Srebrzysto-błękitny blask pełni księżyca
  newMoonColor: '#1A237E',      // Bardzo ciemny granat nowiu
  ambientDayColor: '#FFFFFF',
  ambientNightColor: '#0A0E1A',
});

export interface DynamicLightingConfig {
  readonly observerCoordinate?: Position | undefined;
  readonly updateIntervalMs?: number | undefined;
  readonly simulatedTimeMultiplier?: number | undefined; // 1 = realtime, 60 = 1 min per sec
  readonly customTimestamp?: number | undefined;
  readonly palette?: Partial<DynamicLightingThemePalette> | undefined;
  readonly enableShadows?: boolean | undefined;
  readonly minIntensity?: number | undefined;
  readonly maxIntensity?: number | undefined;
  readonly transitionDurationMs?: number | undefined;
  readonly onLightingChange?: ((state: DynamicLightingState) => void) | undefined;
}
