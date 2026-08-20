export const HIGHWAY_HORN_FREQUENCY_HZ = 880;
export const HIGHWAY_HORN_WAVEFORM = 'square' as const;
/** Rated rail: 100% current without clipping the destination into distortion. */
export const HIGHWAY_RAIL_GAIN = 0.85;
/** Dual-PSU metaphor — documented power class the rail is sized for. */
export const HIGHWAY_PSU_WATTS = 675;
/** Sit above cabin rumble (engine + tire, typically < 250 Hz). */
export const HIGHWAY_RUMBLE_HIGHPASS_HZ = 400;

export class HighwayHornError extends Error {
  override readonly name = 'HighwayHornError';

  constructor(message: string) {
    super(message);
  }
}

export interface HornAudioParam {
  value: number;
  setValueAtTime(value: number, startTime: number): HornAudioParam;
}

export interface HornAudioNode {
  connect(destination: HornAudioNode): HornAudioNode;
  disconnect(): void;
}

export interface HornOscillatorNode extends HornAudioNode {
  type: OscillatorType;
  frequency: HornAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface HornGainNode extends HornAudioNode {
  gain: HornAudioParam;
}

export interface HornBiquadFilterNode extends HornAudioNode {
  type: BiquadFilterType;
  frequency: HornAudioParam;
  Q: HornAudioParam;
}

export interface HornCompressorNode extends HornAudioNode {
  threshold: HornAudioParam;
  knee: HornAudioParam;
  ratio: HornAudioParam;
  attack: HornAudioParam;
  release: HornAudioParam;
}

export interface HornAudioContext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: HornAudioNode;
  resume(): Promise<void>;
  createOscillator(): HornOscillatorNode;
  createGain(): HornGainNode;
  createBiquadFilter(): HornBiquadFilterNode;
  createDynamicsCompressor(): HornCompressorNode;
}

export interface HighwayHornStatus {
  readonly frequencyHz: number;
  readonly waveform: typeof HIGHWAY_HORN_WAVEFORM;
  readonly railGain: number;
  readonly psuWatts: number;
  readonly rumbleHighpassHz: number;
  readonly sounding: boolean;
  readonly contextState: string;
}

export type AudioContextFactory = () => HornAudioContext;
