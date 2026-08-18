import type { RouteData, UserSession } from '../types.js';
import type { MapLibreRouteManager } from '../maplibre/routeManager.js';
import type { AuthLockBooth } from '../auth/authBooth.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface RouteSessionDrainHookOptions {
  readonly routeManager: MapLibreRouteManager;
  readonly onRouteDrained?: ((reason: string, previousSession: unknown) => void) | undefined;
}

export class RouteSessionDrainHook implements SessionDrainHook {
  private readonly routeManager: MapLibreRouteManager;
  private readonly onRouteDrained: ((reason: string, previousSession: unknown) => void) | undefined;

  constructor(options: RouteSessionDrainHookOptions) {
    this.routeManager = options.routeManager;
    this.onRouteDrained = options.onRouteDrained;
  }

  public drain(reason: string, previousSession: unknown): void {
    // Execute clearRoute on MapLibre manager
    this.routeManager.clearRoute();
    this.onRouteDrained?.(reason, previousSession);
  }
}

export class SecureTrackingSessionCoordinator {
  private readonly authBooth: AuthLockBooth;
  private readonly routeManager: MapLibreRouteManager;
  private unregisterDrainHook: (() => void) | undefined;

  constructor(authBooth: AuthLockBooth, routeManager: MapLibreRouteManager) {
    this.authBooth = authBooth;
    this.routeManager = routeManager;
    this.setupIntegration();
  }

  private setupIntegration(): void {
    // Register MapLibre clearRoute as a primary SessionDrainHook on the Auth Booth
    const drainHook = new RouteSessionDrainHook({
      routeManager: this.routeManager,
    });

    this.unregisterDrainHook = this.authBooth.registerDrainHook(drainHook);
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
   * Manually clear route if required
   */
  public clearRoute(): void {
    this.routeManager.clearRoute();
  }

  /**
   * Get active session
   */
  public getSession(): UserSession | null {
    return this.authBooth.getSession();
  }

  /**
   * Cleanup and destroy coordinator
   */
  public destroy(): void {
    if (this.unregisterDrainHook) {
      this.unregisterDrainHook();
      this.unregisterDrainHook = undefined;
    }
  }
}
