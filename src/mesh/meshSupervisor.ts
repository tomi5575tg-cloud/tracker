import type { Position } from '../geojson/types.js';
import type { RouteData } from '../types.js';
import type { PoiItem } from '../poi/types.js';
import {
  DegradationLevel,
  MeshSubsystem,
  CircuitState,
  ScreenRenderMode,
  PositioningSource,
  MeshMessagePriority,
  type SubsystemHealthReport,
  type MeshHealthSummary,
  type TelemetryFix,
  type NavigationGuidance,
  type MeshEvent,
  type MeshEventType,
  type MeshEventListener,
} from './types.js';
import { FallbackChain } from './fallbackChain.js';
import { TelemetryDeadReckoning } from './deadReckoning.js';
import { ScreenGuardian, type ScreenRenderData } from './screenGuardian.js';
import { DegradedNavigationEngine } from './degradedNavigation.js';
import { OfflineTelemetryMeshBuffer } from './offlineMeshBuffer.js';

export interface MeshSupervisorConfig {
  readonly initialCenter?: Position | undefined;
  readonly safeHavenPosition?: Position | undefined;
  readonly autoCompaction?: boolean | undefined;
  readonly onDegradationChanged?: ((level: DegradationLevel, previousLevel: DegradationLevel) => void) | undefined;
}

export class FaultTolerantMeshSupervisor {
  private readonly deadReckoning: TelemetryDeadReckoning;
  private readonly screenGuardian: ScreenGuardian;
  private readonly navigationEngine: DegradedNavigationEngine;
  private readonly offlineBuffer: OfflineTelemetryMeshBuffer;

  // Fallback chains per subsystem
  private readonly positioningChain: FallbackChain<TelemetryFix | null, TelemetryFix>;
  private readonly renderingChain: FallbackChain<ScreenRenderData, string>;
  private readonly routingChain: FallbackChain<TelemetryFix, NavigationGuidance>;
  private readonly lightingChain: FallbackChain<number, { dominant: 'SUN' | 'MOON'; intensity: number }>;
  private readonly connectivityChain: FallbackChain<{ topic: string; payload: unknown; priority?: MeshMessagePriority | undefined }, boolean>;
  private readonly poiDiscoveryChain: FallbackChain<{ center: Position; radiusMeters: number }, readonly PoiItem[]>;

  private currentDegradationLevel: DegradationLevel = DegradationLevel.OPTIMAL;
  private eventListeners: MeshEventListener[] = [];
  private readonly onDegradationChanged?: ((level: DegradationLevel, previousLevel: DegradationLevel) => void) | undefined;

  constructor(config: MeshSupervisorConfig = {}) {
    const center = config.initialCenter ?? [21.0122, 52.2297];
    const safeHaven = config.safeHavenPosition ?? center;

    this.onDegradationChanged = config.onDegradationChanged;

    // 1. Initialize Sub-Engines
    this.deadReckoning = new TelemetryDeadReckoning({
      onGpsLost: (lastFix) => {
        this.emitEvent('TELEMETRY_FIX_LOST', MeshSubsystem.POSITIONING, { lastFix });
      },
      onGpsRestored: (newFix, duration) => {
        this.emitEvent('SUBSYSTEM_RECOVERY', MeshSubsystem.POSITIONING, { newFix, duration });
      },
    });

    this.screenGuardian = new ScreenGuardian({
      onModeChanged: (mode, prev, reason) => {
        this.emitEvent('SCREEN_MODE_CHANGED', MeshSubsystem.RENDERING, { mode, prev, reason });
      },
      onRecovery: (total) => {
        this.emitEvent('SUBSYSTEM_RECOVERY', MeshSubsystem.RENDERING, { totalRecoveries: total });
      },
    });

    this.navigationEngine = new DegradedNavigationEngine({
      fallbackSafeHaven: {
        name: 'BAZA BEZPIECZEŃSTWA (SAFE HAVEN)',
        position: safeHaven,
      },
    });

    this.offlineBuffer = new OfflineTelemetryMeshBuffer({
      compactionEnabled: config.autoCompaction ?? true,
    });

    // 2. Build Multi-Tier Fallback Chains for each Subsystem
    this.positioningChain = this.buildPositioningChain();
    this.renderingChain = this.buildRenderingChain();
    this.routingChain = this.buildRoutingChain();
    this.lightingChain = this.buildLightingChain();
    this.connectivityChain = this.buildConnectivityChain();
    this.poiDiscoveryChain = this.buildPoiDiscoveryChain();
  }

  // --- Fallback Chain Builders ---

  private buildPositioningChain(): FallbackChain<TelemetryFix | null, TelemetryFix> {
    const chain = new FallbackChain<TelemetryFix | null, TelemetryFix>({
      subsystem: MeshSubsystem.POSITIONING,
      ultimateFallback: () => {
        return {
          position: [21.0122, 52.2297],
          speedKmh: 0,
          headingDegrees: 0,
          accuracyMeters: 1000,
          timestamp: Date.now(),
          source: PositioningSource.LAST_KNOWN,
        };
      },
      onTierFallback: (info) => {
        this.handleSubsystemFallback(info);
      },
    });

    // Tier 0: Live GPS Fix
    chain.registerTier({
      tierName: 'LIVE_GPS_PRIMARY',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: (inputFix) => {
        if (!inputFix) {
          throw new Error('No live GPS fix provided');
        }
        const age = Date.now() - inputFix.timestamp;
        if (age > 2500) {
          throw new Error(`GPS fix is stale (${age}ms old)`);
        }
        this.deadReckoning.updateFix(inputFix);
        return inputFix;
      },
    });

    // Tier 1: Dead Reckoning Extrapolator
    chain.registerTier({
      tierName: 'DEAD_RECKONING_EXTRAPOLATOR',
      degradationLevel: DegradationLevel.DEGRADED_FALLBACK,
      execute: () => {
        const state = this.deadReckoning.getCurrentState();
        if (state.currentFix.source === PositioningSource.LAST_KNOWN && state.extrapolationDurationMs > 60000) {
          throw new Error('Dead reckoning max duration exceeded');
        }
        return state.currentFix;
      },
    });

    // Tier 2: Last Known Stationary Position
    chain.registerTier({
      tierName: 'LAST_KNOWN_STATIONARY',
      degradationLevel: DegradationLevel.CRITICAL_SURVIVAL,
      execute: () => {
        const state = this.deadReckoning.getCurrentState();
        return {
          ...state.currentFix,
          speedKmh: 0,
          source: PositioningSource.LAST_KNOWN,
        };
      },
    });

    return chain;
  }

  private buildRenderingChain(): FallbackChain<ScreenRenderData, string> {
    const chain = new FallbackChain<ScreenRenderData, string>({
      subsystem: MeshSubsystem.RENDERING,
      ultimateFallback: (data) => {
        return this.screenGuardian.renderTextEmergencyHudHtml(data);
      },
      onTierFallback: (info) => {
        this.handleSubsystemFallback(info);
      },
    });

    // Tier 0: WebGL GPU Rendering
    chain.registerTier({
      tierName: 'WEBGL_GPU_MAPLIBRE',
      degradationLevel: DegradationLevel.OPTIMAL,
      isAvailable: () => this.screenGuardian.isWebGlAvailable(),
      execute: (data) => {
        return this.screenGuardian.safeRender(data);
      },
    });

    // Tier 1: 2D Canvas Fallback
    chain.registerTier({
      tierName: 'CANVAS_2D_SCHEMATIC',
      degradationLevel: DegradationLevel.DEGRADED_FALLBACK,
      execute: (data) => {
        return this.screenGuardian.renderCanvas2DHtml(data);
      },
    });

    // Tier 2: SVG Vector Radar
    chain.registerTier({
      tierName: 'SVG_VECTOR_RADAR',
      degradationLevel: DegradationLevel.DEGRADED_FALLBACK,
      execute: (data) => {
        return this.screenGuardian.renderSvgVectorHtml(data);
      },
    });

    // Tier 3: Emergency Text HUD
    chain.registerTier({
      tierName: 'TEXT_EMERGENCY_HUD',
      degradationLevel: DegradationLevel.CRITICAL_SURVIVAL,
      execute: (data) => {
        return this.screenGuardian.renderTextEmergencyHudHtml(data);
      },
    });

    return chain;
  }

  private buildRoutingChain(): FallbackChain<TelemetryFix, NavigationGuidance> {
    const chain = new FallbackChain<TelemetryFix, NavigationGuidance>({
      subsystem: MeshSubsystem.ROUTING,
      ultimateFallback: (fix) => {
        return this.navigationEngine.computeGuidance(fix);
      },
      onTierFallback: (info) => {
        this.handleSubsystemFallback(info);
      },
    });

    // Tier 0: Corridor & Turn-by-Turn Navigation
    chain.registerTier({
      tierName: 'CORRIDOR_NAVIGATION',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: (fix) => {
        const guidance = this.navigationEngine.computeGuidance(fix);
        if (guidance.isOffRoute) {
          throw new Error('Vehicle deviated from route corridor');
        }
        return guidance;
      },
    });

    // Tier 1: Direct Geodetic Bearing / Safe Haven Guidance
    chain.registerTier({
      tierName: 'DIRECT_GEODETIC_BEARING',
      degradationLevel: DegradationLevel.DEGRADED_ONLINE,
      execute: (fix) => {
        return this.navigationEngine.computeGuidance(fix);
      },
    });

    return chain;
  }

  private buildLightingChain(): FallbackChain<number, { dominant: 'SUN' | 'MOON'; intensity: number }> {
    const chain = new FallbackChain<number, { dominant: 'SUN' | 'MOON'; intensity: number }>({
      subsystem: MeshSubsystem.LIGHTING,
      ultimateFallback: () => ({ dominant: 'MOON', intensity: 0.8 }),
      onTierFallback: (info) => this.handleSubsystemFallback(info),
    });

    // Tier 0: Dynamic Ephemeris Calculator
    chain.registerTier({
      tierName: 'EPHEMERIS_DYNAMIC_3D',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: (timestamp) => {
        const date = new Date(timestamp);
        const hours = date.getHours();
        const isDay = hours >= 6 && hours < 20;
        return {
          dominant: isDay ? 'SUN' : 'MOON',
          intensity: isDay ? 1.0 : 0.6,
        };
      },
    });

    // Tier 1: Static Tactical Dark Mode
    chain.registerTier({
      tierName: 'STATIC_TACTICAL_DARK',
      degradationLevel: DegradationLevel.DEGRADED_ONLINE,
      execute: () => ({ dominant: 'MOON', intensity: 0.7 }),
    });

    return chain;
  }

  private buildConnectivityChain(): FallbackChain<{ topic: string; payload: unknown; priority?: MeshMessagePriority | undefined }, boolean> {
    const chain = new FallbackChain<{ topic: string; payload: unknown; priority?: MeshMessagePriority | undefined }, boolean>({
      subsystem: MeshSubsystem.CONNECTIVITY,
      ultimateFallback: (input) => {
        // Enqueue to offline buffer
        this.offlineBuffer.enqueue(input.topic, input.payload, input.priority ?? MeshMessagePriority.TELEMETRY_HIGH);
        return true;
      },
      onTierFallback: (info) => this.handleSubsystemFallback(info),
    });

    // Tier 0: Direct Online Sync
    chain.registerTier({
      tierName: 'DIRECT_WEBSOCKET_ONLINE',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: () => {
        return true;
      },
    });

    // Tier 1: Offline Store-and-Forward Mesh Buffer
    chain.registerTier({
      tierName: 'OFFLINE_STORE_AND_FORWARD',
      degradationLevel: DegradationLevel.OFFLINE_CACHED,
      execute: (input) => {
        this.offlineBuffer.enqueue(input.topic, input.payload, input.priority ?? MeshMessagePriority.TELEMETRY_HIGH);
        return true;
      },
    });

    return chain;
  }

  private buildPoiDiscoveryChain(): FallbackChain<{ center: Position; radiusMeters: number }, readonly PoiItem[]> {
    const chain = new FallbackChain<{ center: Position; radiusMeters: number }, readonly PoiItem[]>({
      subsystem: MeshSubsystem.POI_DISCOVERY,
      ultimateFallback: () => [],
      onTierFallback: (info) => this.handleSubsystemFallback(info),
    });

    // Tier 0: Primary POI Spatial Index
    chain.registerTier({
      tierName: 'SPATIAL_INDEX_PRIMARY',
      degradationLevel: DegradationLevel.OPTIMAL,
      execute: () => {
        return [];
      },
    });

    // Tier 1: Hardcoded Emergency System POIs (Safe Havens)
    chain.registerTier({
      tierName: 'EMERGENCY_SAFE_HAVENS',
      degradationLevel: DegradationLevel.CRITICAL_SURVIVAL,
      execute: () => {
        const emergencyPoi: PoiItem = {
          id: 'poi-safe-haven-emergency',
          name: 'BAZA BEZPIECZEŃSTWA (EMERGENCY HAVEN)',
          categoryId: 'fuel_station',
          coordinate: [21.0122, 52.2297],
          status: 'ACTIVE',
          attributes: { emergency_fuel: true, generator_active: true },
          createdBy: 'SYSTEM',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        };
        return [emergencyPoi];
      },
    });

    return chain;
  }

  // --- Subsystem Operations ---

  public async acquirePosition(rawFix: TelemetryFix | null): Promise<TelemetryFix> {
    const result = await this.positioningChain.execute(rawFix);
    this.evaluateOverallDegradation();
    return result.data;
  }

  public async computeNavigation(fix: TelemetryFix): Promise<NavigationGuidance> {
    const result = await this.routingChain.execute(fix);
    this.evaluateOverallDegradation();
    return result.data;
  }

  public async renderScreen(data: ScreenRenderData): Promise<string> {
    const result = await this.renderingChain.execute(data);
    this.evaluateOverallDegradation();
    return result.data;
  }

  public async bufferTelemetry(topic: string, payload: unknown, priority?: MeshMessagePriority): Promise<boolean> {
    const input = priority !== undefined ? { topic, payload, priority } : { topic, payload };
    const result = await this.connectivityChain.execute(input);
    this.evaluateOverallDegradation();
    return result.data;
  }

  public setRoute(route: RouteData | null): void {
    this.navigationEngine.setRoute(route);
    if (route && route.waypoints.length > 0) {
      this.deadReckoning.setRouteCoordinates(route.waypoints.map((w) => w.coordinate));
    } else {
      this.deadReckoning.setRouteCoordinates([]);
    }
  }

  public setNavigationTarget(target: Position, name = 'CEL'): void {
    this.navigationEngine.setTarget(target, name);
  }

  public triggerEmergencySafeMode(reason = 'MANUAL_EMERGENCY_OVERRIDE'): void {
    this.screenGuardian.setRenderMode(ScreenRenderMode.TEXT_EMERGENCY_HUD, reason);
    this.currentDegradationLevel = DegradationLevel.CRITICAL_SURVIVAL;
    this.emitEvent('EMERGENCY_MODE_ACTIVATED', undefined, { reason });
  }

  public triggerSelfHealingRecovery(): void {
    this.positioningChain.resetAllCircuits();
    this.renderingChain.resetAllCircuits();
    this.routingChain.resetAllCircuits();
    this.lightingChain.resetAllCircuits();
    this.connectivityChain.resetAllCircuits();
    this.poiDiscoveryChain.resetAllCircuits();
    this.screenGuardian.handleWebGlContextRestored();
    this.currentDegradationLevel = DegradationLevel.OPTIMAL;
    this.evaluateOverallDegradation();
  }

  // --- Health Evaluation & Events ---

  public getHealthSummary(): MeshHealthSummary {
    const renderMode = this.screenGuardian.getRenderMode();
    const uiDegradation =
      renderMode === ScreenRenderMode.WEBGL_VECTOR
        ? DegradationLevel.OPTIMAL
        : renderMode === ScreenRenderMode.TEXT_EMERGENCY_HUD
        ? DegradationLevel.CRITICAL_SURVIVAL
        : DegradationLevel.DEGRADED_FALLBACK;

    const subsystems: Record<MeshSubsystem, SubsystemHealthReport> = {
      [MeshSubsystem.POSITIONING]: this.positioningChain.getHealthReport(),
      [MeshSubsystem.RENDERING]: this.renderingChain.getHealthReport(),
      [MeshSubsystem.ROUTING]: this.routingChain.getHealthReport(),
      [MeshSubsystem.LIGHTING]: this.lightingChain.getHealthReport(),
      [MeshSubsystem.CONNECTIVITY]: this.connectivityChain.getHealthReport(),
      [MeshSubsystem.POI_DISCOVERY]: this.poiDiscoveryChain.getHealthReport(),
      [MeshSubsystem.AUTH_SESSION]: {
        subsystem: MeshSubsystem.AUTH_SESSION,
        activeTierIndex: 0,
        totalTiers: 1,
        activeTierName: 'AUTH_LOCK_BOOTH',
        circuitState: CircuitState.CLOSED,
        degradationLevel: DegradationLevel.OPTIMAL,
        isHealthy: true,
        consecutiveFailures: 0,
        lastSuccessTimestamp: Date.now(),
      },
      [MeshSubsystem.UI_CONTROLS]: {
        subsystem: MeshSubsystem.UI_CONTROLS,
        activeTierIndex: 0,
        totalTiers: 1,
        activeTierName: 'TACTICAL_HUD_COCKPIT',
        circuitState: CircuitState.CLOSED,
        degradationLevel: uiDegradation,
        isHealthy: uiDegradation === DegradationLevel.OPTIMAL,
        consecutiveFailures: 0,
        lastSuccessTimestamp: Date.now(),
      },
    };

    let maxDegradation = DegradationLevel.OPTIMAL;
    let degradedCount = 0;

    for (const report of Object.values(subsystems)) {
      if (report.degradationLevel > maxDegradation) {
        maxDegradation = report.degradationLevel;
      }
      if (!report.isHealthy) {
        degradedCount++;
      }
    }

    return {
      overallDegradationLevel: maxDegradation,
      isFullyOperational: maxDegradation === DegradationLevel.OPTIMAL,
      isSurvivalMode: maxDegradation === DegradationLevel.CRITICAL_SURVIVAL,
      degradedSubsystemCount: degradedCount,
      subsystems,
      timestamp: Date.now(),
    };
  }

  private handleSubsystemFallback(info: {
    subsystem: MeshSubsystem;
    failedTier: string;
    nextTier: string;
    error: Error;
    degradationLevel: DegradationLevel;
  }): void {
    this.emitEvent('SUBSYSTEM_FAULT', info.subsystem, {
      failedTier: info.failedTier,
      nextTier: info.nextTier,
      error: info.error.message,
      degradationLevel: info.degradationLevel,
    });
    this.evaluateOverallDegradation();
  }

  private evaluateOverallDegradation(): void {
    const prev = this.currentDegradationLevel;
    const summary = this.getHealthSummary();
    this.currentDegradationLevel = summary.overallDegradationLevel;

    if (this.currentDegradationLevel !== prev) {
      this.emitEvent('DEGRADATION_CHANGED', undefined, {
        previousLevel: prev,
        newLevel: this.currentDegradationLevel,
      });
      this.onDegradationChanged?.(this.currentDegradationLevel, prev);
    }
  }

  public addEventListener(listener: MeshEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(
    type: MeshEventType,
    subsystem: MeshSubsystem | undefined,
    details: Record<string, unknown>
  ): void {
    const event: MeshEvent = {
      type,
      subsystem,
      degradationLevel: this.currentDegradationLevel,
      timestamp: Date.now(),
      details,
    };

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Protect supervisor event loop
      }
    }
  }

  // Getters for Sub-Engines
  public getDeadReckoning(): TelemetryDeadReckoning {
    return this.deadReckoning;
  }

  public getScreenGuardian(): ScreenGuardian {
    return this.screenGuardian;
  }

  public getNavigationEngine(): DegradedNavigationEngine {
    return this.navigationEngine;
  }

  public getOfflineBuffer(): OfflineTelemetryMeshBuffer {
    return this.offlineBuffer;
  }

  public getDegradationLevel(): DegradationLevel {
    return this.currentDegradationLevel;
  }
}
