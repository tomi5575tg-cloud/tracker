import { describe, it, expect, vi, afterEach } from 'vitest';
import { HighwayHorn } from '../../src/audio/highwayHorn.js';
import {
  HIGHWAY_HORN_FREQUENCY_HZ,
  HIGHWAY_HORN_WAVEFORM,
  HIGHWAY_PSU_WATTS,
  HIGHWAY_RAIL_GAIN,
  HIGHWAY_RUMBLE_HIGHPASS_HZ,
  HighwayHornError,
} from '../../src/audio/types.js';
import type {
  HornAudioContext,
  HornAudioNode,
  HornAudioParam,
  HornBiquadFilterNode,
  HornCompressorNode,
  HornGainNode,
  HornOscillatorNode,
} from '../../src/audio/types.js';

class FakeParam implements HornAudioParam {
  value = 0;
  setValueAtTime(value: number, _startTime: number): HornAudioParam {
    this.value = value;
    return this;
  }
}

class FakeNode implements HornAudioNode {
  readonly connectedTo: HornAudioNode[] = [];
  connect(destination: HornAudioNode): HornAudioNode {
    this.connectedTo.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connectedTo.length = 0;
  }
}

class FakeOscillator extends FakeNode implements HornOscillatorNode {
  type: OscillatorType = 'sine';
  frequency = new FakeParam();
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeGain extends FakeNode implements HornGainNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode implements HornBiquadFilterNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeCompressor extends FakeNode implements HornCompressorNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}

class FakeContext implements HornAudioContext {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  oscillator = new FakeOscillator();
  highpass = new FakeFilter();
  compressor = new FakeCompressor();
  gate = new FakeGain();

  async resume(): Promise<void> {
    this.state = 'running';
  }
  createOscillator(): HornOscillatorNode {
    this.oscillator = new FakeOscillator();
    return this.oscillator;
  }
  createGain(): HornGainNode {
    this.gate = new FakeGain();
    return this.gate;
  }
  createBiquadFilter(): HornBiquadFilterNode {
    this.highpass = new FakeFilter();
    return this.highpass;
  }
  createDynamicsCompressor(): HornCompressorNode {
    this.compressor = new FakeCompressor();
    return this.compressor;
  }
}

describe('HighwayHorn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a rail that would clip or collapse the 675 W supply', () => {
    expect(() => new HighwayHorn({ railGain: 1.2 })).toThrow(HighwayHornError);
    expect(() => new HighwayHorn({ railGain: 0 })).toThrow(HighwayHornError);
  });

  it('blasts an 880 Hz square wave above rumble and holds the rail voltage', async () => {
    const ctx = new FakeContext();
    const horn = new HighwayHorn({
      createContext: () => ctx,
      pulseCount: 1,
      pulseOnMs: 50,
      pulseOffMs: 50,
    });

    const status = await horn.blastCritical();

    expect(status.frequencyHz).toBe(HIGHWAY_HORN_FREQUENCY_HZ);
    expect(status.waveform).toBe(HIGHWAY_HORN_WAVEFORM);
    expect(status.railGain).toBe(HIGHWAY_RAIL_GAIN);
    expect(status.psuWatts).toBe(HIGHWAY_PSU_WATTS);
    expect(status.sounding).toBe(true);
    expect(ctx.oscillator.type).toBe('square');
    expect(ctx.oscillator.frequency.value).toBe(880);
    expect(ctx.oscillator.started).toBe(true);
    expect(ctx.highpass.type).toBe('highpass');
    expect(ctx.highpass.frequency.value).toBe(HIGHWAY_RUMBLE_HIGHPASS_HZ);
    expect(ctx.gate.gain.value).toBe(HIGHWAY_RAIL_GAIN);
    expect(ctx.oscillator.connectedTo).toContain(ctx.highpass);
    expect(ctx.highpass.connectedTo).toContain(ctx.compressor);
    expect(ctx.compressor.connectedTo).toContain(ctx.gate);
    expect(ctx.gate.connectedTo).toContain(ctx.destination);
  });

  it('silences the graph on stop and drain', async () => {
    const ctx = new FakeContext();
    const horn = new HighwayHorn({ createContext: () => ctx, pulseCount: 8, pulseOnMs: 10_000 });
    await horn.blastCritical();
    horn.stop();
    expect(horn.getStatus().sounding).toBe(false);
    expect(ctx.oscillator.stopped).toBe(true);
    expect(ctx.gate.gain.value).toBe(0);

    await horn.blastCritical();
    horn.drain('PANIC');
    expect(horn.getStatus().sounding).toBe(false);
  });

  it('throws when Web Audio is missing instead of failing silent', () => {
    const horn = new HighwayHorn({
      createContext: () => {
        throw new HighwayHornError('Web Audio API AudioContext is not available');
      },
    });
    return expect(horn.blastCritical()).rejects.toBeInstanceOf(HighwayHornError);
  });

  it('resumes a suspended AudioContext on arm so autoplay does not eat the blast', async () => {
    const ctx = new FakeContext();
    ctx.state = 'suspended';
    const horn = new HighwayHorn({ createContext: () => ctx });
    const status = await horn.arm();
    expect(ctx.state).toBe('running');
    expect(status.contextState).toBe('running');
    expect(status.frequencyHz).toBe(880);
    expect(status.psuWatts).toBe(675);
  });

  it('holds rail gain through the pulse train then closes the gate', async () => {
    vi.useFakeTimers();
    const ctx = new FakeContext();
    const horn = new HighwayHorn({
      createContext: () => ctx,
      pulseCount: 2,
      pulseOnMs: 180,
      pulseOffMs: 120,
    });
    await horn.blastCritical();
    expect(ctx.gate.gain.value).toBe(HIGHWAY_RAIL_GAIN);
    expect(ctx.compressor.ratio.value).toBe(12);

    await vi.advanceTimersByTimeAsync(180);
    expect(ctx.gate.gain.value).toBe(0);
    await vi.advanceTimersByTimeAsync(120);
    expect(horn.getStatus().sounding).toBe(true);
    expect(ctx.gate.gain.value).toBe(HIGHWAY_RAIL_GAIN);
    await vi.advanceTimersByTimeAsync(180 + 120);
    expect(horn.getStatus().sounding).toBe(false);
  });
});
