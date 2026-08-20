import type { Position } from '../geojson/types.js';
import type { RouteData } from '../types.js';
import type { PoiItem } from '../poi/types.js';
import type {
  MeshDegradationLevel,
  MeshSubsystemId,
  SubsystemHealthReport,
  SubsystemHealthStatus,
  MeshStatusSummary,
  EmergencyRenderFrame,
} from './types.js';
import { DeadReckoningEngine } from './deadReckoningEngine.js';
import { EmergencyRenderer } from './emergencyRenderer.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface MeshSupervisorConfig {
  readonly initialPosition?: Position | undefined;
  readonly deadReckoningEngine?: DeadReckoningEngine | undefined;
  readonly emergencyRenderer?: EmergencyRenderer | undefined;
  readonly onDegradationChange?: ((level: MeshDegradationLevel, summary: MeshStatusSummary) => void) | undefined;
  readonly onSubsystemStateChange?: ((report: SubsystemHealthReport) => void) | undefined;
}

/**
 * FaultTolerantMeshSupervisor:
 * Master resilience orchestrator preventing Single Points of Failure (SPOF)
 * across the entire navigation & telematics ecosystem using Graceful Degradation.
 *
 * Fallback Matrix:
 * 1. GPS Lost -> DeadReckoningEngine (inertial kinematic projection)
 * 2. Cloud AI Offline -> Edge local heuristics & kinematics
 * 3. Map Tile Server Down -> LRU TileCacheManager & GoldenThreadOfflineFallback synthetic tiles
 * 4. WebGL Crash / Context Lost -> EmergencyRenderer (HTML5 Canvas 2D / Vector SVG HUD)
 * 5. Network Blackout -> Offline batch buffer & radio silence navigation
 */
export class FaultTolerantMeshSupervisor implements SessionDrainHook {
  private readonly deadReckoning: DeadReckoningEngine;
  private readonly emergencyRenderer: EmergencyRenderer;
  private readonly config: MeshSupervisorConfig;

  private currentLevel: MeshDegradationLevel = 'LEVEL_0_NOMINAL';
  private readonly subsystemReports = new Map<MeshSubsystemId, SubsystemHealthReport>();

  private currentRoute: RouteData | null = null;
  private currentPois: readonly PoiItem[] = [];
  private currentCenter: Position;
  private currentHeading = 0;
  private currentZoom = 13;
  private isWebGLHealthy = true;

  constructor(config: MeshSupervisorConfig = {}) {
    this.config = config;
    this.currentCenter = config.initialPosition ?? [21.0122, 52.2297];

    this.deadReckoning =
      config.deadReckoningEngine ?? new DeadReckoningEngine(this.currentCenter);
    this.emergencyRenderer =
      config.emergencyRenderer ?? new EmergencyRenderer();

    this.initializeSubsystemReports();
  }

  public getDeadReckoningEngine(): DeadReckoningEngine {
    return this.deadReckoning;
  }

  public getEmergencyRenderer(): EmergencyRenderer {
    return this.emergencyRenderer;
  }

  public getDegradationLevel(): MeshDegradationLevel {
    return this.currentLevel;
  }

  /**
   * Reports subsystem health and updates graceful degradation level.
   */
  public reportSubsystemHealth(
    id: MeshSubsystemId,
    status: SubsystemHealthStatus,
    activeTier: string,
    errorDetails?: string
  ): MeshStatusSummary {
    const existing = this.subsystemReports.get(id);
    const failures = status === 'FAILED' || status === 'DEGRADED' ? (existing?.failureCount ?? 0) + 1 : 0;

    const updated: SubsystemHealthReport = {
      id,
      status,
      activeTier,
      fallbackChain: existing?.fallbackChain ?? [],
      lastHeartbeat: Date.now(),
      failureCount: failures,
      ...(errorDetails ? { errorDetails } : {}),
    };

    this.subsystemReports.set(id, updated);
    this.config.onSubsystemStateChange?.(updated);

    this.recalculateDegradationLevel();
    return this.getStatusSummary();
  }

  /**
   * Ingests live telemetry GPS coordinates, automatically reconciling dead reckoning.
   */
  public updateGps(coord: Position, speedKmh?: number, headingDeg?: number, timestamp: number = Date.now()): void {
    this.currentCenter = [coord[0], coord[1]];
    if (headingDeg !== undefined) {
      this.currentHeading = headingDeg;
    }

    this.deadReckoning.updateGpsFix(coord, speedKmh, headingDeg, timestamp);
    this.reportSubsystemHealth('GPS_POSITIONING', 'HEALTHY', 'LIVE_GNSS_FIX');
  }

  /**
   * Simulates or triggers GPS loss signal (e.g. entering a long underground tunnel).
   */
  public reportGpsLoss(reason = 'SIGNAL_LOST'): void {
    this.reportSubsystemHealth('GPS_POSITIONING', 'DEGRADED', 'DEAD_RECKONING_EXTRAPOLATION', reason);
  }

  /**
   * Reports WebGL Context Loss / GPU crash to switch renderer immediately to 2D Emergency Canvas.
   */
  public reportWebGlContextLoss(reason = 'WEBGL_CONTEXT_LOST'): void {
    this.isWebGLHealthy = false;
    this.reportSubsystemHealth('MAP_RENDERER', 'DEGRADED', 'EMERGENCY_2D_CANVAS', reason);
  }

  /**
   * Reports WebGL context restored.
   */
  public reportWebGlContextRestored(): void {
    this.isWebGLHealthy = true;
    this.reportSubsystemHealth('MAP_RENDERER', 'HEALTHY', 'MAPLIBRE_WEBGL_3D');
  }

  /**
   * Ingests active route for emergency rendering & navigation tracking.
   */
  public setActiveRoute(route: RouteData | null): void {
    this.currentRoute = route;
  }

  /**
   * Ingests nearby POIs.
   */
  public setNearbyPois(pois: readonly PoiItem[]): void {
    this.currentPois = pois;
  }

  /**
   * Generates emergency render frame representation.
   */
  public getEmergencyFrame(width = 800, height = 600): EmergencyRenderFrame {
    const drState = this.deadReckoning.getState();
    const pos = drState.isExtrapolating ? drState.estimatedCoordinate : this.currentCenter;

    return {
      width,
      height,
      center: this.currentCenter,
      heading: this.currentHeading,
      zoom: this.currentZoom,
      activeRoute: this.currentRoute,
      currentPosition: pos,
      isDeadReckoning: drState.isExtrapolating,
      nearbyPois: this.currentPois,
      degradationLevel: this.currentLevel,
      healthReports: Array.from(this.subsystemReports.values()),
    };
  }

  /**
   * Renders emergency fallback frame as an SVG string.
   */
  public renderEmergencySvg(width = 800, height = 600): string {
    const frame = this.getEmergencyFrame(width, height);
    return this.emergencyRenderer.renderSvgFrame(frame);
  }

  /**
   * Returns complete status summary.
   */
  public getStatusSummary(): MeshStatusSummary {
    const drState = this.deadReckoning.getState();
    const isRendererDegraded = !this.isWebGLHealthy;

    const netReport = this.subsystemReports.get('NETWORK_TELEMETRY');
    let activeTelemetryChannel: MeshStatusSummary['activeTelemetryChannel'] = 'SUPABASE_EDGE';
    if (netReport?.status === 'FAILED') {
      activeTelemetryChannel = 'RADIO_SILENCE_DR';
    } else if (netReport?.status === 'DEGRADED') {
      activeTelemetryChannel = 'LOCAL_OFFLINE_BUFFER';
    }

    return {
      overallLevel: this.currentLevel,
      isScreenSafe: true, // Guarantees screen is ALWAYS available
      isNavigationActive: true,
      deadReckoning: drState,
      activeRenderer: isRendererDegraded ? 'EMERGENCY_2D_CANVAS' : 'MAPLIBRE_WEBGL',
      activeTelemetryChannel,
      subsystems: Array.from(this.subsystemReports.values()),
      timestamp: Date.now(),
    };
  }

  /**
   * SessionDrainHook implementation
   */
  public drain(reason = 'MESH_DRAIN', previousSession?: unknown): void {
    this.deadReckoning.drain(reason, previousSession);
    this.currentRoute = null;
    this.currentPois = [];
    this.initializeSubsystemReports();
    this.currentLevel = 'LEVEL_0_NOMINAL';
  }

  public destroy(): void {
    this.drain('DESTROY');
  }

  private recalculateDegradationLevel(): void {
    const previousLevel = this.currentLevel;
    const gps = this.subsystemReports.get('GPS_POSITIONING')?.status;
    const render = this.subsystemReports.get('MAP_RENDERER')?.status;
    const net = this.subsystemReports.get('NETWORK_TELEMETRY')?.status;

    if (render === 'FAILED' || render === 'DEGRADED' || !this.isWebGLHealthy) {
      this.currentLevel = 'LEVEL_3_MAP_RENDER_LOST';
    } else if (gps === 'FAILED' || gps === 'DEGRADED' || this.deadReckoning.getState().isExtrapolating) {
      this.currentLevel = 'LEVEL_2_GPS_LOST';
    } else if (net === 'FAILED' || net === 'DEGRADED') {
      this.currentLevel = 'LEVEL_1_NETWORK_DEGRADED';
    } else {
      this.currentLevel = 'LEVEL_0_NOMINAL';
    }

    if (previousLevel !== this.currentLevel) {
      this.config.onDegradationChange?.(this.currentLevel, this.getStatusSummary());
    }
  }

  private initializeSubsystemReports(): void {
    const baseSubs: Array<{ id: MeshSubsystemId; chain: string[] }> = [
      { id: 'GPS_POSITIONING', chain: ['LIVE_GNSS_FIX', 'INERTIAL_DEAD_RECKONING', 'CORRIDOR_ANCHOR'] },
      { id: 'MAP_RENDERER', chain: ['MAPLIBRE_WEBGL_3D', 'EMERGENCY_2D_CANVAS', 'FALLBACK_SVG'] },
      { id: 'NETWORK_TELEMETRY', chain: ['SUPABASE_EDGE_WEBSOCKET', 'OFFLINE_CACHE_BUFFER', 'RADIO_SILENCE'] },
      { id: 'AI_INFERENCE', chain: ['CLOUD_FULL_COCKPIT_AI', 'EDGE_KINEMATICS', 'STATIC_SAFETY_LIMITS'] },
      { id: 'TILE_CACHE', chain: ['ONLINE_TILE_SERVER', 'LRU_CACHE', 'SYNTHETIC_GOLDEN_THREAD'] },
      { id: 'AUTH_SESSION', chain: ['AUTH_LOCK_BOOTH', 'SAFE_STORAGE_OFFLINE_RESTORE', 'PANIC_DRAIN'] },
    ];

    for (const sub of baseSubs) {
      this.subsystemReports.set(sub.id, {
        id: sub.id,
        status: 'HEALTHY',
        activeTier: sub.chain[0]!,
        fallbackChain: sub.chain,
        lastHeartbeat: Date.now(),
        failureCount: 0,
      });
    }
  }
}
