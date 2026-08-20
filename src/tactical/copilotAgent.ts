import { CircuitBreaker } from '../resilience/circuitBreaker.js';
import { getTacticalAdvice } from './advice.js';
import type { TacticalAdvice, TacticalAdviceInput } from './types.js';

export type CopilotNetworkState = 'ONLINE' | 'OFFLINE' | 'UNREACHABLE';
export type CopilotAdviceSource = 'CLOUD_COPILOT' | 'LOCAL_EMERGENCY_INJECTION';

export interface CopilotConsultResult {
  readonly source: CopilotAdviceSource;
  readonly networkState: CopilotNetworkState;
  readonly advice: TacticalAdvice;
  readonly cloudError?: string | undefined;
}

export interface ConsultCopilotAgentOptions {
  readonly input: TacticalAdviceInput;
  readonly copilotUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly isOnline?: (() => boolean) | undefined;
  readonly timeoutMs?: number | undefined;
  readonly breaker?: CircuitBreaker | undefined;
}

const cloudBreaker = new CircuitBreaker({
  name: 'CLOUD_COPILOT',
  failureThreshold: 3,
  resetTimeoutMs: 15_000,
});

function detectOnline(isOnline?: () => boolean): boolean {
  if (isOnline) {
    return isOnline();
  }
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

function isTacticalAdvicePayload(value: unknown): value is TacticalAdvice {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['priority'] === 'string' &&
    typeof candidate['code'] === 'string' &&
    typeof candidate['headline'] === 'string' &&
    typeof candidate['detail'] === 'string' &&
    typeof candidate['recommendedSpeedKmh'] === 'number' &&
    typeof candidate['mustStop'] === 'boolean' &&
    typeof candidate['bridgeFit'] === 'string' &&
    Array.isArray(candidate['advisories']) &&
    Array.isArray(candidate['coordinate'])
  );
}

async function injectLocal(input: TacticalAdviceInput, networkState: CopilotNetworkState, cloudError?: string): Promise<CopilotConsultResult> {
  const advice = await getTacticalAdvice(input);
  return {
    source: 'LOCAL_EMERGENCY_INJECTION',
    networkState,
    advice,
    ...(cloudError !== undefined ? { cloudError } : {}),
  };
}

/**
 * Cloud copilot when the link is up; otherwise emergency injection of getTacticalAdvice.
 * A downed network never produces a CLOUD_COPILOT label.
 */
export async function consultCopilotAgent(options: ConsultCopilotAgentOptions): Promise<CopilotConsultResult> {
  const online = detectOnline(options.isOnline);
  if (!online) {
    return injectLocal(options.input, 'OFFLINE', 'navigator_offline');
  }

  const url = options.copilotUrl;
  if (!url) {
    return injectLocal(options.input, 'ONLINE', 'copilot_url_not_configured');
  }

  const breaker = options.breaker ?? cloudBreaker;
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) {
    return injectLocal(options.input, 'UNREACHABLE', 'fetch_unavailable');
  }

  try {
    return await breaker.executeAsync(async () => {
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? 2500;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options.input),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`cloud copilot HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        if (!isTacticalAdvicePayload(payload)) {
          throw new Error('cloud copilot payload failed TacticalAdvice contract');
        }
        return {
          source: 'CLOUD_COPILOT' as const,
          networkState: 'ONLINE' as const,
          advice: payload,
        };
      } finally {
        clearTimeout(timer);
      }
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return injectLocal(options.input, 'UNREACHABLE', message);
  }
}
