import { describe, expect, it } from 'vitest';
import { evaluateHornTrigger, isHighwayCritical } from '../../src/audio/hornTrigger.js';

describe('evaluateHornTrigger', () => {
  it('blasts only on the rising edge of CRITICAL', () => {
    expect(
      evaluateHornTrigger({ wasCritical: false, priority: 'CRITICAL', mustStop: true })
    ).toEqual({ isCritical: true, action: 'BLAST' });

    expect(
      evaluateHornTrigger({ wasCritical: true, priority: 'CRITICAL', mustStop: true })
    ).toEqual({ isCritical: true, action: 'HOLD' });
  });

  it('blasts on mustStop even if priority is still HIGH', () => {
    expect(isHighwayCritical('HIGH', true)).toBe(true);
    expect(evaluateHornTrigger({ wasCritical: false, priority: 'HIGH', mustStop: true })).toEqual({
      isCritical: true,
      action: 'BLAST',
    });
  });

  it('stops when advice leaves the highway-critical rail', () => {
    expect(evaluateHornTrigger({ wasCritical: true, priority: 'NOMINAL', mustStop: false })).toEqual({
      isCritical: false,
      action: 'STOP',
    });
    expect(evaluateHornTrigger({ wasCritical: false, priority: 'NOMINAL' })).toEqual({
      isCritical: false,
      action: 'HOLD',
    });
  });

  it('does not treat a missing advisory as a silent all-clear blast', () => {
    expect(evaluateHornTrigger({ wasCritical: false })).toEqual({
      isCritical: false,
      action: 'HOLD',
    });
  });
});
