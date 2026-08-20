import type { TacticalAdvicePriority } from '../tactical/types.js';

export type HornTriggerAction = 'BLAST' | 'STOP' | 'HOLD';

export interface HornTriggerInput {
  readonly wasCritical: boolean;
  readonly priority?: TacticalAdvicePriority | null | undefined;
  readonly mustStop?: boolean | undefined;
}

export interface HornTriggerResult {
  readonly isCritical: boolean;
  readonly action: HornTriggerAction;
}

/**
 * CRITICAL / mustStop is the only command that opens the 880 Hz square-wave gate.
 * Rising edge blasts once; GNSS ticks on the same priority do not retrigger;
 * leaving CRITICAL closes the gate instead of leaving a hanging oscillator.
 */
export function isHighwayCritical(
  priority?: TacticalAdvicePriority | null,
  mustStop = false
): boolean {
  return priority === 'CRITICAL' || mustStop === true;
}

export function evaluateHornTrigger(input: HornTriggerInput): HornTriggerResult {
  const isCritical = isHighwayCritical(input.priority, input.mustStop === true);
  if (!isCritical) {
    return { isCritical: false, action: input.wasCritical ? 'STOP' : 'HOLD' };
  }
  return { isCritical: true, action: input.wasCritical ? 'HOLD' : 'BLAST' };
}
