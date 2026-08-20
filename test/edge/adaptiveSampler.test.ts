import { describe, it, expect } from 'vitest';
import { AdaptiveSampler } from '../../src/edge/adaptiveSampler.js';
import { AiAnalysisTierEngine } from '../../src/edge/aiTierEngine.js';
import type { TelemetryPointPayload } from '../../src/edge/types.js';

describe('AdaptiveSampler & AI Tier Scaling', () => {
  it('should scale turbo boost level and power dosing ratio based on speed and throttle', () => {
    const sampler = new AdaptiveSampler();

    // Idle point
    const idlePoint: TelemetryPointPayload = {
      coordinate: [21.01, 52.22],
      timestamp: 1000,
      speedKmh: 0,
      throttlePct: 0,
      gForce: 0.05,
    };
    const evalIdle = sampler.evaluatePowerDosing(idlePoint, 10);
    expect(evalIdle.turboBoostLevel).toBe('IDLE');
    expect(evalIdle.powerDosingRatio).toBe(0.1);
    expect(evalIdle.targetAiTier).toBe('TIER_0_RAW_INGEST');
    expect(evalIdle.samplingIntervalMs).toBe(5000);

    // Cruise point (80 km/h)
    const cruisePoint: TelemetryPointPayload = {
      coordinate: [21.05, 52.25],
      timestamp: 2000,
      speedKmh: 80,
      throttlePct: 45,
      gForce: 0.2,
    };
    const evalCruise = sampler.evaluatePowerDosing(cruisePoint, 40);
    expect(evalCruise.turboBoostLevel).toBe('CRUISE');
    expect(evalCruise.powerDosingRatio).toBe(0.55);
    expect(evalCruise.targetAiTier).toBe('TIER_2_SAFETY_CORRIDOR');
    expect(evalCruise.samplingIntervalMs).toBe(1000);

    // Turbo Max point (145 km/h, 100% throttle, high g-force)
    const turboPoint: TelemetryPointPayload = {
      coordinate: [21.15, 52.35],
      timestamp: 3000,
      speedKmh: 145,
      throttlePct: 100,
      gForce: 1.6,
    };
    const evalTurbo = sampler.evaluatePowerDosing(turboPoint, 70);
    expect(evalTurbo.turboBoostLevel).toBe('TURBO_MAX');
    expect(evalTurbo.powerDosingRatio).toBe(1.0);
    expect(evalTurbo.targetAiTier).toBe('TIER_4_FULL_COCKPIT_AI');
    expect(evalTurbo.samplingIntervalMs).toBe(200);
  });

  it('should throttle sampling and max batch size under critical unit load', () => {
    const sampler = new AdaptiveSampler();

    const fastPoint: TelemetryPointPayload = {
      coordinate: [21.0, 52.2],
      timestamp: 1000,
      speedKmh: 95,
      throttlePct: 80,
    };

    // 98% critical unit load
    const evalOverload = sampler.evaluatePowerDosing(fastPoint, 98);
    expect(evalOverload.unitLoadLevel).toBe('CRITICAL');
    expect(evalOverload.samplingIntervalMs).toBeGreaterThan(500);
    expect(evalOverload.maxBatchSize).toBeLessThanOrEqual(25);
  });

  it('should filter stream preserving sharp turns and turbo g-force events', () => {
    const sampler = new AdaptiveSampler();
    const evaluation = sampler.evaluatePowerDosing({
      coordinate: [21.0, 52.2],
      timestamp: 1000,
      speedKmh: 60,
    });

    const stream: TelemetryPointPayload[] = [
      { coordinate: [21.0, 52.2], timestamp: 1000, headingDeg: 0 },
      { coordinate: [21.001, 52.201], timestamp: 1100, headingDeg: 2 }, // minor, skipped
      { coordinate: [21.002, 52.202], timestamp: 1200, headingDeg: 90 }, // sharp turn (>15 deg)
      { coordinate: [21.003, 52.203], timestamp: 1300, headingDeg: 90, gForce: 0.85 }, // extreme g-force
      { coordinate: [21.004, 52.204], timestamp: 2500, headingDeg: 90 }, // time delta passed
    ];

    const filtered = sampler.filterStream(stream, evaluation);
    expect(filtered.length).toBeGreaterThanOrEqual(4);
    expect(filtered.some((p) => p.headingDeg === 90)).toBe(true);
    expect(filtered.some((p) => p.gForce === 0.85)).toBe(true);
  });

  it('should run tiered AI inference and output tactical recommendations', () => {
    const aiEngine = new AiAnalysisTierEngine();
    const sampler = new AdaptiveSampler();

    const highSpeedPoints: TelemetryPointPayload[] = [
      { coordinate: [21.0, 52.2], timestamp: 1000, speedKmh: 140, gForce: 0.9, headingDeg: 10 },
      { coordinate: [21.01, 52.21], timestamp: 1500, speedKmh: 142, gForce: 0.95, headingDeg: 55 },
    ];

    const evalTurbo = sampler.evaluatePowerDosing(highSpeedPoints[1]!, 30);
    const inference = aiEngine.analyzeBatch(highSpeedPoints, evalTurbo);

    expect(inference.tier).toBe('TIER_4_FULL_COCKPIT_AI');
    expect(inference.detectedAnomalies.length).toBeGreaterThan(0);
    expect(inference.detectedAnomalies.some((a) => a.includes('HIGH_SPEED'))).toBe(true);
    expect(inference.safetyCorridorBreached).toBe(true);
    expect(inference.deepInsights).toBeDefined();
    expect(inference.deepInsights?.turboBoostLevel).toBe('TURBO_MAX');
  });
});
