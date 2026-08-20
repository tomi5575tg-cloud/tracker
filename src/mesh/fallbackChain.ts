import {
  DegradationLevel,
  MeshSubsystem,
  CircuitState,
  type FallbackTier,
  type FallbackExecutionResult,
  type SubsystemHealthReport,
  type CircuitBreakerConfig,
} from './types.js';
import { CircuitBreaker } from './circuitBreaker.js';

export interface FallbackChainConfig<TInput, TOutput> {
  readonly subsystem: MeshSubsystem;
  readonly defaultCircuitConfig?: Partial<CircuitBreakerConfig> | undefined;
  readonly ultimateFallback?: ((input: TInput, errorChain: ReadonlyArray<{ tierName: string; error: Error }>) => TOutput) | undefined;
  readonly onTierFallback?: ((info: {
    subsystem: MeshSubsystem;
    failedTier: string;
    nextTier: string;
    error: Error;
    degradationLevel: DegradationLevel;
  }) => void) | undefined;
}

interface TierRegistration<TInput, TOutput> {
  readonly tier: FallbackTier<TInput, TOutput>;
  readonly circuitBreaker: CircuitBreaker;
}

export class FallbackChain<TInput, TOutput> {
  private readonly subsystem: MeshSubsystem;
  private readonly tiers: Array<TierRegistration<TInput, TOutput>> = [];
  private readonly config: FallbackChainConfig<TInput, TOutput>;
  private activeTierIndex = 0;
  private lastSuccessTimestamp = Date.now();
  private lastFailureTimestamp?: number | undefined;
  private lastError?: string | undefined;

  constructor(config: FallbackChainConfig<TInput, TOutput>) {
    this.subsystem = config.subsystem;
    this.config = config;
  }

  public registerTier(
    tier: FallbackTier<TInput, TOutput>,
    circuitConfig?: Partial<CircuitBreakerConfig>
  ): this {
    const breaker = new CircuitBreaker(circuitConfig ?? this.config.defaultCircuitConfig ?? {});
    this.tiers.push({ tier, circuitBreaker: breaker });
    return this;
  }

  public getSubsystem(): MeshSubsystem {
    return this.subsystem;
  }

  public getTiersCount(): number {
    return this.tiers.length;
  }

  public getTier(index: number): FallbackTier<TInput, TOutput> | undefined {
    return this.tiers[index]?.tier;
  }

  public getActiveTierIndex(): number {
    return this.activeTierIndex;
  }

  public async execute(
    input: TInput,
    overrideUltimateFallback?: TOutput
  ): Promise<FallbackExecutionResult<TOutput>> {
    const startTime = Date.now();
    const errorChain: Array<{ tierName: string; error: Error }> = [];

    if (this.tiers.length === 0) {
      if (overrideUltimateFallback !== undefined) {
        return {
          data: overrideUltimateFallback,
          tierIndex: -1,
          tierName: 'EMERGENCY_STATIC_FALLBACK',
          degradationLevel: DegradationLevel.CRITICAL_SURVIVAL,
          executionTimeMs: Date.now() - startTime,
          isFallback: true,
          errorChain: [{ tierName: 'NO_TIERS_CONFIGURED', error: new Error('No tiers registered in fallback chain') }],
        };
      }
      throw new Error(`FallbackChain [${this.subsystem}] has no registered tiers and no ultimate fallback.`);
    }

    for (let i = 0; i < this.tiers.length; i++) {
      const reg = this.tiers[i];
      if (!reg) continue;

      const { tier, circuitBreaker } = reg;

      // Check if tier is statically declared available
      if (tier.isAvailable && !tier.isAvailable()) {
        errorChain.push({
          tierName: tier.tierName,
          error: new Error(`Tier ${tier.tierName} is currently unavailable (isAvailable returned false)`),
        });
        continue;
      }

      // Check circuit breaker availability
      if (!circuitBreaker.isAvailable()) {
        errorChain.push({
          tierName: tier.tierName,
          error: new Error(`Circuit breaker for tier ${tier.tierName} is in state ${circuitBreaker.getState()}`),
        });
        continue;
      }

      try {
        const data = await circuitBreaker.execute(
          () => tier.execute(input),
          tier.timeoutMs
        );

        this.activeTierIndex = i;
        this.lastSuccessTimestamp = Date.now();
        const duration = Date.now() - startTime;

        return {
          data,
          tierIndex: i,
          tierName: tier.tierName,
          degradationLevel: tier.degradationLevel,
          executionTimeMs: duration,
          isFallback: i > 0 || errorChain.length > 0,
          errorChain,
        };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        errorChain.push({ tierName: tier.tierName, error });
        this.lastFailureTimestamp = Date.now();
        this.lastError = error.message;

        const nextTierName = this.tiers[i + 1]?.tier.tierName ?? 'ULTIMATE_FALLBACK';
        const nextDegradation = this.tiers[i + 1]?.tier.degradationLevel ?? DegradationLevel.CRITICAL_SURVIVAL;

        this.config.onTierFallback?.({
          subsystem: this.subsystem,
          failedTier: tier.tierName,
          nextTier: nextTierName,
          error,
          degradationLevel: nextDegradation,
        });
      }
    }

    // All registered tiers failed: execute Ultimate Deterministic Fallback
    const duration = Date.now() - startTime;
    this.activeTierIndex = this.tiers.length;

    if (this.config.ultimateFallback) {
      try {
        const fallbackData = this.config.ultimateFallback(input, errorChain);
        return {
          data: fallbackData,
          tierIndex: this.tiers.length,
          tierName: 'ULTIMATE_SURVIVAL_HANDLER',
          degradationLevel: DegradationLevel.CRITICAL_SURVIVAL,
          executionTimeMs: duration,
          isFallback: true,
          errorChain,
        };
      } catch (fatalFallbackError: unknown) {
        const fatalError = fatalFallbackError instanceof Error ? fatalFallbackError : new Error(String(fatalFallbackError));
        errorChain.push({ tierName: 'ULTIMATE_SURVIVAL_HANDLER', error: fatalError });
      }
    }

    if (overrideUltimateFallback !== undefined) {
      return {
        data: overrideUltimateFallback,
        tierIndex: this.tiers.length,
        tierName: 'OVERRIDE_STATIC_FALLBACK',
        degradationLevel: DegradationLevel.CRITICAL_SURVIVAL,
        executionTimeMs: duration,
        isFallback: true,
        errorChain,
      };
    }

    // If literally everything failed, create a synthetic default or rethrow with rich diagnostics
    throw new Error(
      `CRITICAL MESH FAILURE: All ${this.tiers.length} fallback tiers in subsystem [${this.subsystem}] failed. Errors: ${errorChain.map(e => `[${e.tierName}: ${e.error.message}]`).join(', ')}`
    );
  }

  public getHealthReport(): SubsystemHealthReport {
    const activeReg = this.tiers[this.activeTierIndex] ?? this.tiers[0];
    const circuitState = activeReg?.circuitBreaker.getState() ?? CircuitState.CLOSED;
    const isHealthy = this.activeTierIndex === 0 && circuitState === CircuitState.CLOSED;

    let consecutiveFailures = 0;
    for (const reg of this.tiers) {
      consecutiveFailures += reg.circuitBreaker.getMetrics().consecutiveFailures;
    }

    return {
      subsystem: this.subsystem,
      activeTierIndex: this.activeTierIndex,
      totalTiers: this.tiers.length,
      activeTierName: activeReg?.tier.tierName ?? 'UNKNOWN',
      circuitState,
      degradationLevel: activeReg?.tier.degradationLevel ?? DegradationLevel.CRITICAL_SURVIVAL,
      isHealthy,
      consecutiveFailures,
      lastError: this.lastError,
      lastSuccessTimestamp: this.lastSuccessTimestamp,
      lastFailureTimestamp: this.lastFailureTimestamp,
    };
  }

  public resetAllCircuits(): void {
    for (const reg of this.tiers) {
      reg.circuitBreaker.reset();
    }
    this.activeTierIndex = 0;
    this.lastError = undefined;
  }
}
