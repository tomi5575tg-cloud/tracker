import type { Position } from '../src/geojson/types.js';
import type { RouteData } from '../src/types.js';
import type { PoiItem, PoiCategory } from '../src/poi/types.js';
import type { MapLibreMapInstance } from '../src/maplibre/types.js';
import { AuthLockBooth } from '../src/auth/authBooth.js';
import { MapLibreRouteManager } from '../src/maplibre/routeManager.js';
import { MapLibrePoiLayerManager } from '../src/maplibre/poiLayerManager.js';
import { PoiManager } from '../src/poi/poiManager.js';
import { DynamicLightingManager } from '../src/lighting/dynamicLightingManager.js';
import { TacticalCameraOpticsEngine, type TacticalHudInsetsConfig } from '../src/maplibre/cameraOptics.js';
import { TacticalQueryRaceGuard } from '../src/auth/queryRaceGuard.js';
import { TacticalTileCacheManager } from '../src/offline/tileCacheManager.js';
import { TacticalServiceWorkerHandler } from '../src/offline/serviceWorkerHandler.js';
import type { DynamicLightingState } from '../src/lighting/types.js';
import {
  TacticalBottomSheetController,
  type TacticalSnapPoint,
  type TacticalSheetTab,
} from './TacticalBottomSheet.js';
import { SecureTrackingSessionCoordinator } from '../src/integration/coordinator.js';
import { applyNeonGlowLayers } from '../lib/mapGlowLayers.js';

export interface TacticalCockpitConfig {
  readonly map: MapLibreMapInstance;
  readonly authBooth?: AuthLockBooth | undefined;
  readonly routeManager?: MapLibreRouteManager | undefined;
  readonly poiLayerManager?: MapLibrePoiLayerManager | undefined;
  readonly poiManager?: PoiManager | undefined;
  readonly dynamicLightingManager?: DynamicLightingManager | undefined;
  readonly tacticalBottomSheet?: TacticalBottomSheetController | undefined;
  readonly cameraOptics?: TacticalCameraOpticsEngine | undefined;
  readonly queryRaceGuard?: TacticalQueryRaceGuard | undefined;
  readonly tileCacheManager?: TacticalTileCacheManager | undefined;
  readonly serviceWorkerHandler?: TacticalServiceWorkerHandler | undefined;
  readonly insetsConfig?: TacticalHudInsetsConfig | undefined;
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
 * Spatial Query Radar, Tactical Camera Optics, Tile Cache & Offline Service Worker into a unified HUD cockpit.
 */
export class TacticalMapCockpitController {
  private readonly map: MapLibreMapInstance;
  private readonly authBooth: AuthLockBooth;
  private readonly routeManager: MapLibreRouteManager;
  private readonly poiLayerManager: MapLibrePoiLayerManager;
  private readonly poiManager: PoiManager;
  private readonly dynamicLightingManager: DynamicLightingManager;
  private readonly tacticalBottomSheet: TacticalBottomSheetController;
  private readonly cameraOptics: TacticalCameraOpticsEngine;
  private readonly queryRaceGuard: TacticalQueryRaceGuard;
  private readonly tileCacheManager: TacticalTileCacheManager;
  private readonly serviceWorkerHandler: TacticalServiceWorkerHandler;
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
    this.queryRaceGuard = config.queryRaceGuard ?? new TacticalQueryRaceGuard();
    this.tileCacheManager = config.tileCacheManager ?? new TacticalTileCacheManager();
    this.serviceWorkerHandler =
      config.serviceWorkerHandler ??
      new TacticalServiceWorkerHandler({
        tileCacheManager: this.tileCacheManager,
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
        onSnapChange: (snap) => {
          this.cameraOptics.setBottomSheetSnap(snap);
        },
        onDrained: (reason) => {
          config.onSessionDrain?.(reason);
        },
      });

    this.cameraOptics =
      config.cameraOptics ??
      new TacticalCameraOpticsEngine(this.map, {
        insetsConfig: config.insetsConfig,
        defaultCamera: { center: [this.currentCenter[0], this.currentCenter[1]], zoom: this.currentZoom },
        initialSnapPoint: this.tacticalBottomSheet.getState().snapPoint,
      });

    // 2. Wire Secure Tracking Coordinator
    this.coordinator = new SecureTrackingSessionCoordinator(this.authBooth, this.routeManager, {
      poiLayerManager: this.poiLayerManager,
      poiManager: this.poiManager,
      tacticalBottomSheet: this.tacticalBottomSheet,
      dynamicLightingManager: this.dynamicLightingManager,
      cameraOptics: this.cameraOptics,
      queryRaceGuard: this.queryRaceGuard,
      tileCacheManager: this.tileCacheManager,
      serviceWorkerHandler: this.serviceWorkerHandler,
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

  public getCameraOptics(): TacticalCameraOpticsEngine {
    return this.cameraOptics;
  }

  public getQueryRaceGuard(): TacticalQueryRaceGuard {
    return this.queryRaceGuard;
  }

  public getTileCacheManager(): TacticalTileCacheManager {
    return this.tileCacheManager;
  }

  public getServiceWorkerHandler(): TacticalServiceWorkerHandler {
    return this.serviceWorkerHandler;
  }

  /**
   * Dispatches item selection across the entire cockpit (Camera Optics HUD framing, GPU layer highlight, bottom sheet)
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
   * Sets active telemetry route and auto-frames camera
   */
  public displayRoute(route: RouteData, autoFrame = true): void {
    this.coordinator.displayRoute(route, autoFrame);
    this.tacticalBottomSheet.setRoute(route);
  }

  /**
   * Sets active POIs
   */
  public displayPois(pois: readonly PoiItem[]): void {
    this.coordinator.displayPois(pois);
  }

  /**
   * Performs Radar Spatial Scan within radius around map center protected against race conditions
   */
  public async performRadarScanSafe(radiusMeters = 15000): Promise<{
    committed: boolean;
    totalMatches: number;
    items: readonly PoiItem[];
  }> {
    const res = await this.queryRaceGuard.executeSafe(
      'radar_scan',
      async () => {
        const searchResult = this.poiManager.searchRadius(this.currentCenter, radiusMeters, {
          sortByDistance: true,
        });
        return searchResult;
      },
      (searchResult) => {
        this.displayPois(searchResult.items);
        if (searchResult.items.length > 0) {
          this.tacticalBottomSheet.setSnapPoint('HALF');
          // Auto-frame all found items with camera optics
          if (searchResult.items.length === 1) {
            this.cameraOptics.framePoi(searchResult.items[0]!);
          } else if (searchResult.items.length > 1) {
            const coords = searchResult.items.map((i) => i.coordinate);
            this.cameraOptics.frameCoordinates(coords);
          }
        }
      }
    );

    return {
      committed: res.committed,
      totalMatches: res.result?.totalMatches ?? 0,
      items: res.result?.items ?? [],
    };
  }

  /**
   * Performs synchronous Radar Spatial Scan within radius around map center
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
      if (searchResult.items.length === 1) {
        this.cameraOptics.framePoi(searchResult.items[0]!);
      } else if (searchResult.items.length > 1) {
        const coords = searchResult.items.map((i) => i.coordinate);
        this.cameraOptics.frameCoordinates(coords);
      }
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
   * Triggers panic session drain (clears map, POIs, route, HUD, queries, tile cache, and locks booth)
   */
  public async triggerPanicDrain(reason = 'COCKPIT_PANIC_DRAIN'): Promise<void> {
    await this.authBooth.exitBooth(reason);
    this.config.onSessionDrain?.(reason);
  }

  /**
   * Generates view-model for the HUD Cockpit
   */
  public getViewModel(): TacticalCockpitViewModel {
    const session = this.authBooth.getSession();
    const lighting = this.dynamicLightingManager.getState();
    const sheetState = this.tacticalBottomSheet.getState();

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
      liveGpsConnected: true,
      clockTimeFormatted: new Date(lighting.timestamp).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
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

    return `
<div class="${c.root}">
  <!-- Map Canvas Layer -->
  <div id="maplibre-cockpit-canvas" class="${c.mapContainer}"></div>

  <!-- HUD Top Bar -->
  <header class="${c.topBarContainer}">
    <div class="${c.topBarBrand}">
      <div class="${c.topBarLogo}">TRK</div>
      <div>
        <div class="${c.topBarTitle}">Tracker HUD Cockpit</div>
        <div class="text-[10px] font-mono text-cyan-400/80">
          TENANT: <span class="text-slate-200">${vm.topBar.tenantId}</span> | FAZA: <span class="text-cyan-300">${vm.topBar.celestialPhaseName}</span>
        </div>
      </div>
    </div>

    <div class="${c.topBarRightGroup}">
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
    this.cameraOptics.destroy();
    this.queryRaceGuard.destroy();
    this.tileCacheManager.destroy();
    this.serviceWorkerHandler.destroy();
  }
}

export interface TacticalMapCockpitProps extends TacticalCockpitConfig {
  readonly controller?: TacticalMapCockpitController;
  readonly onActionClick?: (action: string) => void;
}

/**
 * TacticalMapCockpit React / JSX Functional Component
 * Provides complete binding of MapLibre GL JS, Single-Booth Session, Golden Thread Glow,
 * POI Radar, Dynamic Moon/Sun Lighting, Camera Optics, Tile Cache & Offline Service Worker, and Tactical Bottom Sheet HUD.
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
