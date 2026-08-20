import { describe, it, expect, vi } from 'vitest';
import { consultCopilotAgent } from '../../src/tactical/copilotAgent.js';
import { CircuitBreaker } from '../../src/resilience/circuitBreaker.js';
import type { HgvProfile, TacticalAdvice } from '../../src/tactical/types.js';

const WARSAW: [number, number] = [21.0122, 52.2297];
const TIR: HgvProfile = {
  heightMeters: 4.0,
  widthMeters: 2.55,
  lengthMeters: 16.5,
  grossWeightTonnes: 40,
};

const input = {
  currentCoords: WARSAW,
  speed: 70,
  isNight: false,
  hgvProfile: TIR,
};

describe('consultCopilotAgent', () => {
  it('injects getTacticalAdvice immediately when the network is down', async () => {
    const fetchImpl = vi.fn();
    const result = await consultCopilotAgent({
      input,
      copilotUrl: 'https://copilot.example/advice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isOnline: () => false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.source).toBe('LOCAL_EMERGENCY_INJECTION');
    expect(result.networkState).toBe('OFFLINE');
    expect(result.advice.coordinate).toEqual(WARSAW);
    expect(result.cloudError).toBe('navigator_offline');
  });

  it('does not label local rules as CLOUD_COPILOT when no endpoint is configured', async () => {
    const result = await consultCopilotAgent({
      input,
      isOnline: () => true,
    });

    expect(result.source).toBe('LOCAL_EMERGENCY_INJECTION');
    expect(result.networkState).toBe('ONLINE');
    expect(result.cloudError).toBe('copilot_url_not_configured');
  });

  it('falls back to local injection when the cloud hop fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('failed to fetch');
    });
    const result = await consultCopilotAgent({
      input,
      copilotUrl: 'https://copilot.example/advice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isOnline: () => true,
      breaker: new CircuitBreaker({ name: 'test-cloud', failureThreshold: 5 }),
    });

    expect(result.source).toBe('LOCAL_EMERGENCY_INJECTION');
    expect(result.networkState).toBe('UNREACHABLE');
    expect(result.cloudError).toContain('failed to fetch');
    expect(result.advice.mustStop).toBe(false);
  });

  it('uses a valid cloud payload only when it matches the TacticalAdvice contract', async () => {
    const cloudAdvice: TacticalAdvice = {
      priority: 'HIGH',
      code: 'CLOUD_SLOW',
      headline: 'Chmura: zwolnić przed zjazdem',
      detail: 'cloud',
      recommendedSpeedKmh: 40,
      mustStop: false,
      bridgeFit: 'CLEAR',
      maneuverWindowSec: 12,
      advisories: [{ code: 'CLOUD_SLOW', priority: 'HIGH', message: 'Chmura: zwolnić przed zjazdem' }],
      coordinate: WARSAW,
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => cloudAdvice,
    }));

    const result = await consultCopilotAgent({
      input,
      copilotUrl: 'https://copilot.example/advice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isOnline: () => true,
      breaker: new CircuitBreaker({ name: 'test-cloud-ok', failureThreshold: 5 }),
    });

    expect(result.source).toBe('CLOUD_COPILOT');
    expect(result.networkState).toBe('ONLINE');
    expect(result.advice.code).toBe('CLOUD_SLOW');
  });

  it('rejects a malformed cloud body and injects local advice instead', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ witty: true }),
    }));

    const result = await consultCopilotAgent({
      input: {
        ...input,
        upcomingBridge: { id: 'low', clearanceMeters: 3.5, distanceMeters: 100 },
      },
      copilotUrl: 'https://copilot.example/advice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isOnline: () => true,
      breaker: new CircuitBreaker({ name: 'test-cloud-bad', failureThreshold: 5 }),
    });

    expect(result.source).toBe('LOCAL_EMERGENCY_INJECTION');
    expect(result.advice.mustStop).toBe(true);
    expect(result.cloudError).toContain('TacticalAdvice contract');
  });
});
