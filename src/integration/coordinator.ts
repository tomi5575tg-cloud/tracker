import type { RouteData, UserSession } from '../types.js';
import type { MapLibreRouteManager, ClearRouteOptions } from '../maplibre/routeManager.js';
import type { MapLibrePoiLayerManager } from '../maplibre/poiLayerManager.js';
import type { TacticalBottomSheetController } from '../components/TacticalBottomSheet.js';
import type { DynamicLightingManager } from '../lighting/dynamicLightingManager.js';
import type { TacticalCameraOpticsEngine } from '../maplibre/cameraOptics.js';
import type { TacticalQueryRaceGuard } from '../auth/queryRaceGuard.js';
import type { TacticalTileCacheManager } from '../offline/tileCacheManager.js';
import type { TacticalServiceWorkerHandler } from '../offline/serviceWorkerHandler.js';
import type { PoiManager } from '../poi/poiManager.js';
import type { PoiItem, PoiGeoJsonFeatureCollection } from '../poi/types.js';
import type { AuthLockBooth } from '../auth/authBooth.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface RouteSessionDrainHookOptions {
  readonly routeManager: MapLibreRouteManager;
  readonly clearRouteOptions?: ClearRouteOptions | undefined;
  readonly onRouteDrained?: ((reason: string, previousSession: unknown) => void) | undefined;
}

export class RouteSessionDrainHook implements SessionDrainHook {
  private readonly routeManager: MapLibreRouteManager;
  private readonly clearRouteOptions: ClearRouteOptions | undefined;
  private readonly onRouteDrained: ((reason: string, previousSession: unknown) => void) | undefined;

  constructor(options: RouteSessionDrainHookOptions) {
    this.routeManager = options.routeManager;
    this.clearRouteOptions = options.clearRouteOptions;
    this.onRouteDrained = options.onRouteDrained;
  }

  public drain(reason: string, previousSession: unknown): void {
    // Execute clearRoute on MapLibre manager with options
    this.routeManager.clearRoute(this.clearRouteOptions);
    this.onRouteDrained?.(reason, previousSession);
  }
}

export interface SecureTrackingCoordinatorConfig {
  readonly clearRouteOptions?: ClearRouteOptions | undefined;
  readonly poiLayerManager?: MapLibrePoiLayerManager | undefined;
  readonly poiManager?: PoiManager | undefined;
  readonly tacticalBottomSheet?: TacticalBottomSheetController | undefined;
  readonly dynamicLightingManager?: DynamicLightingManager | undefined;
  readonly cameraOptics?: TacticalCameraOpticsEngine | undefined;
  readonly queryRaceGuard?: TacticalQueryRaceGuard | undefined;
  readonly tileCacheManager?: TacticalTileCacheManager | undefined;
  readonly serviceWorkerHandler?: TacticalServiceWorkerHandler | undefined;
}

export class SecureTrackingSessionCoordinator {
  private readonly authBooth: AuthLockBooth;
  private readonly routeManager: MapLibreRouteManager;
  private readonly poiLayerManager: MapLibrePoiLayerManager | undefined;
  private readonly poiManager: PoiManager | undefined;
  private readonly tacticalBottomSheet: TacticalBottomSheetController | undefined;
  private readonly dynamicLightingManager: DynamicLightingManager | undefined;
  private readonly cameraOptics: TacticalCameraOpticsEngine | undefined;
  private readonly queryRaceGuard: TacticalQueryRaceGuard | undefined;
  private readonly tileCacheManager: TacticalTileCacheManager | undefined;
  private readonly serviceWorkerHandler: TacticalServiceWorkerHandler | undefined;
  private readonly config: SecureTrackingCoordinatorConfig;
  private unregisterHooks: Array<() => void> = [];

  constructor(
    authBooth: AuthLockBooth,
    routeManager: MapLibreRouteManager,
    config: SecureTrackingCoordinatorConfig = {}
  ) {
    this.authBooth = authBooth;
    this.routeManager = routeManager;
    this.poiLayerManager = config.poiLayerManager;
    this.poiManager = config.poiManager;
    this.tacticalBottomSheet = config.tacticalBottomSheet;
    this.dynamicLightingManager = config.dynamicLightingManager;
    this.cameraOptics = config.cameraOptics;
    this.queryRaceGuard = config.queryRaceGuard;
    this.tileCacheManager = config.tileCacheManager;
    this.serviceWorkerHandler = config.serviceWorkerHandler;
    this.config = config;
    this.setupIntegration();
  }

  private setupIntegration(): void {
    // 1. Register MapLibre clearRoute as a primary SessionDrainHook on the Auth Booth
    const routeDrainHook = new RouteSessionDrainHook({
      routeManager: this.routeManager,
      clearRouteOptions: this.config.clearRouteOptions,
    });
    this.unregisterHooks.push(this.authBooth.registerDrainHook(routeDrainHook));

    // 2. Register POI Layer Manager drain hook if provided
    if (this.poiLayerManager) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.poiLayerManager));
    }

    // 3. Register POI Manager drain hook if provided
    if (this.poiManager) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.poiManager));
    }

    // 4. Register Tactical Bottom Sheet drain hook if provided
    if (this.tacticalBottomSheet) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.tacticalBottomSheet));
    }

    // 5. Register Dynamic Lighting Manager drain hook if provided
    if (this.dynamicLightingManager) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.dynamicLightingManager));
    }

    // 6. Register Camera Optics Engine drain hook if provided
    if (this.cameraOptics) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.cameraOptics));
    }

    // 7. Register Query Race Guard drain hook if provided
    if (this.queryRaceGuard) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.queryRaceGuard));
    }

    // 8. Register Tile Cache Manager drain hook if provided
    if (this.tileCacheManager) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.tileCacheManager));
    }

    // 9. Register Service Worker Handler drain hook if provided
    if (this.serviceWorkerHandler) {
      this.unregisterHooks.push(this.authBooth.registerDrainHook(this.serviceWorkerHandler));
    }
  }

  /**
   * Securely sets a route for the authenticated user.
   * If user is not authorized or session does not match route.userId, rejects with error
   * to strictly enforce Single Booth isolation.
   */
  public displayRoute(route: RouteData, autoFrame = true): void {
    const session = this.authBooth.getSession();
    if (!session) {
      throw new Error('Unauthorized: No active session in AuthLockBooth to display route');
    }

    if (session.userId !== route.userId) {
      throw new Error(
        `Security violation: Active booth session userId (${session.userId}) does not match route userId (${route.userId})`
      );
    }

    this.routeManager.setRoute(route);

    // Sync active route with Service Worker fallback for offline Golden Thread tiles
    if (this.serviceWorkerHandler) {
      this.serviceWorkerHandler.getGoldenThreadFallback().setActiveRoute(route);
    }

    if (autoFrame && this.cameraOptics) {
      const snap = this.tacticalBottomSheet?.getState().snapPoint;
      this.cameraOptics.frameRoute(route, { bottomSheetSnap: snap });
    }
  }

  /**
   * Securely renders POIs on the map respecting the active user's permissions and role matrix.
   */
  public displayPois(pois: readonly PoiItem[]): void {
    const session = this.authBooth.getSession();
    if (!session) {
      throw new Error('Unauthorized: No active session in AuthLockBooth to display POIs');
    }

    if (!this.poiLayerManager) {
      throw new Error('PoiLayerManager is not configured on this coordinator');
    }

    const categoryMap = this.poiManager?.getCategoryRegistry().getCategoryMap();
    const permissionsEngine = this.poiManager?.getPermissionsEngine();

    this.poiLayerManager.setPoiItems(pois, {
      subject: session,
      categories: categoryMap,
      permissionsEngine,
    });
  }

  /**
   * Sets pre-computed POI GeoJSON collection directly on the map layer
   */
  public displayPoiGeoJson(collection: PoiGeoJsonFeatureCollection): void {
    const session = this.authBooth.getSession();
    if (!session) {
      throw new Error('Unauthorized: No active session in AuthLockBooth to display POIs');
    }

    if (!this.poiLayerManager) {
      throw new Error('PoiLayerManager is not configured on this coordinator');
    }

    this.poiLayerManager.setPoiGeoJson(collection);
  }

  /**
   * Manually clear route if required
   */
  public clearRoute(options?: ClearRouteOptions): void {
    this.routeManager.clearRoute(options ?? this.config.clearRouteOptions);
    this.serviceWorkerHandler?.getGoldenThreadFallback().setActiveRoute(null);
  }

  /**
   * Manually clear POI layers if required
   */
  public clearPois(): void {
    this.poiLayerManager?.clearPoi();
    this.poiManager?.clear();
  }

  /**
   * Get active session
   */
  public getSession(): UserSession | null {
    return this.authBooth.getSession();
  }

  public getPoiManager(): PoiManager | undefined {
    return this.poiManager;
  }

  public getPoiLayerManager(): MapLibrePoiLayerManager | undefined {
    return this.poiLayerManager;
  }

  public getTacticalBottomSheet(): TacticalBottomSheetController | undefined {
    return this.tacticalBottomSheet;
  }

  public getDynamicLightingManager(): DynamicLightingManager | undefined {
    return this.dynamicLightingManager;
  }

  public getCameraOptics(): TacticalCameraOpticsEngine | undefined {
    return this.cameraOptics;
  }

  public getQueryRaceGuard(): TacticalQueryRaceGuard | undefined {
    return this.queryRaceGuard;
  }

  public getTileCacheManager(): TacticalTileCacheManager | undefined {
    return this.tileCacheManager;
  }

  public getServiceWorkerHandler(): TacticalServiceWorkerHandler | undefined {
    return this.serviceWorkerHandler;
  }

  /**
   * Dispatches unified onItemSelect across POI layer manager, tactical bottom sheet, optics camera, and map view.
   * Ensures bidirectional synchronization when a user clicks a marker on the map or picks an item in the UI.
   */
  public selectPoi(
    poi: PoiItem | string | null,
    options: import('../maplibre/types.js').MapLibreItemSelectionOptions = {}
  ): void {
    let resolvedPoi: PoiItem | null = null;
    let resolvedCategory: import('../poi/types.js').PoiCategory | null = null;

    if (poi !== null && typeof poi === 'object') {
      resolvedPoi = poi;
    } else if (typeof poi === 'string') {
      resolvedPoi = this.poiManager?.getPoi(poi, this.getSession() ?? undefined) ?? null;
    }

    if (resolvedPoi && this.poiManager) {
      resolvedCategory = this.poiManager.getCategoryRegistry().getCategory(resolvedPoi.categoryId) ?? null;
    }

    // 1. Update Map POI Layer selection
    if (this.poiLayerManager) {
      this.poiLayerManager.selectPoi(resolvedPoi, {
        ...options,
        centerCamera: false, // delegated to Camera Optics Engine
      });
    }

    // 2. Update Tactical Bottom Sheet Inspector
    if (this.tacticalBottomSheet) {
      this.tacticalBottomSheet.selectPoi(resolvedPoi, resolvedCategory);
    }

    // 3. Auto-frame camera using Camera Optics Engine if enabled
    const centerCamera = options.centerCamera ?? true;
    if (centerCamera && resolvedPoi) {
      const snap = this.tacticalBottomSheet?.getState().snapPoint;
      if (this.cameraOptics) {
        this.cameraOptics.framePoi(resolvedPoi, {
          targetZoom: options.zoom ?? 15,
          bottomSheetSnap: snap,
          durationMs: options.easeDurationMs ?? 800,
        });
      } else if (this.poiLayerManager) {
        // Fallback to basic layer manager camera centering
        this.poiLayerManager.selectPoi(resolvedPoi, { ...options, centerCamera: true });
      }
    }
  }

  /**
   * Alias for selectPoi providing standard onItemSelect signature
   */
  public onItemSelect(
    poi: PoiItem | string | null,
    options: import('../maplibre/types.js').MapLibreItemSelectionOptions = {}
  ): void {
    this.selectPoi(poi, options);
  }

  /**
   * Cleanup and destroy coordinator
   */
  public destroy(): void {
    for (const unregister of this.unregisterHooks) {
      unregister();
    }
    this.unregisterHooks = [];
  }
}
