import type { PoiItem, PoiCategory } from '../src/poi/types.js';
import type { RouteData } from '../src/types.js';
import type { SessionDrainHook } from '../src/auth/drainManager.js';

/**
 * Snap points for Tactical Bottom Sheet
 */
export type TacticalSnapPoint = 'HIDDEN' | 'PEEK' | 'HALF' | 'EXPANDED';

export interface SnapHeightConfig {
  readonly peekHeightPx: number;
  readonly halfRatio: number; // e.g. 0.45 (45% viewport height)
  readonly expandedRatio: number; // e.g. 0.88 (88% viewport height)
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
  readonly onItemSelect?: ((poi: PoiItem | null) => void) | undefined;
  readonly onDrained?: ((reason: string) => void) | undefined;
}

/**
 * Tailwind CSS Utility Class Mapping for HUD Cyberpunk Theme
 */
export const TACTICAL_HUD_TAILWIND_CLASSES = Object.freeze({
  // Główny kontener Bottom Sheet
  container:
    'fixed inset-x-0 bottom-0 z-50 flex flex-col bg-slate-950/95 text-slate-100 backdrop-blur-xl border-t border-cyan-500/30 shadow-[0_-10px_35px_rgba(0,0,0,0.8),0_-2px_15px_rgba(0,240,255,0.2)] rounded-t-3xl overflow-hidden select-none transition-all duration-300 ease-out font-sans',

  // Uchwyt przesuwania (Grabber Handle)
  grabberContainer: 'w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none',
  grabberBar: 'w-12 h-1.5 rounded-full bg-slate-600/60 shadow-[0_0_8px_rgba(0,240,255,0.4)]',

  // Górny Pasek Nagłówka HUD
  header: 'px-5 py-2.5 flex items-center justify-between border-b border-cyan-500/15 bg-slate-900/60',
  headerTitle: 'text-base font-bold tracking-wider text-slate-100 flex items-center gap-2',
  headerSubtitle: 'text-xs font-mono text-cyan-400/80',
  headerBadge: 'px-2.5 py-0.5 text-[11px] font-mono font-semibold rounded-full border shadow-sm',

  // Zakładki Taktyczne (HUD Tabs)
  tabBar: 'flex border-b border-cyan-500/20 bg-slate-950/80 px-4 gap-2 pt-1',
  tabItemActive:
    'px-3 py-2 text-xs font-mono font-bold text-cyan-400 border-b-2 border-cyan-400 shadow-[0_2px_8px_rgba(0,240,255,0.3)] flex items-center gap-1.5 transition-colors',
  tabItemInactive:
    'px-3 py-2 text-xs font-mono text-slate-400 hover:text-slate-200 border-b-2 border-transparent transition-colors flex items-center gap-1.5',

  // Ciało i Zawartość Panelu
  contentBody: 'flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin scrollbar-thumb-cyan-500/20',

  // Karty Danych / Telemetrii HUD
  card:
    'p-4 rounded-xl bg-slate-900/80 border border-cyan-500/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] hover:border-cyan-400/40 transition-all',
  cardTitle: 'text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest mb-1.5',
  cardValue: 'text-lg font-mono font-extrabold text-slate-100 flex items-center gap-2',
  cardDetail: 'text-xs text-slate-400 font-mono mt-1',

  // Siatka Wskaźników HUD (Grid)
  metricsGrid: 'grid grid-cols-2 sm:grid-cols-3 gap-3',

  // Przyciski Akcji Taktycznych
  actionButtonPrimary:
    'w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm tracking-wide shadow-[0_0_20px_rgba(0,240,255,0.4)] active:scale-[0.98] transition-all flex items-center justify-center gap-2',
  actionButtonSecondary:
    'w-full py-2.5 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-cyan-300 font-mono text-xs border border-cyan-500/30 hover:border-cyan-400 shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2',
  actionButtonDanger:
    'w-full py-2.5 px-4 rounded-xl bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 font-mono text-xs border border-rose-500/40 hover:border-rose-400 shadow-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2',
});

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
  public selectPoi(poi: PoiItem | null, category: PoiCategory | null = null, forceExpand = false): void {
    let nextSnap: TacticalSnapPoint = this.state.snapPoint;
    if (poi) {
      if (this.state.snapPoint === 'HIDDEN' || this.state.snapPoint === 'PEEK' || forceExpand) {
        nextSnap = 'HALF';
      }
    }
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
    this.options.onItemSelect?.(poi);
  }

  /**
   * Alias for selectPoi providing unified onItemSelect interface
   */
  public onItemSelect(poi: PoiItem | null, category: PoiCategory | null = null, forceExpand = false): void {
    this.selectPoi(poi, category, forceExpand);
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
   * Returns Tailwind CSS class structure for building modern HUD components
   */
  public getTailwindClasses(): typeof TACTICAL_HUD_TAILWIND_CLASSES {
    return TACTICAL_HUD_TAILWIND_CLASSES;
  }

  /**
   * Generates CSS inline styles for HTML/React rendering of the Tactical Bottom Sheet container
   */
  public getContainerStyles(): Record<string, string | number> {
    const { isDragging, currentHeightPx, isVisible } = this.state;

    return {
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      height: `${currentHeightPx}px`,
      display: isVisible ? 'flex' : 'none',
      flexDirection: 'column',
      backgroundColor: 'rgba(11, 15, 25, 0.96)', // Obsidian HUD navy
      backdropFilter: 'blur(16px)',
      borderTopLeftRadius: '24px',
      borderTopRightRadius: '24px',
      borderTop: '1px solid rgba(0, 240, 255, 0.35)', // Neon Cyan accent border
      boxShadow: '0 -10px 35px rgba(0, 0, 0, 0.8), 0 -2px 15px rgba(0, 240, 255, 0.2)', // Neon glow shadow
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
      width: '48px',
      height: '5px',
      borderRadius: '3px',
      backgroundColor: 'rgba(0, 240, 255, 0.5)',
      boxShadow: '0 0 10px rgba(0, 240, 255, 0.4)',
      margin: '12px auto 8px auto',
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
    statusBadgeClass: string;
    activeTab: TacticalSheetTab;
  } {
    const { selectedPoi, selectedPoiCategory, activeRoute, activeTab } = this.state;

    if (selectedPoi) {
      const isAct = selectedPoi.status === 'ACTIVE';
      return {
        title: selectedPoi.name,
        subtitle: selectedPoiCategory?.name ?? selectedPoi.categoryId,
        statusBadgeColor: isAct ? '#00FF9F' : '#FF0055',
        statusText: selectedPoi.status,
        statusBadgeClass: isAct
          ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40 shadow-[0_0_10px_rgba(0,255,159,0.2)]'
          : 'bg-rose-950/80 text-rose-400 border-rose-500/40 shadow-[0_0_10px_rgba(255,0,85,0.2)]',
        activeTab,
      };
    }

    if (activeRoute) {
      return {
        title: `Trasa: ${activeRoute.routeId}`,
        subtitle: `Dystans: ${(activeRoute.distanceMeters / 1000).toFixed(1)} km | Czas: ${Math.round(activeRoute.durationSeconds / 60)} min`,
        statusBadgeColor: '#FFD700',
        statusText: 'AKTYWNA',
        statusBadgeClass:
          'bg-amber-950/80 text-amber-400 border-amber-500/40 shadow-[0_0_10px_rgba(255,215,0,0.25)]',
        activeTab,
      };
    }

    return {
      title: 'Panel Taktyczny Radaru POI',
      subtitle: 'Skanowanie obszaru i telemetria trasy',
      statusBadgeColor: '#00F0FF',
      statusText: 'RADAR LIVE',
      statusBadgeClass:
        'bg-cyan-950/80 text-cyan-400 border-cyan-500/40 shadow-[0_0_10px_rgba(0,240,255,0.25)]',
      activeTab,
    };
  }

  /**
   * Generates full HTML template string representing the HUD Cockpit Bottom Sheet
   * (can be injected into Vanilla JS, React, Capacitor, React Native WebView or PWA)
   */
  public renderHtml(): string {
    const header = this.getHeaderViewModel();
    const c = TACTICAL_HUD_TAILWIND_CLASSES;
    const { activeTab, selectedPoi, activeRoute } = this.state;

    return `
<div class="${c.container}" style="height: ${this.state.currentHeightPx}px;">
  <!-- Grabber Handle -->
  <div class="${c.grabberContainer}">
    <div class="${c.grabberBar}"></div>
  </div>

  <!-- HUD Header -->
  <div class="${c.header}">
    <div>
      <div class="${c.headerTitle}">
        <span class="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
        ${header.title}
      </div>
      <div class="${c.headerSubtitle}">${header.subtitle}</div>
    </div>
    <div class="${c.headerBadge} ${header.statusBadgeClass}">${header.statusText}</div>
  </div>

  <!-- HUD Tabs -->
  <div class="${c.tabBar}">
    <button class="${activeTab === 'RADAR_POI' ? c.tabItemActive : c.tabItemInactive}" data-tab="RADAR_POI">
      📡 Radar POI
    </button>
    <button class="${activeTab === 'TELEMETRY_ROUTE' ? c.tabItemActive : c.tabItemInactive}" data-tab="TELEMETRY_ROUTE">
      ⚡ Trasa
    </button>
    <button class="${activeTab === 'ACTIONS' ? c.tabItemActive : c.tabItemInactive}" data-tab="ACTIONS">
      🛠 Akcje
    </button>
  </div>

  <!-- Content Body -->
  <div class="${c.contentBody}">
    ${
      activeTab === 'RADAR_POI'
        ? selectedPoi
          ? `
          <div class="${c.card}">
            <div class="${c.cardTitle}">Współrzędne GPS</div>
            <div class="${c.cardValue}">
              ${selectedPoi.coordinate[1].toFixed(5)}° N, ${selectedPoi.coordinate[0].toFixed(5)}° E
            </div>
            <div class="${c.cardDetail}">ID: ${selectedPoi.id} | Kategoria: ${selectedPoi.categoryId}</div>
          </div>
          <div class="${c.card}">
            <div class="${c.cardTitle}">Atrybuty Obiektu</div>
            <div class="space-y-1.5 font-mono text-xs">
              ${Object.entries(selectedPoi.attributes)
                .map(
                  ([k, v]) =>
                    `<div class="flex justify-between border-b border-cyan-500/10 py-1"><span class="text-slate-400">${k}:</span><span class="text-cyan-300 font-semibold">${String(v)}</span></div>`
                )
                .join('')}
            </div>
          </div>
          `
          : `
          <div class="${c.card} text-center py-8">
            <div class="text-cyan-400 text-3xl mb-2 animate-bounce">📡</div>
            <div class="${c.cardTitle}">Brak zaznaczonego punktu</div>
            <div class="${c.cardDetail}">Dotknij punkt na mapie lub użyj skanera radarowego</div>
          </div>
          `
        : activeTab === 'TELEMETRY_ROUTE'
          ? `
          <div class="${c.metricsGrid}">
            <div class="${c.card}">
              <div class="${c.cardTitle}">Dystans</div>
              <div class="${c.cardValue}">${activeRoute ? (activeRoute.distanceMeters / 1000).toFixed(1) : '0.0'} km</div>
            </div>
            <div class="${c.card}">
              <div class="${c.cardTitle}">Szacowany Czas</div>
              <div class="${c.cardValue}">${activeRoute ? Math.round(activeRoute.durationSeconds / 60) : '0'} min</div>
            </div>
            <div class="${c.card}">
              <div class="${c.cardTitle}">Punkty Trasy</div>
              <div class="${c.cardValue}">${activeRoute ? activeRoute.waypoints.length : '0'}</div>
            </div>
          </div>
          `
          : `
          <div class="space-y-3">
            <button class="${c.actionButtonPrimary}">
              🚀 Rozpocznij Nawigację
            </button>
            <button class="${c.actionButtonSecondary}">
              📍 Skanuj Promień 15 km
            </button>
            <button class="${c.actionButtonDanger}">
              🛑 Anuluj Zadanie i Zdrenuj
            </button>
          </div>
          `
    }
  </div>
</div>
`.trim();
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

export interface TacticalBottomSheetProps extends TacticalBottomSheetOptions {
  readonly controller?: TacticalBottomSheetController | undefined;
  readonly selectedPoi?: PoiItem | null | undefined;
  readonly selectedPoiCategory?: PoiCategory | null | undefined;
  readonly activeRoute?: RouteData | null | undefined;
  readonly onNavigateClick?: (() => void) | undefined;
  readonly onScanRadiusClick?: (() => void) | undefined;
  readonly onDrainClick?: (() => void) | undefined;
}

/**
 * TacticalBottomSheet Functional Component Factory / JSX Renderer
 */
export function TacticalBottomSheet(props: TacticalBottomSheetProps): {
  readonly controller: TacticalBottomSheetController;
  readonly renderHtml: () => string;
  readonly classes: typeof TACTICAL_HUD_TAILWIND_CLASSES;
} {
  const controller = props.controller ?? new TacticalBottomSheetController(props);

  if (props.selectedPoi !== undefined) {
    controller.selectPoi(props.selectedPoi, props.selectedPoiCategory ?? null);
  }

  if (props.activeRoute !== undefined) {
    controller.setRoute(props.activeRoute);
  }

  return {
    controller,
    renderHtml: () => controller.renderHtml(),
    classes: TACTICAL_HUD_TAILWIND_CLASSES,
  };
}
