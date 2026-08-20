import type { SessionDrainHook } from '../auth/drainManager.js';
import {
  HIGHWAY_HORN_FREQUENCY_HZ,
  HIGHWAY_HORN_WAVEFORM,
  HIGHWAY_PSU_WATTS,
  HIGHWAY_RAIL_GAIN,
  HIGHWAY_RUMBLE_HIGHPASS_HZ,
  HighwayHornError,
  type AudioContextFactory,
  type HighwayHornStatus,
  type HornAudioContext,
  type HornGainNode,
  type HornOscillatorNode,
} from './types.js';

export type { HighwayHornStatus, AudioContextFactory } from './types.js';

export interface HighwayHornConfig {
  readonly createContext?: AudioContextFactory | undefined;
  readonly railGain?: number | undefined;
  readonly pulseOnMs?: number | undefined;
  readonly pulseOffMs?: number | undefined;
  readonly pulseCount?: number | undefined;
}

function defaultContextFactory(): HornAudioContext {
  const Ctor =
    typeof globalThis !== 'undefined'
      ? (globalThis as unknown as { AudioContext?: new () => HornAudioContext; webkitAudioContext?: new () => HornAudioContext })
          .AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: new () => HornAudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) {
    throw new HighwayHornError('Web Audio API AudioContext is not available');
  }
  return new Ctor();
}

/**
 * 880 Hz square-wave cabin horn sized to cut tire noise and engine rumble.
 * Rail gain is clamped and held — 100% current on a 675 W supply that must not sag.
 */
export class HighwayHorn implements SessionDrainHook {
  private readonly createContext: AudioContextFactory;
  private readonly railGain: number;
  private readonly pulseOnMs: number;
  private readonly pulseOffMs: number;
  private readonly pulseCount: number;

  private context: HornAudioContext | null = null;
  private oscillator: HornOscillatorNode | null = null;
  private gate: HornGainNode | null = null;
  private sounding = false;
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: HighwayHornConfig = {}) {
    const rail = config.railGain ?? HIGHWAY_RAIL_GAIN;
    if (!Number.isFinite(rail) || rail <= 0 || rail > 1) {
      throw new HighwayHornError(`rail gain ${rail} would collapse or clip the 675 W voltage rail`);
    }
    this.createContext = config.createContext ?? defaultContextFactory;
    this.railGain = rail;
    this.pulseOnMs = config.pulseOnMs ?? 180;
    this.pulseOffMs = config.pulseOffMs ?? 120;
    this.pulseCount = config.pulseCount ?? 4;
  }

  public async arm(): Promise<HighwayHornStatus> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return this.getStatus();
  }

  public async blastCritical(): Promise<HighwayHornStatus> {
    await this.arm();
    this.startGraph();
    this.sounding = true;
    this.runPulseTrain(0);
    return this.getStatus();
  }

  public stop(): void {
    this.clearPulse();
    if (this.gate) {
      this.gate.gain.setValueAtTime(0, this.context?.currentTime ?? 0);
    }
    if (this.oscillator) {
      try {
        this.oscillator.stop();
      } catch {
        // already stopped
      }
      this.oscillator.disconnect();
      this.oscillator = null;
    }
    this.gate?.disconnect();
    this.gate = null;
    this.sounding = false;
  }

  public drain(_reason = 'HIGHWAY_HORN_DRAIN', _previousSession?: unknown): void {
    this.stop();
  }

  public getStatus(): HighwayHornStatus {
    return {
      frequencyHz: HIGHWAY_HORN_FREQUENCY_HZ,
      waveform: HIGHWAY_HORN_WAVEFORM,
      railGain: this.railGain,
      psuWatts: HIGHWAY_PSU_WATTS,
      rumbleHighpassHz: HIGHWAY_RUMBLE_HIGHPASS_HZ,
      sounding: this.sounding,
      contextState: this.context?.state ?? 'unarmed',
    };
  }

  private ensureContext(): HornAudioContext {
    if (!this.context) {
      this.context = this.createContext();
    }
    return this.context;
  }

  private startGraph(): void {
    this.stop();
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    osc.type = HIGHWAY_HORN_WAVEFORM;
    osc.frequency.setValueAtTime(HIGHWAY_HORN_FREQUENCY_HZ, ctx.currentTime);

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(HIGHWAY_RUMBLE_HIGHPASS_HZ, ctx.currentTime);
    highpass.Q.setValueAtTime(0.707, ctx.currentTime);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(0, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.12, ctx.currentTime);

    const gate = ctx.createGain();
    gate.gain.setValueAtTime(0, ctx.currentTime);

    osc.connect(highpass);
    highpass.connect(compressor);
    compressor.connect(gate);
    gate.connect(ctx.destination);

    osc.start();
    this.oscillator = osc;
    this.gate = gate;
  }

  private runPulseTrain(index: number): void {
    if (!this.sounding || !this.gate || !this.context) {
      return;
    }
    if (index >= this.pulseCount) {
      this.stop();
      return;
    }
    const t = this.context.currentTime;
    this.gate.gain.setValueAtTime(this.railGain, t);
    this.pulseTimer = setTimeout(() => {
      if (!this.sounding || !this.gate || !this.context) {
        return;
      }
      this.gate.gain.setValueAtTime(0, this.context.currentTime);
      this.pulseTimer = setTimeout(() => this.runPulseTrain(index + 1), this.pulseOffMs);
    }, this.pulseOnMs);
  }

  private clearPulse(): void {
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
  }
}
