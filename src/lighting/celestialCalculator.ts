import type { Position } from '../geojson/types.js';
import { isValidCoordinate } from '../geojson/types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import type {
  CelestialPosition,
  SolarEphemeris,
  LunarEphemeris,
  DayNightPhase,
  MoonPhaseName,
} from './types.js';

// Synodic month (lunar cycle) in days
const SYNODIC_MONTH_DAYS = 29.53058867;
// Known reference new moon: Jan 6, 2000, 18:14 UTC
const REFERENCE_NEW_MOON_TIMESTAMP = Date.UTC(2000, 0, 6, 18, 14, 0);

export class CelestialCalculator {
  /**
   * Computes astronomical Julian Date from UNIX timestamp (milliseconds)
   */
  public static toJulianDate(timestamp: number): number {
    return timestamp / 86400000 + 2440587.5;
  }

  /**
   * Calculates Solar position and ephemeris for given coordinates and timestamp
   */
  public static calculateSun(coord: Position, timestamp: number = Date.now()): SolarEphemeris {
    if (!isValidCoordinate(coord)) {
      throw new Error(`Invalid coordinate for sun calculation: ${JSON.stringify(coord)}`);
    }

    const [lon, lat] = coord;
    const jd = this.toJulianDate(timestamp);
    const d = jd - 2451545.0; // Days since J2000.0

    // Mean solar longitude
    const L = (280.46 + 0.9856474 * d) % 360;
    // Mean anomaly of the Sun
    const g = GeoSpatialUtils.toRadians((357.528 + 0.9856003 * d) % 360);
    // Ecliptic longitude of the Sun
    const lambda = GeoSpatialUtils.toRadians(
      L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)
    );

    // Obliquity of the ecliptic
    const epsilon = GeoSpatialUtils.toRadians(23.439 - 0.0000004 * d);

    // Right ascension & Declination
    const sinDec = Math.sin(epsilon) * Math.sin(lambda);
    const dec = Math.asin(sinDec);
    const cosDec = Math.cos(dec);

    const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

    // Greenwich Mean Sidereal Time (GMST) in radians
    const gmst = GeoSpatialUtils.toRadians((280.46061837 + 360.98564736629 * d) % 360);
    // Local Sidereal Time
    const lmst = gmst + GeoSpatialUtils.toRadians(lon);

    // Hour angle
    const H = lmst - alpha;

    // Observer latitude in radians
    const radLat = GeoSpatialUtils.toRadians(lat);

    // Altitude (elevation) angle
    const sinAlt = Math.sin(radLat) * Math.sin(dec) + Math.cos(radLat) * cosDec * Math.cos(H);
    const altitudeRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const altitudeDegrees = GeoSpatialUtils.toDegrees(altitudeRad);

    // Azimuth angle
    const y = -Math.sin(H);
    const x = Math.tan(dec) * Math.cos(radLat) - Math.sin(radLat) * Math.cos(H);
    let azimuthDeg = GeoSpatialUtils.toDegrees(Math.atan2(y, x));
    azimuthDeg = (azimuthDeg + 360) % 360; // 0=North, 90=East, 180=South, 270=West

    const zenithDegrees = 90 - altitudeDegrees;

    // Approximate Sunrise and Sunset timestamps for current day
    const { sunriseTimestamp, sunsetTimestamp, solarNoonTimestamp } = this.estimateSunTimes(coord, timestamp);

    const phase = this.determineDayNightPhase(altitudeDegrees);
    const isDaylight = altitudeDegrees > 0;

    const position: CelestialPosition = {
      azimuthDegrees: Number(azimuthDeg.toFixed(2)),
      altitudeDegrees: Number(altitudeDegrees.toFixed(2)),
      zenithDegrees: Number(zenithDegrees.toFixed(2)),
    };

    return {
      position,
      phase,
      isDaylight,
      sunriseTimestamp,
      sunsetTimestamp,
      solarNoonTimestamp,
    };
  }

  /**
   * Calculates Lunar position, moon phase, and illumination for given coordinates and timestamp
   */
  public static calculateMoon(coord: Position, timestamp: number = Date.now()): LunarEphemeris {
    if (!isValidCoordinate(coord)) {
      throw new Error(`Invalid coordinate for moon calculation: ${JSON.stringify(coord)}`);
    }

    const [lon, lat] = coord;
    const jd = this.toJulianDate(timestamp);
    const d = jd - 2451545.0;

    // Lunar orbital elements
    const L = GeoSpatialUtils.toRadians((218.316 + 13.176396 * d) % 360); // Moon's mean longitude
    const M = GeoSpatialUtils.toRadians((134.963 + 13.064993 * d) % 360); // Moon's mean anomaly
    const F = GeoSpatialUtils.toRadians((93.272 + 13.22935 * d) % 360);   // Moon's argument of latitude

    // Moon's longitude and latitude
    const l = L + GeoSpatialUtils.toRadians(6.289 * Math.sin(M));
    const b = GeoSpatialUtils.toRadians(5.128 * Math.sin(F));

    // Obliquity of the ecliptic
    const eps = GeoSpatialUtils.toRadians(23.439 - 0.0000004 * d);

    // Right ascension & Declination
    const sinDec = Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l);
    const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
    const cosDec = Math.cos(dec);

    const ra = Math.atan2(
      Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps),
      Math.cos(l)
    );

    // Local Sidereal Time
    const gmst = GeoSpatialUtils.toRadians((280.46061837 + 360.98564736629 * d) % 360);
    const lmst = gmst + GeoSpatialUtils.toRadians(lon);
    const H = lmst - ra;

    const radLat = GeoSpatialUtils.toRadians(lat);
    const sinAlt = Math.sin(radLat) * Math.sin(dec) + Math.cos(radLat) * cosDec * Math.cos(H);
    const altitudeRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const altitudeDegrees = GeoSpatialUtils.toDegrees(altitudeRad);

    const y = -Math.sin(H);
    const x = Math.tan(dec) * Math.cos(radLat) - Math.sin(radLat) * Math.cos(H);
    let azimuthDeg = GeoSpatialUtils.toDegrees(Math.atan2(y, x));
    azimuthDeg = (azimuthDeg + 360) % 360;

    // Moon age and illumination phase
    const timeSinceRef = timestamp - REFERENCE_NEW_MOON_TIMESTAMP;
    const daysSinceRef = timeSinceRef / 86400000;
    const ageDays = (daysSinceRef % SYNODIC_MONTH_DAYS + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;

    // Fraction of illumination: (1 - cos(phaseAngle)) / 2
    const phaseAngle = (ageDays / SYNODIC_MONTH_DAYS) * 2 * Math.PI;
    const illuminatedFraction = Number(((1 - Math.cos(phaseAngle)) / 2).toFixed(3));

    const phaseName = this.determineMoonPhaseName(ageDays);

    const position: CelestialPosition = {
      azimuthDegrees: Number(azimuthDeg.toFixed(2)),
      altitudeDegrees: Number(altitudeDegrees.toFixed(2)),
      zenithDegrees: Number((90 - altitudeDegrees).toFixed(2)),
      distanceFactor: 1.0,
    };

    return {
      position,
      phaseName,
      illuminatedFraction,
      ageDays: Number(ageDays.toFixed(2)),
    };
  }

  private static determineDayNightPhase(altitudeDegrees: number): DayNightPhase {
    if (altitudeDegrees > 6) {
      return 'DAY';
    } else if (altitudeDegrees > 0) {
      return 'GOLDEN_HOUR_MORNING';
    } else if (altitudeDegrees > -6) {
      return 'CIVIL_DUSK';
    } else if (altitudeDegrees > -12) {
      return 'NAUTICAL_DUSK';
    } else if (altitudeDegrees > -18) {
      return 'ASTRONOMICAL_DUSK';
    }
    return 'NIGHT';
  }

  private static determineMoonPhaseName(ageDays: number): MoonPhaseName {
    if (ageDays < 1.84566) return 'NEW_MOON';
    if (ageDays < 5.53699) return 'WAXING_CRESCENT';
    if (ageDays < 9.22831) return 'FIRST_QUARTER';
    if (ageDays < 12.91963) return 'WAXING_GIBBOUS';
    if (ageDays < 16.61096) return 'FULL_MOON';
    if (ageDays < 20.30228) return 'WANING_GIBBOUS';
    if (ageDays < 23.99361) return 'LAST_QUARTER';
    if (ageDays < 27.68493) return 'WANING_CRESCENT';
    return 'NEW_MOON';
  }

  private static estimateSunTimes(coord: Position, timestamp: number): {
    sunriseTimestamp: number;
    sunsetTimestamp: number;
    solarNoonTimestamp: number;
  } {
    const [lon] = coord;
    const date = new Date(timestamp);
    const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    // Solar noon is roughly 12:00 UTC adjusted for longitude (-4 minutes per degree)
    const solarNoonUtcOffsetMs = (12 - lon / 15) * 3600000;
    const solarNoonTimestamp = startOfDay + solarNoonUtcOffsetMs;

    // Approximate 6-hour daylight offset (customizable per season/latitude)
    const daylightDurationHalfMs = 6 * 3600000;
    const sunriseTimestamp = solarNoonTimestamp - daylightDurationHalfMs;
    const sunsetTimestamp = solarNoonTimestamp + daylightDurationHalfMs;

    return {
      sunriseTimestamp,
      sunsetTimestamp,
      solarNoonTimestamp,
    };
  }
}
