import { useCallback, useRef, useState } from 'react';
import { consultCopilotAgent } from '../src/tactical/copilotAgent.js';

/**
 * Copilot hak kabiny.
 * Przy braku sieci (oraz gdy chmura nie odpowiada) wtryskuje getTacticalAdvice —
 * lokalny silnik HGV, bez udawania modelu.
 */
export function useCopilotAgent({ copilotUrl, timeoutMs } = {}) {
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);

  const requestAdvice = useCallback(
    async (input) => {
      const token = ++generation.current;
      setPending(true);
      try {
        const next = await consultCopilotAgent({
          input,
          ...(copilotUrl !== undefined ? { copilotUrl } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
        if (token === generation.current) {
          setResult(next);
        }
        return next;
      } finally {
        if (token === generation.current) {
          setPending(false);
        }
      }
    },
    [copilotUrl, timeoutMs]
  );

  return {
    advice: result?.advice ?? null,
    source: result?.source ?? null,
    networkState: result?.networkState ?? null,
    cloudError: result?.cloudError,
    pending,
    requestAdvice,
  };
}
