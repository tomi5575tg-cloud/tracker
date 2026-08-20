import type { Position } from '../geojson/types.js';
import type {
  MapLibreMapInstance,
  MapLibreLightSpecification,
} from '../maplibre/types.js';
import type {
  DynamicLightingConfig,
  DynamicLightingState,
  DynamicLightingThemePalette,
  CelestialBodyType,
} from './types.js';
import { DEFAULT_LIGHTING_PALETTE } from './types.js';
import { CelestialCalculator } from './celestialCalculator.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export class DynamicLightingManager implements SessionDrainHook {
  private readonly map?: MapLibreMapInstance | undefined;
  private readonly config: DynamicLightingConfig;
  private readonly palette: DynamicLightingThemePalette;

  private observerCoordinate: Position;
  private currentState: DynamicLightingState | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private simulatedTimeOffsetMs = 0;
  private isRunning = false;

  constructor(map?: MapLibreMapInstance, config: DynamicLightingConfig = {}) {
    this.map = map;
    this.config = config;
    this.palette = {
      ...DEFAULT_LIGHTING_PALETTE,
      ...config.palette,
    };

    // Default observer coordinate (e.g. Warsaw [21.0122, 52.2297])
    this.observerCoordinate = config.observerCoordinate ?? [21.0122, 52.2297];

    if (config.customTimestamp !== undefined) {
      this.simulatedTimeOffsetMs = config.customTimestamp - Date.now();
    }

    this.recalculate();

    if (config.updateIntervalMs && config.updateIntervalMs > 0) {
      this.startTimer(config.updateIntervalMs);
    }
  }

  public getState(): DynamicLightingState {
    if (!this.currentState) {
      this.recalculate(Date.now());
    }
    return this.currentState!;
  }

  public setObserverCoordinate(coord: Position): void {
    this.observerCoordinate = coord;
    this.recalculate();
  }

  public getObserverCoordinate(): Position {
    return this.observerCoordinate;
  }

  /**
   * Evaluates lighting for a specific timestamp (or current time)
   */
  public evaluate(timestamp: number = Date.now()): DynamicLightingState {
    const sun = CelestialCalculator.calculateSun(this.observerCoordinate, timestamp);
    const moon = CelestialCalculator.calculateMoon(this.observerCoordinate, timestamp);

    // Dominant celestial light source:
    // If sun altitude > -6 deg (Day or Civil Twilight), Sun dominates.
    // Otherwise Moon provides ambient and directional night glow.
    const isSunDominant = sun.position.altitudeDegrees > -6.0;
    const dominantBody: CelestialBodyType = isSunDominant ? 'SUN' : 'MOON';

    // Calculate light color, intensity and azimuth/polar angles
    const { lightSpec, ambientColor, diffuseColor, shadowColor, skyColor } =
      this.computeLightProperties(sun, moon, dominantBody);

    const state: DynamicLightingState = {
      timestamp,
      observerCoordinate: this.observerCoordinate,
      dominantBody,
      sun,
      moon,
      lightSpecification: lightSpec,
      ambientLightColor: ambientColor,
      diffuseLightColor: diffuseColor,
      shadowColor,
      skyColor,
      terrainExaggeration: isSunDominant ? 1.0 : 1.25,
    };

    return state;
  }

  /**
   * Recalculates lighting state and applies it to the MapLibre map instance
   */
  public recalculate(timestamp?: number): DynamicLightingState {
    const effectiveTime = timestamp ?? (Date.now() + this.simulatedTimeOffsetMs);
    const state = this.evaluate(effectiveTime);
    this.currentState = state;

    if (this.map) {
      this.applyToMap(this.map, state);
    }

    this.config.onLightingChange?.(state);
    return state;
  }

  /**
   * Applies the calculated lighting specification to a MapLibre Map instance
   */
  public applyToMap(map: MapLibreMapInstance, state?: DynamicLightingState): void {
    const current = state ?? this.getState();

    if (typeof map.setLight === 'function') {
      try {
        map.setLight(current.lightSpecification);
      } catch {
        // Safe fallback
      }
    }

    // Apply hillshade layer shadows if layer exists on map
    this.update3dHillshadeAndBuildingLayers(map, current);
  }

  /**
   * Starts real-time or accelerated time lighting synchronization loop
   */
  public startTimer(intervalMs = 5000): void {
    this.stopTimer();
    this.isRunning = true;

    const multiplier = this.config.simulatedTimeMultiplier ?? 1.0;
    let lastTick = Date.now();

    this.updateTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;

      if (multiplier !== 1.0) {
        this.simulatedTimeOffsetMs += elapsed * (multiplier - 1.0);
      }

      this.recalculate();
    }, intervalMs);
  }

  public stopTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.isRunning = false;
  }

  public isTimerActive(): boolean {
    return this.isRunning;
  }

  /**
   * Sets custom simulated time
   */
  public setTime(timestamp: number): DynamicLightingState {
    this.simulatedTimeOffsetMs = timestamp - Date.now();
    return this.recalculate(timestamp);
  }

  /**
   * Fast-forwards or rewinds by hours
   */
  public advanceHours(hours: number): DynamicLightingState {
    this.simulatedTimeOffsetMs += hours * 3600000;
    return this.recalculate();
  }

  /**
   * SessionDrainHook implementation:
   * Stops active timers and resets simulated offset upon user session drain.
   */
  public drain(_reason: string, _previousSession?: unknown): void {
    this.stopTimer();
    this.simulatedTimeOffsetMs = 0;
    this.recalculate(Date.now());
  }

  public destroy(): void {
    this.stopTimer();
  }

  private computeLightProperties(
    sun: ReturnType<typeof CelestialCalculator.calculateSun>,
    moon: ReturnType<typeof CelestialCalculator.calculateMoon>,
    dominantBody: CelestialBodyType
  ): {
    lightSpec: MapLibreLightSpecification;
    ambientColor: string;
    diffuseColor: string;
    shadowColor: string;
    skyColor: string;
  } {
    const minInt = this.config.minIntensity ?? 0.15;
    const maxInt = this.config.maxIntensity ?? 0.85;

    let lightColor: string;
    let intensity: number;
    let azimuthDeg: number;
    let polarDeg: number;
    let ambientColor: string;
    let diffuseColor: string;
    let shadowColor: string;
    let skyColor: string;

    if (dominantBody === 'SUN') {
      const alt = sun.position.altitudeDegrees;
      azimuthDeg = sun.position.azimuthDegrees;
      // Polar angle: 0 = straight up (zenith), 90 = horizon
      polarDeg = Math.max(5, Math.min(88, sun.position.zenithDegrees));

      if (alt > 20) {
        // High Daylight (Full Sun)
        lightColor = this.palette.noonSunColor;
        intensity = maxInt;
        ambientColor = this.palette.ambientDayColor;
        diffuseColor = '#FFFFFF';
        shadowColor = 'rgba(0, 0, 0, 0.45)';
        skyColor = '#87CEEB';
      } else if (alt > 0) {
        // Golden Hour / Sunrise / Sunset
        lightColor = this.palette.goldenHourColor;
        intensity = maxInt * 0.9;
        ambientColor = '#FFE0B2';
        diffuseColor = this.palette.goldenHourColor;
        shadowColor = 'rgba(40, 20, 0, 0.6)';
        skyColor = '#FF9800';
      } else {
        // Civil Twilight / Dusk
        lightColor = this.palette.civilDuskColor;
        intensity = 0.4;
        ambientColor = '#C5CAE9';
        diffuseColor = this.palette.civilDuskColor;
        shadowColor = 'rgba(10, 10, 30, 0.7)';
        skyColor = '#3F51B5';
      }
    } else {
      // Moon Night Light
      azimuthDeg = moon.position.azimuthDegrees;
      polarDeg = Math.max(10, Math.min(85, moon.position.zenithDegrees));

      // Lunar intensity scaled by moon illumination fraction (Full moon is much brighter than new moon)
      const lunarIllumination = Math.max(0.1, moon.illuminatedFraction);
      intensity = minInt + (0.45 - minInt) * lunarIllumination;

      if (moon.illuminatedFraction > 0.6) {
        // Full / Gibbous Moon: cool silver-blue glow
        lightColor = this.palette.fullMoonColor;
        diffuseColor = '#9FA8DA';
        shadowColor = 'rgba(0, 5, 20, 0.85)';
        skyColor = '#0A0E1A';
      } else {
        // Crescent / New Moon: dark deep obsidian navy
        lightColor = this.palette.newMoonColor;
        diffuseColor = '#303F9F';
        shadowColor = 'rgba(0, 0, 0, 0.95)';
        skyColor = '#05070D';
      }

      ambientColor = this.palette.ambientNightColor;
    }

    const duration = this.config.transitionDurationMs ?? 1000;

    const lightSpec: MapLibreLightSpecification = {
      anchor: 'map',
      color: lightColor,
      intensity: Number(intensity.toFixed(3)),
      position: [1.5, Number(azimuthDeg.toFixed(1)), Number(polarDeg.toFixed(1))],
      'color-transition': { duration },
      'intensity-transition': { duration },
      'position-transition': { duration },
    };

    return {
      lightSpec,
      ambientColor,
      diffuseColor,
      shadowColor,
      skyColor,
    };
  }

  private update3dHillshadeAndBuildingLayers(
    map: MapLibreMapInstance,
    state: DynamicLightingState
  ): void {
    const azimuth = state.lightSpecification.position?.[1] ?? 180;
    const shadowColor = state.shadowColor;

    // 1. Update 3D Hillshade layer if present
    const hillshadeLayerId = 'tracker-terrain-hillshade';
    if (map.getLayer(hillshadeLayerId)) {
      try {
        map.setPaintProperty(hillshadeLayerId, 'hillshade-illumination-direction', azimuth);
        map.setPaintProperty(hillshadeLayerId, 'hillshade-shadow-color', shadowColor);
        map.setPaintProperty(
          hillshadeLayerId,
          'hillshade-highlight-color',
          state.lightSpecification.color ?? '#FFFFFF'
        );
      } catch {
        // Layer properties not supported or mock
      }
    }

    // 2. Update 3D Building extrusion lighting if present
    const building3dLayerId = 'tracker-3d-buildings';
    if (map.getLayer(building3dLayerId)) {
      try {
        map.setPaintProperty(
          building3dLayerId,
          'fill-extrusion-color',
          state.dominantBody === 'SUN' ? '#D0D7DE' : '#1A233A'
        );
      } catch {
        // Ignore
      }
    }
  }
}
