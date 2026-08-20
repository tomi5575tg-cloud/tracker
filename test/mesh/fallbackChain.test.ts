import { describe, it, expect, vi } from 'vitest';
import { FallbackChain } from '../../src/mesh/fallbackChain.js';
import { DegradationLevel, MeshSubsystem } from '../../src/mesh/types.js';

describe('FallbackChain (Multi-Tier Graceful Degradation)', () => {
  it('should execute primary Tier 0 when healthy', async () => {
    const chain = new FallbackChain<string, string>({
      subsystem: MeshSubsystem.POSITIONING,
    });

    chain.registerTier({
      tierName: 'PRIMARY_GPS',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: (input) => `GPS_FIX_${input}`,
    });

    chain.registerTier({
      tierName: 'DEAD_RECKONING',
      degradationLevel: DegradationLevel.DEGRADED_FALLBACK,
      execute: (input) => `DR_${input}`,
    });

    const result = await chain.execute('123');
    expect(result.data).toBe('GPS_FIX_123');
    expect(result.tierIndex).toBe(0);
    expect(result.tierName).toBe('PRIMARY_GPS');
    expect(result.degradationLevel).toBe(DegradationLevel.OPTIMAL);
    expect(result.isFallback).toBe(false);
    expect(result.errorChain).toHaveLength(0);
  });

  it('should gracefully degrade to Tier 1 when Tier 0 fails', async () => {
    const fallbackEvents: unknown[] = [];
    const chain = new FallbackChain<string, string>({
      subsystem: MeshSubsystem.POSITIONING,
      onTierFallback: (evt) => fallbackEvents.push(evt),
    });

    chain.registerTier({
      tierName: 'PRIMARY_GPS',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: () => {
        throw new Error('GPS satellite signal lost');
      },
    });

    chain.registerTier({
      tierName: 'DEAD_RECKONING',
      degradationLevel: DegradationLevel.DEGRADED_FALLBACK,
      execute: (input) => `DR_${input}`,
    });

    const result = await chain.execute('WARSAW');
    expect(result.data).toBe('DR_WARSAW');
    expect(result.tierIndex).toBe(1);
    expect(result.tierName).toBe('DEAD_RECKONING');
    expect(result.degradationLevel).toBe(DegradationLevel.DEGRADED_FALLBACK);
    expect(result.isFallback).toBe(true);
    expect(result.errorChain).toHaveLength(1);
    expect(result.errorChain[0]?.tierName).toBe('PRIMARY_GPS');
    expect(result.errorChain[0]?.error.message).toBe('GPS satellite signal lost');

    expect(fallbackEvents).toHaveLength(1);
  });

  it('should enforce tier timeout and seamlessly degrade to next tier', async () => {
    const chain = new FallbackChain<string, string>({
      subsystem: MeshSubsystem.ROUTING,
    });

    chain.registerTier({
      tierName: 'CLOUD_OSRM_ROUTING',
      degradationLevel: DegradationLevel.OPTIMAL,
      timeoutMs: 30,
      execute: () => new Promise((resolve) => setTimeout(() => resolve('CLOUD_ROUTE'), 150)),
    });

    chain.registerTier({
      tierName: 'OFFLINE_CORRIDOR',
      degradationLevel: DegradationLevel.OFFLINE_CACHED,
      execute: () => 'OFFLINE_CACHED_ROUTE',
    });

    const result = await chain.execute('START_END');
    expect(result.data).toBe('OFFLINE_CACHED_ROUTE');
    expect(result.tierName).toBe('OFFLINE_CORRIDOR');
    expect(result.degradationLevel).toBe(DegradationLevel.OFFLINE_CACHED);
    expect(result.isFallback).toBe(true);
  });

  it('should trigger ultimate fallback handler when all registered tiers fail', async () => {
    const chain = new FallbackChain<string, string>({
      subsystem: MeshSubsystem.RENDERING,
      ultimateFallback: (input, errors) => `ULTIMATE_SURVIVAL_DOM_${input}_(${errors.length}_ERRORS)`,
    });

    chain.registerTier({
      tierName: 'WEBGL_GPU',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: () => {
        throw new Error('WebGL context crashed');
      },
    });

    chain.registerTier({
      tierName: 'CANVAS_2D',
      degradationLevel: DegradationLevel.DEGRADED_FALLBACK,
      execute: () => {
        throw new Error('Canvas 2D context unavailable');
      },
    });

    const result = await chain.execute('PANEL');
    expect(result.data).toBe('ULTIMATE_SURVIVAL_DOM_PANEL_(2_ERRORS)');
    expect(result.tierName).toBe('ULTIMATE_SURVIVAL_HANDLER');
    expect(result.degradationLevel).toBe(DegradationLevel.CRITICAL_SURVIVAL);
    expect(result.isFallback).toBe(true);
    expect(result.errorChain).toHaveLength(2);
  });

  it('should generate accurate SubsystemHealthReport', async () => {
    const chain = new FallbackChain<string, string>({
      subsystem: MeshSubsystem.LIGHTING,
    });

    chain.registerTier({
      tierName: 'EPHEMERIS_3D',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: () => 'SUN_SHADERS',
    });

    const initialReport = chain.getHealthReport();
    expect(initialReport.subsystem).toBe(MeshSubsystem.LIGHTING);
    expect(initialReport.isHealthy).toBe(true);
    expect(initialReport.activeTierName).toBe('EPHEMERIS_3D');
    expect(initialReport.degradationLevel).toBe(DegradationLevel.OPTIMAL);

    await chain.execute('test');
    expect(chain.getHealthReport().lastSuccessTimestamp).toBeGreaterThan(0);
  });
});
