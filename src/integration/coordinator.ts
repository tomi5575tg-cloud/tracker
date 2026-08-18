import type { RouteData, UserSession } from '../types.js';
import type { MapLibreRouteManager, ClearRouteOptions } from '../maplibre/routeManager.js';
import type { MapLibrePoiLayerManager } from '../maplibre/poiLayerManager.js';
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
}

export class SecureTrackingSessionCoordinator {
  private readonly authBooth: AuthLockBooth;
  private readonly routeManager: MapLibreRouteManager;
  private readonly poiLayerManager: MapLibrePoiLayerManager | undefined;
  private readonly poiManager: PoiManager | undefined;
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
  }

  /**
   * Securely sets a route for the authenticated user.
   * If user is not authorized or session does not match route.userId, rejects with error
   * to strictly enforce Single Booth isolation.
   */
  public displayRoute(route: RouteData): void {
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
