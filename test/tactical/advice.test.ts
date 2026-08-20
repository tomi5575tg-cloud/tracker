import { describe, it, expect } from 'vitest';
import { getTacticalAdvice, TacticalAdviceError } from '../../src/tactical/advice.js';
import type { HgvProfile } from '../../src/tactical/types.js';

const WARSAW: [number, number] = [21.0122, 52.2297];

const TIR: HgvProfile = {
  heightMeters: 4.0,
  widthMeters: 2.55,
  lengthMeters: 16.5,
  grossWeightTonnes: 40,
  axleCount: 5,
  hasTrailer: true,
  limiterKmh: 85,
};

describe('getTacticalAdvice', () => {
  it('throws on invalid WGS84 instead of inventing a heading', async () => {
    await expect(
      getTacticalAdvice({
        currentCoords: [999, 99],
        speed: 60,
        isNight: false,
        hgvProfile: TIR,
      })
    ).rejects.toBeInstanceOf(TacticalAdviceError);
  });

  it('returns NOMINAL corridor advice on a clear daytime cruise', async () => {
    const advice = await getTacticalAdvice({
      currentCoords: WARSAW,
      speed: 74,
      isNight: false,
      hgvProfile: TIR,
      nextManeuver: { type: 'STRAIGHT', distanceMeters: 5000 },
    });

    expect(advice.priority).toBe('NOMINAL');
    expect(advice.code).toBe('CORRIDOR_NOMINAL');
    expect(advice.mustStop).toBe(false);
    expect(advice.recommendedSpeedKmh).toBe(80);
    expect(advice.coordinate).toEqual(WARSAW);
  });

  it('blocks an undersize bridge instead of hoping the set will fit', async () => {
    const advice = await getTacticalAdvice({
      currentCoords: WARSAW,
      speed: 70,
      isNight: false,
      hgvProfile: TIR,
      upcomingBridge: {
        id: 'br-1',
        name: 'Wiadukt PKP',
        clearanceMeters: 3.8,
        distanceMeters: 420,
        coordinate: [21.02, 52.23],
      },
    });

    expect(advice.priority).toBe('CRITICAL');
    expect(advice.mustStop).toBe(true);
    expect(advice.recommendedSpeedKmh).toBe(0);
    expect(advice.bridgeFit).toBe('BLOCKED');
    expect(advice.code).toBe('BRIDGE_HEIGHT_BLOCKED');
    expect(advice.headline).toContain('zakaz wjazdu');
  });

  it('blocks a weight-limited span for a 40 t set', async () => {
    const advice = await getTacticalAdvice({
      currentCoords: WARSAW,
      speed: 50,
      isNight: false,
      hgvProfile: TIR,
      upcomingBridge: {
        id: 'br-2',
        maxWeightTonnes: 24,
        distanceMeters: 200,
      },
    });

    expect(advice.bridgeFit).toBe('BLOCKED');
    expect(advice.mustStop).toBe(true);
    expect(advice.advisories.some((item) => item.code === 'BRIDGE_WEIGHT_BLOCKED')).toBe(true);
  });

  it('demands a speed drop before a tight HGV maneuver', async () => {
    const advice = await getTacticalAdvice({
      currentCoords: WARSAW,
      speed: 62,
      isNight: false,
      hgvProfile: TIR,
      nextManeuver: {
        type: 'ROUNDABOUT',
        distanceMeters: 180,
        instruction: 'Rondo, trzeci zjazd',
      },
    });

    expect(advice.priority).toBe('HIGH');
    expect(advice.code).toBe('MANEUVER_OVERSPEED');
    expect(advice.recommendedSpeedKmh).toBe(15);
    expect(advice.maneuverWindowSec).not.toBeNull();
    expect(advice.maneuverWindowSec ?? 0).toBeGreaterThan(0);
  });

  it('caps night cruise and labels the duty instead of pretending it is day', async () => {
    const advice = await getTacticalAdvice({
      currentCoords: WARSAW,
      speed: 78,
      isNight: true,
      hgvProfile: TIR,
    });

    expect(advice.advisories.some((item) => item.code === 'NIGHT_DUTY')).toBe(true);
    expect(advice.recommendedSpeedKmh).toBeLessThanOrEqual(70);
  });

  it('does not invent a clearance when the bridge gauge is missing', async () => {
    const advice = await getTacticalAdvice({
      currentCoords: WARSAW,
      speed: 40,
      isNight: false,
      hgvProfile: TIR,
      upcomingBridge: { id: 'br-unknown', distanceMeters: 300 },
    });

    expect(advice.bridgeFit).toBe('UNKNOWN');
    expect(advice.mustStop).toBe(false);
    expect(advice.advisories.some((item) => item.code === 'BRIDGE_GAUGE_UNKNOWN')).toBe(true);
  });
});
