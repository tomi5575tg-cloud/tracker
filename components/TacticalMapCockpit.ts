import type { Position } from '../src/geojson/types.js';
import type { RouteData } from '../src/types.js';
import type { PoiItem, PoiCategory } from '../src/poi/types.js';
import type { MapLibreMapInstance } from '../src/maplibre/types.js';
import { AuthLockBooth } from '../src/auth/authBooth.js';
import { MapLibreRouteManager } from '../src/maplibre/routeManager.js';
import { MapLibrePoiLayerManager } from '../src/maplibre/poiLayerManager.js';
import { PoiManager } from '../src/poi/poiManager.js';
import { DynamicLightingManager } from '../src/lighting/dynamicLightingManager.js';
import type { DynamicLightingState } from '../src/lighting/types.js';
import {
  TacticalBottomSheetController,
  type TacticalSnapPoint,
  type TacticalSheetTab,
} from './TacticalBottomSheet.js';
import { SecureTrackingSessionCoordinator } from '../src/integration/coordinator.js';
import { applyNeonGlowLayers } from '../lib/mapGlowLayers.js';
import { FaultTolerantMeshSupervisor } from '../src/mesh/meshSupervisor.js';
import {
  DegradationLevel,
  ScreenRenderMode,
  PositioningSource,
} from '../src/mesh/types.js';

export interface TacticalCockpitConfig {
  readonly map: MapLibreMapInstance;
  readonly authBooth?: AuthLockBooth | undefined;
  readonly routeManager?: MapLibreRouteManager | undefined;
  readonly poiLayerManager?: MapLibrePoiLayerManager | undefined;
  readonly poiManager?: PoiManager | undefined;
  readonly dynamicLightingManager?: DynamicLightingManager | undefined;
  readonly tacticalBottomSheet?: TacticalBottomSheetController | undefined;
  readonly meshSupervisor?: FaultTolerantMeshSupervisor | undefined;
  readonly initialCenter?: Position | undefined;
  readonly initialZoom?: number | undefined;
  readonly enableNeonGlow?: boolean | undefined;
  readonly onItemSelect?: ((poi: PoiItem | null) => void) | undefined;
  readonly onSessionDrain?: ((reason: string) => void) | undefined;
}

export interface CockpitTopBarViewModel {
  readonly sessionUsername: string;
  readonly sessionRole: string;
  readonly isSessionActive: boolean;
  readonly tenantId: string;
  readonly celestialBody: 'SUN' | 'MOON';
  readonly celestialPhaseName: string;
  readonly liveGpsConnected: boolean;
  readonly clockTimeFormatted: string;
  readonly degradationLevel: DegradationLevel;
  readonly degradationLevelName: string;
  readonly isMeshHealthy: boolean;
  readonly screenRenderMode: ScreenRenderMode;
  readonly isSurvivalMode: boolean;
}

export interface TacticalCockpitViewModel {
  readonly topBar: CockpitTopBarViewModel;
  readonly activeRoute: RouteData | null;
  readonly selectedPoi: PoiItem | null;
  readonly selectedPoiCategory: PoiCategory | null;
  readonly bottomSheetSnap: TacticalSnapPoint;
  readonly bottomSheetTab: TacticalSheetTab;
  readonly totalPoisCount: number;
}

export const TACTICAL_COCKPIT_TAILWIND_CLASSES = Object.freeze({
  // Główny kontener widoku
  root: 'relative w-full h-full min-h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none',

  // Kontener mapy MapLibre
  mapContainer: 'absolute inset-0 z-0 w-full h-full',

  // Górny Pasek Stanu HUD (Top Bar)
  topBarContainer:
    'absolute top-0 inset-x-0 z-30 flex items-center justify-between px-6 py-3.5 bg-slate-950/85 backdrop-blur-md border-b border-cyan-500/30 shadow-[0_4px_25px_rgba(0,0,0,0.7),0_1px_10px_rgba(0,240,255,0.15)]',
  topBarBrand: 'flex items-center gap-3',
  topBarLogo: 'w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-cyan-400 font-mono font-black text-sm shadow-[0_0_10px_rgba(0,240,255,0.4)]',
  topBarTitle: 'text-sm font-extrabold tracking-widest text-slate-100 uppercase',
  topBarSessionBadge: 'px-2.5 py-1 text-xs font-mono font-semibold rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-500/40 shadow-sm flex items-center gap-1.5',
  topBarRightGroup: 'flex items-center gap-4 text-xs font-mono',

  // Pływający pasek szybkich akcji HUD (Floating Quick Actions)
  floatingActionsContainer:
    'absolute top-20 right-5 z-30 flex flex-col gap-2.5 bg-slate-950/80 backdrop-blur-lg p-2 rounded-2xl border border-cyan-500/25 shadow-[0_10px_30px_rgba(0,0,0,0.8),0_0_15px_rgba(0,240,255,0.2)]',
  actionButton:
    'w-11 h-11 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 flex items-center justify-center text-lg shadow-sm hover:shadow-[0_0_12px_rgba(0,240,255,0.4)] active:scale-95 transition-all',
  actionButtonDanger:
    'w-11 h-11 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-400 hover:text-rose-300 border border-rose-500/40 hover:border-rose-400 flex items-center justify-center text-lg shadow-sm hover:shadow-[0_0_12px_rgba(255,0,85,0.4)] active:scale-95 transition-all',
});

/**
 * TacticalMapCockpitController:
 * High-performance orchestrator wiring MapLibre GL JS, Single-Booth Auth Lock,
 * Golden Thread Route Glow, POI Radar Points, Dynamic Moon/Sun Lighting,
 * Spatial Query Radar and Tactical Bottom Sheet into a unified HUD cockpit.
 */
export class TacticalMapCockpitController {
  private readonly map: MapLibreMapInstance;
  private readonly authBooth: AuthLockBooth;
  private readonly routeManager: MapLibreRouteManager;
  private readonly poiLayerManager: MapLibrePoiLayerManager;
  private readonly poiManager: PoiManager;
  private readonly dynamicLightingManager: DynamicLightingManager;
  private readonly tacticalBottomSheet: TacticalBottomSheetController;
  private readonly meshSupervisor: FaultTolerantMeshSupervisor;
  private readonly coordinator: SecureTrackingSessionCoordinator;
  private readonly config: TacticalCockpitConfig;

  private cleanupNeonGlow?: (() => void) | undefined;
  private currentCenter: Position;
  private currentZoom: number;

  constructor(config: TacticalCockpitConfig) {
    this.map = config.map;
    this.config = config;

    this.currentCenter = config.initialCenter ?? [21.0122, 52.2297]; // Warsaw
    this.currentZoom = config.initialZoom ?? 12;

    // 1. Initialize core sub-managers if not provided
    this.authBooth = config.authBooth ?? new AuthLockBooth();
    this.routeManager = config.routeManager ?? new MapLibreRouteManager(this.map);
    this.poiManager = config.poiManager ?? new PoiManager({ authBooth: this.authBooth });
    this.poiLayerManager = config.poiLayerManager ?? new MapLibrePoiLayerManager(this.map);
    this.meshSupervisor =
      config.meshSupervisor ??
      new FaultTolerantMeshSupervisor({
        initialCenter: this.currentCenter,
        safeHavenPosition: this.currentCenter,
      });

    this.dynamicLightingManager =
      config.dynamicLightingManager ??
      new DynamicLightingManager(this.map, {
        observerCoordinate: this.currentCenter,
        updateIntervalMs: 5000,
      });

    this.tacticalBottomSheet =
      config.tacticalBottomSheet ??
      new TacticalBottomSheetController({
        initialSnapPoint: 'PEEK',
        initialTab: 'RADAR_POI',
        onDrained: (reason) => {
          config.onSessionDrain?.(reason);
        },
      });

    // 2. Wire Secure Tracking Coordinator
    this.coordinator = new SecureTrackingSessionCoordinator(this.authBooth, this.routeManager, {
      poiLayerManager: this.poiLayerManager,
      poiManager: this.poiManager,
      tacticalBottomSheet: this.tacticalBottomSheet,
      dynamicLightingManager: this.dynamicLightingManager,
      meshSupervisor: this.meshSupervisor,
    });

    // 3. Apply Neon Glow Layers (Złota Nitka + Punkty Radaru POI) if enabled
    const enableGlow = config.enableNeonGlow ?? true;
    if (enableGlow) {
      const glowResult = applyNeonGlowLayers(this.map, {
        routeSourceId: this.routeManager.getConfig().routeSourceId,
        poiSourceId: 'tracker-poi-source',
      });
      this.cleanupNeonGlow = glowResult.removeGlowLayers;
    }
  }

  public getCoordinator(): SecureTrackingSessionCoordinator {
    return this.coordinator;
  }

  public getMeshSupervisor(): FaultTolerantMeshSupervisor {
    return this.meshSupervisor;
  }

  public getCenter(): Position {
    return this.currentCenter;
  }

  public getZoom(): number {
    return this.currentZoom;
  }

  public getAuthBooth(): AuthLockBooth {
    return this.authBooth;
  }

  public getPoiManager(): PoiManager {
    return this.poiManager;
  }

  public getRouteManager(): MapLibreRouteManager {
    return this.routeManager;
  }

  public getPoiLayerManager(): MapLibrePoiLayerManager {
    return this.poiLayerManager;
  }

  public getDynamicLightingManager(): DynamicLightingManager {
    return this.dynamicLightingManager;
  }

  public getTacticalBottomSheet(): TacticalBottomSheetController {
    return this.tacticalBottomSheet;
  }

  /**
   * Dispatches item selection across the entire cockpit (Map camera, GPU layer highlight, bottom sheet)
   */
  public selectPoi(poi: PoiItem | string | null, centerCamera = true): void {
    let resolvedPoi: PoiItem | null = null;
    if (poi !== null && typeof poi === 'object') {
      resolvedPoi = poi;
    } else if (typeof poi === 'string') {
      resolvedPoi = this.poiManager.getPoi(poi, this.authBooth.getSession() ?? undefined);
    }

    this.coordinator.selectPoi(resolvedPoi, { centerCamera, zoom: 15 });
    this.config.onItemSelect?.(resolvedPoi);
  }

  public onItemSelect(poi: PoiItem | string | null): void {
    this.selectPoi(poi, true);
  }

  /**
   * Sets active telemetry route
   */
  public displayRoute(route: RouteData): void {
    this.coordinator.displayRoute(route);
    this.tacticalBottomSheet.setRoute(route);
    this.meshSupervisor.setRoute(route);
  }

  /**
   * Sets active POIs
   */
  public displayPois(pois: readonly PoiItem[]): void {
    this.coordinator.displayPois(pois);
  }

  /**
   * Performs Radar Spatial Scan within radius around map center
   */
  public performRadarScan(radiusMeters = 15000): {
    totalMatches: number;
    items: readonly PoiItem[];
  } {
    const searchResult = this.poiManager.searchRadius(this.currentCenter, radiusMeters, {
      sortByDistance: true,
    });

    this.displayPois(searchResult.items);

    if (searchResult.items.length > 0) {
      this.tacticalBottomSheet.setSnapPoint('HALF');
    }

    return {
      totalMatches: searchResult.totalMatches,
      items: searchResult.items,
    };
  }

  /**
   * Toggles day/night time simulation by advancing lighting hours
   */
  public toggleDayNight(hours = 12): DynamicLightingState {
    const nextState = this.dynamicLightingManager.advanceHours(hours);
    return nextState;
  }

  /**
   * Triggers panic session drain (clears map, POIs, route, HUD and locks booth)
   */
  public async triggerPanicDrain(reason = 'COCKPIT_PANIC_DRAIN'): Promise<void> {
    this.meshSupervisor.triggerEmergencySafeMode(reason);
    await this.authBooth.exitBooth(reason);
    this.config.onSessionDrain?.(reason);
  }

  /**
   * Triggers manual emergency safe mode (Zero-Black-Screen survival mode)
   */
  public triggerEmergencySafeMode(reason = 'MANUAL_EMERGENCY_OVERRIDE'): void {
    this.meshSupervisor.triggerEmergencySafeMode(reason);
  }

  /**
   * Triggers self-healing recovery across all mesh subsystems
   */
  public triggerSelfHealingRecovery(): void {
    this.meshSupervisor.triggerSelfHealingRecovery();
  }

  /**
   * Generates view-model for the HUD Cockpit
   */
  public getViewModel(): TacticalCockpitViewModel {
    const session = this.authBooth.getSession();
    const lighting = this.dynamicLightingManager.getState();
    const sheetState = this.tacticalBottomSheet.getState();
    const meshSummary = this.meshSupervisor.getHealthSummary();
    const degLevel = meshSummary.overallDegradationLevel;
    const degNames = [
      'OPTIMAL (L0)',
      'DEGRADED ONLINE (L1)',
      'OFFLINE CACHED (L2)',
      'DEGRADED FALLBACK (L3)',
      'CRITICAL SURVIVAL (L4)',
    ];
    const renderMode = this.meshSupervisor.getScreenGuardian().getRenderMode();

    const topBar: CockpitTopBarViewModel = {
      sessionUsername: session?.username ?? 'NIEZALOGOWANY',
      sessionRole: (session?.role ?? 'VIEWER').toUpperCase(),
      isSessionActive: session !== null,
      tenantId: session?.tenantId ?? 'DEFAULT',
      celestialBody: lighting.dominantBody,
      celestialPhaseName:
        lighting.dominantBody === 'SUN'
          ? lighting.sun.phase.replace(/_/g, ' ')
          : lighting.moon.phaseName.replace(/_/g, ' '),
      liveGpsConnected: degLevel <= DegradationLevel.DEGRADED_ONLINE,
      clockTimeFormatted: new Date(lighting.timestamp).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      degradationLevel: degLevel,
      degradationLevelName: degNames[degLevel] ?? 'UNKNOWN',
      isMeshHealthy: meshSummary.isFullyOperational,
      screenRenderMode: renderMode,
      isSurvivalMode: meshSummary.isSurvivalMode,
    };

    return {
      topBar,
      activeRoute: sheetState.activeRoute,
      selectedPoi: sheetState.selectedPoi,
      selectedPoiCategory: sheetState.selectedPoiCategory,
      bottomSheetSnap: sheetState.snapPoint,
      bottomSheetTab: sheetState.activeTab,
      totalPoisCount: this.poiManager.listPois().length,
    };
  }

  /**
   * Generates full Cyberpunk HUD Cockpit HTML Template
   */
  public renderHtml(): string {
    const vm = this.getViewModel();
    const c = TACTICAL_COCKPIT_TAILWIND_CLASSES;
    const bottomSheetHtml = this.tacticalBottomSheet.renderHtml();
    const renderMode = this.meshSupervisor.getScreenGuardian().getRenderMode();

    // If WebGL is not the active render mode, generate fallback canvas / SVG / emergency HUD
    let mapLayerHtml = `<div id="maplibre-cockpit-canvas" class="${c.mapContainer}"></div>`;
    if (renderMode !== ScreenRenderMode.WEBGL_VECTOR) {
      const renderData = {
        currentFix: {
          position: this.currentCenter,
          speedKmh: 45,
          headingDegrees: 90,
          accuracyMeters: 5,
          timestamp: Date.now(),
          source: PositioningSource.GPS_STANDARD,
        },
        activeRoute: vm.activeRoute,
        pois: this.poiManager.listPois(),
        selectedPoi: vm.selectedPoi,
        selectedCategory: vm.selectedPoiCategory,
        viewportCenter: this.currentCenter,
        zoom: this.currentZoom,
        headingDegrees: 90,
        degradationLevel: vm.topBar.degradationLevel,
      };
      mapLayerHtml = this.meshSupervisor.getScreenGuardian().safeRender(renderData);
    }

    const degBadgeColor =
      vm.topBar.degradationLevel === DegradationLevel.OPTIMAL
        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
        : vm.topBar.degradationLevel <= DegradationLevel.OFFLINE_CACHED
        ? 'bg-amber-950/80 text-amber-400 border-amber-500/40'
        : 'bg-rose-950/80 text-rose-400 border-rose-500/40 animate-pulse';

    return `
<div class="${c.root}">
  <!-- Map Canvas Layer -->
  ${mapLayerHtml}

  <!-- HUD Top Bar -->
  <header class="${c.topBarContainer}">
    <div class="${c.topBarBrand}">
      <div class="${c.topBarLogo}">TRK</div>
      <div>
        <div class="${c.topBarTitle}">Tracker HUD Cockpit</div>
        <div class="text-[10px] font-mono text-cyan-400/80">
          TENANT: <span class="text-slate-200">${vm.topBar.tenantId}</span> | MESH: <span class="${vm.topBar.isMeshHealthy ? 'text-emerald-300' : 'text-amber-300'}">${vm.topBar.degradationLevelName}</span>
        </div>
      </div>
    </div>

    <div class="${c.topBarRightGroup}">
      <div class="px-2.5 py-1 text-xs font-mono font-semibold rounded-full border ${degBadgeColor} flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full ${vm.topBar.isMeshHealthy ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
        <span>${vm.topBar.screenRenderMode}</span>
      </div>
      <div class="${c.topBarSessionBadge}">
        <span class="w-2 h-2 rounded-full ${vm.topBar.isSessionActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}"></span>
        <span>${vm.topBar.sessionUsername} (${vm.topBar.sessionRole})</span>
      </div>
      <div class="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-900/80 rounded-full border border-cyan-500/20 text-slate-300">
        <span>${vm.topBar.celestialBody === 'SUN' ? '☀️' : '🌙'}</span>
        <span>${vm.topBar.clockTimeFormatted}</span>
      </div>
    </div>
  </header>

  <!-- Floating Quick Actions Toolbar -->
  <aside class="${c.floatingActionsContainer}">
    <button class="${c.actionButton}" data-action="radar-scan" title="Skanuj Radar (15km)">
      📡
    </button>
    <button class="${c.actionButton}" data-action="toggle-light" title="Przełącz Słońce / Księżyc">
      ${vm.topBar.celestialBody === 'SUN' ? '🌙' : '☀️'}
    </button>
    <button class="${c.actionButton}" data-action="toggle-sheet" title="Panel Taktyczny">
      📊
    </button>
    <button class="${c.actionButtonDanger}" data-action="panic-drain" title="Pancerny Drenaż (Panic)">
      🛑
    </button>
  </aside>

  <!-- Tactical Bottom Sheet HUD -->
  ${bottomSheetHtml}
</div>
`.trim();
  }

  /**
   * Complete clean destruction of map layers, coordinator, and sub-controllers
   */
  public destroy(): void {
    if (this.cleanupNeonGlow) {
      this.cleanupNeonGlow();
      this.cleanupNeonGlow = undefined;
    }

    this.coordinator.destroy();
    this.dynamicLightingManager.destroy();
    this.tacticalBottomSheet.destroy();
  }
}

export interface TacticalMapCockpitProps extends TacticalCockpitConfig {
  readonly controller?: TacticalMapCockpitController;
  readonly onActionClick?: (action: string) => void;
}

/**
 * TacticalMapCockpit React / JSX Functional Component
 * Provides complete binding of MapLibre GL JS, Single-Booth Session, Golden Thread Glow,
 * POI Radar, Dynamic Moon/Sun Lighting, and Tactical Bottom Sheet HUD.
 */
export function TacticalMapCockpit(props: TacticalMapCockpitProps): {
  readonly controller: TacticalMapCockpitController;
  readonly renderHtml: () => string;
  readonly getViewModel: () => TacticalCockpitViewModel;
  readonly classes: typeof TACTICAL_COCKPIT_TAILWIND_CLASSES;
} {
  const controller = props.controller ?? new TacticalMapCockpitController(props);

  return {
    controller,
    renderHtml: () => controller.renderHtml(),
    getViewModel: () => controller.getViewModel(),
    classes: TACTICAL_COCKPIT_TAILWIND_CLASSES,
  };
}
