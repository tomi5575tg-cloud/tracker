import type { PoiItem, PoiCategory } from '../src/poi/types.js';
import type { RouteData } from '../src/types.js';
import type { SessionDrainHook } from '../src/auth/drainManager.js';

/**
 * Snap points for Tactical Bottom Sheet
 */
export type TacticalSnapPoint = 'HIDDEN' | 'PEEK' | 'HALF' | 'EXPANDED';

export interface SnapHeightConfig {
  readonly peekHeightPx: number;
  readonly halfRatio: number; // e.g. 0.5 (50% viewport height)
  readonly expandedRatio: number; // e.g. 0.9 (90% viewport height)
}

export const DEFAULT_SNAP_CONFIG: SnapHeightConfig = Object.freeze({
  peekHeightPx: 84,
  halfRatio: 0.45,
  expandedRatio: 0.88,
});

export type TacticalSheetTab = 'RADAR_POI' | 'TELEMETRY_ROUTE' | 'ACTIONS';

export interface TacticalSheetState {
  readonly snapPoint: TacticalSnapPoint;
  readonly activeTab: TacticalSheetTab;
  readonly selectedPoi: PoiItem | null;
  readonly selectedPoiCategory: PoiCategory | null;
  readonly activeRoute: RouteData | null;
  readonly isDragging: boolean;
  readonly currentHeightPx: number;
  readonly isVisible: boolean;
}

export interface TacticalBottomSheetOptions {
  readonly initialSnapPoint?: TacticalSnapPoint | undefined;
  readonly initialTab?: TacticalSheetTab | undefined;
  readonly snapConfig?: Partial<SnapHeightConfig> | undefined;
  readonly enableHapticFeedback?: boolean | undefined;
  readonly enableSwipeGestures?: boolean | undefined;
  readonly neonThemeAccent?: string | undefined;
  readonly onSnapChange?: ((snapPoint: TacticalSnapPoint) => void) | undefined;
  readonly onTabChange?: ((tab: TacticalSheetTab) => void) | undefined;
  readonly onPoiSelected?: ((poi: PoiItem | null) => void) | undefined;
  readonly onDrained?: ((reason: string) => void) | undefined;
}

/**
 * TacticalBottomSheetController:
 * High-performance state machine and DOM/React/Mobile abstraction for Cyberpunk/Dark-themed
 * bottom sheet navigation with gesture tracking, POI inspector, telemetry overview, and Session Drain.
 */
export class TacticalBottomSheetController implements SessionDrainHook {
  private readonly options: TacticalBottomSheetOptions;
  private readonly snapConfig: SnapHeightConfig;

  private state: TacticalSheetState;
  private listeners = new Set<(state: TacticalSheetState) => void>();
  private dragStartY = 0;
  private dragStartHeight = 0;

  constructor(options: TacticalBottomSheetOptions = {}) {
    this.options = options;
    this.snapConfig = {
      ...DEFAULT_SNAP_CONFIG,
      ...options.snapConfig,
    };

    const initialSnap = options.initialSnapPoint ?? 'PEEK';
    const initialHeight = this.calculateHeightForSnap(initialSnap, this.getViewportHeight());

    this.state = {
      snapPoint: initialSnap,
      activeTab: options.initialTab ?? 'RADAR_POI',
      selectedPoi: null,
      selectedPoiCategory: null,
      activeRoute: null,
      isDragging: false,
      currentHeightPx: initialHeight,
      isVisible: initialSnap !== 'HIDDEN',
    };
  }

  public getState(): TacticalSheetState {
    return this.state;
  }

  public subscribe(listener: (state: TacticalSheetState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sets snap point with smooth transition calculation
   */
  public setSnapPoint(snapPoint: TacticalSnapPoint): void {
    if (this.state.snapPoint === snapPoint && !this.state.isDragging) {
      return;
    }

    const height = this.calculateHeightForSnap(snapPoint, this.getViewportHeight());
    this.updateState({
      snapPoint,
      currentHeightPx: height,
      isVisible: snapPoint !== 'HIDDEN',
      isDragging: false,
    });

    this.options.onSnapChange?.(snapPoint);
  }

  /**
   * Sets active tactical tab
   */
  public setActiveTab(tab: TacticalSheetTab): void {
    if (this.state.activeTab === tab) {
      return;
    }

    this.updateState({ activeTab: tab });
    this.options.onTabChange?.(tab);
  }

  /**
   * Inspects a selected POI item and category
   */
  public selectPoi(poi: PoiItem | null, category: PoiCategory | null = null): void {
    const nextSnap: TacticalSnapPoint = poi ? (this.state.snapPoint === 'HIDDEN' ? 'HALF' : this.state.snapPoint) : this.state.snapPoint;
    const nextHeight = this.calculateHeightForSnap(nextSnap, this.getViewportHeight());

    this.updateState({
      selectedPoi: poi,
      selectedPoiCategory: category,
      activeTab: poi ? 'RADAR_POI' : this.state.activeTab,
      snapPoint: nextSnap,
      currentHeightPx: nextHeight,
      isVisible: nextSnap !== 'HIDDEN',
    });

    this.options.onPoiSelected?.(poi);
  }

  /**
   * Binds active route telemetry
   */
  public setRoute(route: RouteData | null): void {
    this.updateState({ activeRoute: route });
  }

  /**
   * Gesture / Drag Start Handler
   */
  public handleDragStart(clientY: number): void {
    this.dragStartY = clientY;
    this.dragStartHeight = this.state.currentHeightPx;
    this.updateState({ isDragging: true });
  }

  /**
   * Gesture / Drag Move Handler
   */
  public handleDragMove(clientY: number): void {
    if (!this.state.isDragging) {
      return;
    }

    const deltaY = this.dragStartY - clientY; // drag up increases height
    const rawHeight = this.dragStartHeight + deltaY;
    const vh = this.getViewportHeight();
    const minHeight = 0;
    const maxHeight = vh * this.snapConfig.expandedRatio;

    const clampedHeight = Math.max(minHeight, Math.min(maxHeight, rawHeight));
    this.updateState({ currentHeightPx: clampedHeight });
  }

  /**
   * Gesture / Drag End Handler (Snap Magnetism)
   */
  public handleDragEnd(velocity = 0): void {
    if (!this.state.isDragging) {
      return;
    }

    const vh = this.getViewportHeight();
    const currentHeight = this.state.currentHeightPx;

    const peekH = this.snapConfig.peekHeightPx;
    const halfH = vh * this.snapConfig.halfRatio;
    const expH = vh * this.snapConfig.expandedRatio;

    let targetSnap: TacticalSnapPoint;

    // Velocity-assisted fling
    if (velocity > 0.5) {
      // Swiped down
      if (currentHeight > halfH) targetSnap = 'HALF';
      else if (currentHeight > peekH) targetSnap = 'PEEK';
      else targetSnap = 'HIDDEN';
    } else if (velocity < -0.5) {
      // Swiped up
      if (currentHeight < peekH) targetSnap = 'PEEK';
      else if (currentHeight < halfH) targetSnap = 'HALF';
      else targetSnap = 'EXPANDED';
    } else {
      // Distance-based closest snap point
      const distHidden = Math.abs(currentHeight - 0);
      const distPeek = Math.abs(currentHeight - peekH);
      const distHalf = Math.abs(currentHeight - halfH);
      const distExp = Math.abs(currentHeight - expH);

      const minDist = Math.min(distHidden, distPeek, distHalf, distExp);
      if (minDist === distHidden) targetSnap = 'HIDDEN';
      else if (minDist === distPeek) targetSnap = 'PEEK';
      else if (minDist === distHalf) targetSnap = 'HALF';
      else targetSnap = 'EXPANDED';
    }

    this.setSnapPoint(targetSnap);
  }

  /**
   * Generates CSS styles for HTML/React rendering of the Tactical Bottom Sheet container
   */
  public getContainerStyles(): Record<string, string | number> {
    const { isDragging, currentHeightPx, isVisible } = this.state;

    return {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: `${currentHeightPx}px`,
      display: isVisible ? 'flex' : 'none',
      flexDirection: 'column',
      backgroundColor: '#0B0F19', // Tactical deep navy / obsidian
      borderTopLeftRadius: '20px',
      borderTopRightRadius: '20px',
      borderTop: '1px solid rgba(0, 240, 255, 0.3)', // Neon Cyan accent border
      boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.7), 0 -2px 10px rgba(0, 240, 255, 0.15)', // Neon glow shadow
      zIndex: 1000,
      overflow: 'hidden',
      transition: isDragging ? 'none' : 'height 0.28s cubic-bezier(0.2, 0.9, 0.3, 1)',
      userSelect: 'none',
      touchAction: 'none',
      color: '#FFFFFF',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    };
  }

  /**
   * Generates CSS styles for the Tactical Grabber Handle
   */
  public getHandleStyles(): Record<string, string | number> {
    return {
      width: '40px',
      height: '4px',
      borderRadius: '2px',
      backgroundColor: 'rgba(255, 255, 255, 0.4)',
      margin: '10px auto 6px auto',
      cursor: 'grab',
    };
  }

  /**
   * Generates formatted markup / render-tree data for the Tactical Header & Tab Bar
   */
  public getHeaderViewModel(): {
    title: string;
    subtitle: string;
    statusBadgeColor: string;
    statusText: string;
    activeTab: TacticalSheetTab;
  } {
    const { selectedPoi, selectedPoiCategory, activeRoute, activeTab } = this.state;

    if (selectedPoi) {
      return {
        title: selectedPoi.name,
        subtitle: selectedPoiCategory?.name ?? selectedPoi.categoryId,
        statusBadgeColor: selectedPoi.status === 'ACTIVE' ? '#00FF9F' : '#FF0055',
        statusText: selectedPoi.status,
        activeTab,
      };
    }

    if (activeRoute) {
      return {
        title: `Trasa: ${activeRoute.routeId}`,
        subtitle: `Dystans: ${(activeRoute.distanceMeters / 1000).toFixed(1)} km | Czas: ${Math.round(activeRoute.durationSeconds / 60)} min`,
        statusBadgeColor: '#FFD700',
        statusText: 'AKTYWNA',
        activeTab,
      };
    }

    return {
      title: 'Panel Taktyczny Radaru POI',
      subtitle: 'Skanowanie obszaru i telemetria trasy',
      statusBadgeColor: '#00F0FF',
      statusText: 'RADAR LIVE',
      activeTab,
    };
  }

  /**
   * PANIC/DRAIN: SessionDrainHook implementation
   * Completely clears selected POIs, active routes, resets to HIDDEN, and wipes state.
   */
  public drain(reason: string, _previousSession?: unknown): void {
    this.state = {
      snapPoint: 'HIDDEN',
      activeTab: 'RADAR_POI',
      selectedPoi: null,
      selectedPoiCategory: null,
      activeRoute: null,
      isDragging: false,
      currentHeightPx: 0,
      isVisible: false,
    };

    this.notifyListeners();
    this.options.onDrained?.(reason);
  }

  public destroy(): void {
    this.drain('DESTROY');
    this.listeners.clear();
  }

  private calculateHeightForSnap(snapPoint: TacticalSnapPoint, viewportHeight: number): number {
    switch (snapPoint) {
      case 'HIDDEN':
        return 0;
      case 'PEEK':
        return this.snapConfig.peekHeightPx;
      case 'HALF':
        return Math.round(viewportHeight * this.snapConfig.halfRatio);
      case 'EXPANDED':
        return Math.round(viewportHeight * this.snapConfig.expandedRatio);
    }
  }

  private getViewportHeight(): number {
    if (typeof window !== 'undefined' && window.innerHeight) {
      return window.innerHeight;
    }
    return 800; // Standard fallback height
  }

  private updateState(partial: Partial<TacticalSheetState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Safe listener execution
      }
    }
  }
}
