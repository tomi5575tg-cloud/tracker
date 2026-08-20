import type { MapLibreMapInstance } from '../maplibre/types.js';
import { DynamicLightingManager } from './dynamicLightingManager.js';
import type { DynamicLightingState, CelestialBodyType } from './types.js';
import { applyNeonGlowLayers, type MapGlowLayersConfig } from '../maplibre/glowLayers.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export type TacticalSolarTheme = 'DAYLIGHT' | 'GOLDEN_HOUR' | 'DUSK' | 'NIGHT_OBSIDIAN' | 'CYBERPUNK_MIDNIGHT';

export interface TacticalStyleDefinition {
  readonly id: TacticalSolarTheme;
  readonly name: string;
  readonly styleUrlOrJson: string | Record<string, unknown>;
  readonly dominantBody: CelestialBodyType;
  readonly minSunAltitudeDeg: number;
  readonly maxSunAltitudeDeg: number;
}

export interface SolarStyleEngineConfig {
  readonly lightingManager?: DynamicLightingManager | undefined;
  readonly glowConfig?: MapGlowLayersConfig | undefined;
  readonly autoSwitchStyles?: boolean | undefined;
  readonly hysteresisDeg?: number | undefined; // prevent rapid flickering at phase boundaries
  readonly customStyles?: readonly TacticalStyleDefinition[] | undefined;
  readonly onStyleChange?: ((theme: TacticalSolarTheme, state: DynamicLightingState) => void) | undefined;
  readonly onReinjectionComplete?: ((theme: TacticalSolarTheme, reinjectedLayers: string[]) => void) | undefined;
}

export const DEFAULT_TACTICAL_SOLAR_STYLES: readonly TacticalStyleDefinition[] = Object.freeze([
  {
    id: 'DAYLIGHT',
    name: 'Tactical Daylight High-Contrast',
    styleUrlOrJson: 'https://tiles.tracker.internal/styles/tactical-daylight.json',
    dominantBody: 'SUN',
    minSunAltitudeDeg: 12,
    maxSunAltitudeDeg: 90,
  },
  {
    id: 'GOLDEN_HOUR',
    name: 'Tactical Golden Hour Amber',
    styleUrlOrJson: 'https://tiles.tracker.internal/styles/tactical-golden-hour.json',
    dominantBody: 'SUN',
    minSunAltitudeDeg: 0,
    maxSunAltitudeDeg: 12,
  },
  {
    id: 'DUSK',
    name: 'Tactical Civil Twilight Indigo',
    styleUrlOrJson: 'https://tiles.tracker.internal/styles/tactical-dusk.json',
    dominantBody: 'SUN',
    minSunAltitudeDeg: -6,
    maxSunAltitudeDeg: 0,
  },
  {
    id: 'NIGHT_OBSIDIAN',
    name: 'Tactical Obsidian Full Moon',
    styleUrlOrJson: 'https://tiles.tracker.internal/styles/tactical-night-obsidian.json',
    dominantBody: 'MOON',
    minSunAltitudeDeg: -90,
    maxSunAltitudeDeg: -6,
  },
]);

/**
 * AutonomousSolarStyleManager (Tactical Solar Style Engine):
 * High-performance, autonomous solar style switcher and bulletproof layer re-injection pipeline for MapLibre GL JS.
 *
 * Core Features:
 * 1. Autonomous Solar Evaluation: Continuously monitors sun/moon ephemeris & altitude to select the optimal tactical theme.
 * 2. Hysteresis Protection: Avoids flickering style swaps when the sun hovers exactly on the horizon or civil dusk boundary.
 * 3. Bulletproof Re-injection Pipeline: Subscribes to MapLibre `style.load` and seamlessly re-injects:
 *    - Golden Thread Outer Glow, Mid Radiant, and Core White-Gold Line.
 *    - POI Radar Waves, Mid Halo Rings, Core Pins, and Glowing Symbols.
 * 4. Style Diffing & Debouncing: Prevents redundant `setStyle()` invocations if the theme has not changed.
 * 5. Panic Drain (`SessionDrainHook`): Disarms style timers, stops subscriptions, and cleans up active layers.
 */
export class AutonomousSolarStyleManager implements SessionDrainHook {
  private readonly map: MapLibreMapInstance;
  private readonly lightingManager: DynamicLightingManager;
  private readonly config: SolarStyleEngineConfig;
  private readonly styles: readonly TacticalStyleDefinition[];
  private readonly glowConfig: MapGlowLayersConfig;

  private currentTheme: TacticalSolarTheme;
  private cleanupGlowLayers?: (() => void) | undefined;
  private reinjectCallbacks = new Set<() => void>();
  private isAutoSwitchEnabled: boolean;
  private isDestroyed = false;

  constructor(map: MapLibreMapInstance, config: SolarStyleEngineConfig = {}) {
    this.map = map;
    this.config = config;
    this.styles = config.customStyles ?? DEFAULT_TACTICAL_SOLAR_STYLES;
    this.glowConfig = config.glowConfig ?? {
      routeSourceId: 'tracker-route-source',
      poiSourceId: 'tracker-poi-source',
    };
    this.isAutoSwitchEnabled = config.autoSwitchStyles ?? true;

    // Temporary theme before lighting manager initialization
    this.currentTheme = 'DAYLIGHT';

    this.lightingManager =
      config.lightingManager ??
      new DynamicLightingManager(this.map, {
        updateIntervalMs: 5000,
        onLightingChange: (state) => {
          if (this.isAutoSwitchEnabled && !this.isDestroyed) {
            this.handleLightingUpdate(state);
          }
        },
      });

    // Evaluate initial theme
    const initialState = this.lightingManager.getState();
    this.currentTheme = this.resolveThemeForState(initialState);

    this.setupStyleLifecycle();
  }

  public getLightingManager(): DynamicLightingManager {
    return this.lightingManager;
  }

  public getCurrentTheme(): TacticalSolarTheme {
    return this.currentTheme;
  }

  public isAutoSwitching(): boolean {
    return this.isAutoSwitchEnabled;
  }

  public setAutoSwitch(enabled: boolean): void {
    this.isAutoSwitchEnabled = enabled;
  }

  /**
   * Registers a custom re-injection callback invoked whenever MapLibre completes a style load
   */
  public onReinject(callback: () => void): () => void {
    this.reinjectCallbacks.add(callback);
    return () => {
      this.reinjectCallbacks.delete(callback);
    };
  }

  /**
   * Evaluates solar ephemeris and triggers a smooth style transition if theme shifted
   */
  public handleLightingUpdate(state: DynamicLightingState): boolean {
    const nextTheme = this.resolveThemeForState(state);
    if (nextTheme !== this.currentTheme) {
      this.applyTheme(nextTheme, state);
      return true;
    }
    return false;
  }

  /**
   * Resolves the appropriate theme definition for a given lighting state with hysteresis
   */
  public resolveThemeForState(state: DynamicLightingState): TacticalSolarTheme {
    const sunAlt = state.sun.position.altitudeDegrees;
    const hysteresis = this.config.hysteresisDeg ?? 0.5;

    // Apply slight hysteresis margin to the current theme boundaries to prevent rapid swapping
    for (const styleDef of this.styles) {
      const min = styleDef.id === this.currentTheme ? styleDef.minSunAltitudeDeg - hysteresis : styleDef.minSunAltitudeDeg;
      const max = styleDef.id === this.currentTheme ? styleDef.maxSunAltitudeDeg + hysteresis : styleDef.maxSunAltitudeDeg;

      if (sunAlt >= min && sunAlt < max) {
        return styleDef.id;
      }
    }

    return state.dominantBody === 'SUN' ? 'DAYLIGHT' : 'NIGHT_OBSIDIAN';
  }

  /**
   * Manually or autonomously switches to a specific tactical theme and triggers MapLibre setStyle
   */
  public applyTheme(theme: TacticalSolarTheme, customState?: DynamicLightingState): void {
    const styleDef = this.styles.find((s) => s.id === theme);
    if (!styleDef) {
      return;
    }

    this.currentTheme = theme;
    const state = customState ?? this.lightingManager.getState();

    // 1. Trigger MapLibre setStyle if available
    if (typeof this.map.setStyle === 'function') {
      try {
        this.map.setStyle(styleDef.styleUrlOrJson, { diff: true });
      } catch {
        // Safe disposal if mock or offline
      }
    }

    // 2. Re-apply 3D lighting specifications to map
    this.lightingManager.applyToMap(this.map, state);

    this.config.onStyleChange?.(theme, state);

    // If style is already loaded (or mock mode without style.load event), re-inject immediately
    if (this.map.isStyleLoaded()) {
      this.reinjectGoldenThreadAndLayers();
    }
  }

  /**
   * Re-injects Golden Thread, POI Radar glow layers, and user registered layers after a style swap
   */
  public reinjectGoldenThreadAndLayers(): string[] {
    // 1. Clean up previous glow layer references
    if (this.cleanupGlowLayers) {
      this.cleanupGlowLayers();
      this.cleanupGlowLayers = undefined;
    }

    // 2. Re-apply Neon Glow Layers (Golden Thread + Radar POI)
    const glowResult = applyNeonGlowLayers(this.map, this.glowConfig);
    this.cleanupGlowLayers = glowResult.removeGlowLayers;

    // 3. Fire custom re-injection callbacks (e.g. GeoJSON sources, telemetry lines, custom markers)
    for (const callback of this.reinjectCallbacks) {
      try {
        callback();
      } catch {
        // Safe execution
      }
    }

    const allReinjected = [...glowResult.goldenThreadLayerIds, ...glowResult.poiRadarLayerIds];
    this.config.onReinjectionComplete?.(this.currentTheme, allReinjected);

    return allReinjected;
  }

  /**
   * SessionDrainHook implementation:
   * Cleans up glow layers, disables auto switching, and drains lighting manager.
   */
  public drain(reason = 'SOLAR_STYLE_DRAIN', previousSession?: unknown): void {
    this.isAutoSwitchEnabled = false;
    if (this.cleanupGlowLayers) {
      this.cleanupGlowLayers();
      this.cleanupGlowLayers = undefined;
    }
    this.lightingManager.drain(reason, previousSession);
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.drain('DESTROY');
    this.reinjectCallbacks.clear();
  }

  private setupStyleLifecycle(): void {
    // Re-inject layers whenever MapLibre completes style load
    this.map.on('style.load', () => {
      if (!this.isDestroyed) {
        this.reinjectGoldenThreadAndLayers();
        this.lightingManager.applyToMap(this.map);
      }
    });

    // Initial injection
    if (this.map.isStyleLoaded()) {
      this.reinjectGoldenThreadAndLayers();
    }
  }
}
