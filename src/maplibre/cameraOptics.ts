import type { Position } from '../geojson/types.js';
import type { RouteData } from '../types.js';
import type { PoiItem } from '../poi/types.js';
import type {
  MapLibreMapInstance,
  CameraOptions,
  FitBoundsOptions,
} from './types.js';
import { GeoSpatialUtils } from '../spatial/geoUtils.js';
import type { TacticalSnapPoint, SnapHeightConfig } from '../../components/TacticalBottomSheet.js';
import { DEFAULT_SNAP_CONFIG } from '../../components/TacticalBottomSheet.js';
import type { SessionDrainHook } from '../auth/drainManager.js';

export interface ViewportInsets {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface TacticalHudInsetsConfig {
  /**
   * Height of Top Status Bar HUD in pixels (default: 64px)
   */
  readonly topBarHeightPx?: number | undefined;
  /**
   * Width of Floating Quick Actions Toolbar HUD on right in pixels (default: 68px)
   */
  readonly floatingToolbarWidthPx?: number | undefined;
  /**
   * Additional safety margin around features (default: 24px)
   */
  readonly safetyPaddingPx?: number | undefined;
}

export type TacticalCameraAnimationMode = 'easeTo' | 'flyTo' | 'jumpTo';

export interface TacticalFramingOptions {
  /**
   * Animation mode for camera move (default: 'easeTo')
   */
  readonly mode?: TacticalCameraAnimationMode | undefined;
  /**
   * Animation duration in milliseconds (default: 800ms)
   */
  readonly durationMs?: number | undefined;
  /**
   * Target zoom level (when focusing on a single coordinate/POI)
   */
  readonly targetZoom?: number | undefined;
  /**
   * Max zoom level constraint when fitting bounds (default: 17)
   */
  readonly maxZoom?: number | undefined;
  /**
   * Min zoom level constraint when fitting bounds (default: 2)
   */
  readonly minZoom?: number | undefined;
  /**
   * Optional pitch tilt in degrees (0-60, default: 0)
   */
  readonly pitch?: number | undefined;
  /**
   * Optional bearing orientation in degrees (0-360)
   */
  readonly bearing?: number | undefined;
  /**
   * Current bottom sheet snap point to calculate bottom obstruction
   */
  readonly bottomSheetSnap?: TacticalSnapPoint | undefined;
  /**
   * Explicit custom bottom sheet height in pixels (overrides snap point calculation)
   */
  readonly bottomSheetHeightPx?: number | undefined;
  /**
   * Additional custom padding
   */
  readonly additionalInsets?: Partial<ViewportInsets> | undefined;
}

export interface TacticalCameraState {
  readonly lastFramedType: 'NONE' | 'POI' | 'COORDINATE' | 'ROUTE' | 'BBOX' | 'RESET';
  readonly currentInsets: ViewportInsets;
  readonly activeTarget: Position | readonly Position[] | null;
  readonly isAnimating: boolean;
}

/**
 * TacticalCameraOpticsEngine:
 * High-precision mathematical camera optics and viewport-aware auto-framing engine.
 *
 * Solves the critical HUD occlusion problem:
 * In a Cyberpunk Tactical Cockpit, the Top Bar (Top Inset), Floating Toolbar (Right Inset),
 * and dynamic Tactical Bottom Sheet (Bottom Inset - PEEK 84px, HALF 45% vh, EXPANDED 88% vh)
 * severely obstruct the visible map canvas.
 *
 * The Optics Engine:
 * 1. Dynamically computes accurate 4-way viewport insets (top, bottom, left, right) based on active HUD UI state.
 * 2. Shifts the visual optical focal point (Optical Center) so the target POI or Route is perfectly centered
 *    in the unobstructed "Sweet Spot" aperture of the tactical screen.
 * 3. Supports multi-point route framing, bounding box fitting, heading alignment, and 3D pitch/bearing maneuvers.
 * 4. Implements SessionDrainHook: instantly cancels camera transitions and jumps to safe fallback coordinates upon panic drain.
 */
export class TacticalCameraOpticsEngine implements SessionDrainHook {
  private readonly map: MapLibreMapInstance;
  private readonly insetsConfig: Required<TacticalHudInsetsConfig>;
  private readonly snapConfig: SnapHeightConfig;
  private readonly defaultCamera: CameraOptions;

  private state: TacticalCameraState;
  private currentSnapPoint: TacticalSnapPoint = 'PEEK';
  private currentCustomBottomHeight: number | null = null;

  constructor(
    map: MapLibreMapInstance,
    options: {
      insetsConfig?: TacticalHudInsetsConfig | undefined;
      snapConfig?: Partial<SnapHeightConfig> | undefined;
      defaultCamera?: CameraOptions | undefined;
      initialSnapPoint?: TacticalSnapPoint | undefined;
    } = {}
  ) {
    this.map = map;
    this.insetsConfig = {
      topBarHeightPx: options.insetsConfig?.topBarHeightPx ?? 64,
      floatingToolbarWidthPx: options.insetsConfig?.floatingToolbarWidthPx ?? 68,
      safetyPaddingPx: options.insetsConfig?.safetyPaddingPx ?? 24,
    };
    this.snapConfig = {
      ...DEFAULT_SNAP_CONFIG,
      ...options.snapConfig,
    };
    this.defaultCamera = options.defaultCamera ?? { center: [21.0122, 52.2297], zoom: 12 };
    this.currentSnapPoint = options.initialSnapPoint ?? 'PEEK';

    this.state = {
      lastFramedType: 'NONE',
      currentInsets: this.computeViewportInsets(this.currentSnapPoint),
      activeTarget: null,
      isAnimating: false,
    };
  }

  public getState(): TacticalCameraState {
    return this.state;
  }

  /**
   * Updates the tracked Bottom Sheet snap point
   */
  public setBottomSheetSnap(snapPoint: TacticalSnapPoint): void {
    this.currentSnapPoint = snapPoint;
    this.currentCustomBottomHeight = null;
    this.state = {
      ...this.state,
      currentInsets: this.computeViewportInsets(snapPoint),
    };
  }

  /**
   * Sets custom bottom sheet height (e.g. during active drag gesture)
   */
  public setBottomSheetHeight(heightPx: number): void {
    this.currentCustomBottomHeight = heightPx;
    this.state = {
      ...this.state,
      currentInsets: this.computeViewportInsets(undefined, heightPx),
    };
  }

  /**
   * Calculates total unobstructed Viewport Insets in pixels
   */
  public computeViewportInsets(
    snapPoint: TacticalSnapPoint = this.currentSnapPoint,
    customBottomHeightPx?: number
  ): ViewportInsets {
    const vh = this.getViewportHeight();
    let bottomHeight = 0;

    if (customBottomHeightPx !== undefined) {
      bottomHeight = customBottomHeightPx;
    } else {
      switch (snapPoint) {
        case 'HIDDEN':
          bottomHeight = 0;
          break;
        case 'PEEK':
          bottomHeight = this.snapConfig.peekHeightPx;
          break;
        case 'HALF':
          bottomHeight = Math.round(vh * this.snapConfig.halfRatio);
          break;
        case 'EXPANDED':
          bottomHeight = Math.round(vh * this.snapConfig.expandedRatio);
          break;
      }
    }

    const top = (this.insetsConfig.topBarHeightPx ?? 64) + (this.insetsConfig.safetyPaddingPx ?? 24);
    const bottom = bottomHeight + (this.insetsConfig.safetyPaddingPx ?? 24);
    const right = (this.insetsConfig.floatingToolbarWidthPx ?? 68) + (this.insetsConfig.safetyPaddingPx ?? 24);
    const left = this.insetsConfig.safetyPaddingPx ?? 24;

    return { top, bottom, left, right };
  }

  /**
   * Calculates optical center shift in pixels
   * Positive Y shifts focal point upwards to compensate for heavy bottom sheet.
   * Positive X shifts focal point leftwards to compensate for right toolbar.
   */
  public computeOpticalCenterOffset(insets: ViewportInsets): { offsetX: number; offsetY: number } {
    const offsetX = (insets.left - insets.right) / 2;
    const offsetY = (insets.top - insets.bottom) / 2;
    return { offsetX, offsetY };
  }

  /**
   * Focuses camera on a single POI item with HUD-compensated optical framing
   */
  public framePoi(poi: PoiItem, options: TacticalFramingOptions = {}): void {
    this.frameCoordinate(poi.coordinate, {
      targetZoom: options.targetZoom ?? 15,
      ...options,
      lastFramedType: 'POI',
    });
  }

  /**
   * Focuses camera on a specific GPS Coordinate [lon, lat] with HUD compensation
   */
  public frameCoordinate(
    coordinate: Position,
    options: TacticalFramingOptions & { lastFramedType?: TacticalCameraState['lastFramedType'] } = {}
  ): void {
    const insets = this.resolveInsets(options);
    const mode = options.mode ?? 'easeTo';
    const duration = options.durationMs ?? 800;
    const zoom = options.targetZoom ?? 14;

    const cameraOpts: CameraOptions & { duration?: number } = {
      center: [coordinate[0], coordinate[1]],
      zoom,
      ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
      ...(options.bearing !== undefined ? { bearing: options.bearing } : {}),
      duration,
    };

    // If MapLibre fitBounds or easeTo supports padding:
    this.applyCameraMove(mode, cameraOpts, insets, coordinate, options.lastFramedType ?? 'COORDINATE');
  }

  /**
   * Frames an entire Route Data trajectory with waypoints and bounding box
   */
  public frameRoute(route: RouteData, options: TacticalFramingOptions = {}): void {
    if (!route.waypoints || route.waypoints.length === 0) {
      return;
    }

    const coordinates = route.waypoints.map((w) => w.coordinate);
    this.frameCoordinates(coordinates, {
      ...options,
      lastFramedType: 'ROUTE',
    });
  }

  /**
   * Frames a set of multiple coordinates (e.g. POI cluster, route segment, search radius)
   */
  public frameCoordinates(
    coordinates: readonly Position[],
    options: TacticalFramingOptions & { lastFramedType?: TacticalCameraState['lastFramedType'] } = {}
  ): void {
    if (coordinates.length === 0) {
      return;
    }

    if (coordinates.length === 1) {
      this.frameCoordinate(coordinates[0]!, options);
      return;
    }

    const bbox = GeoSpatialUtils.bboxFromCoordinates(coordinates);
    this.frameBoundingBox(bbox, options);
  }

  /**
   * Frames a Bounding Box [minLon, minLat, maxLon, maxLat] with exact HUD-padded fitBounds
   */
  public frameBoundingBox(
    bbox: [number, number, number, number],
    options: TacticalFramingOptions & { lastFramedType?: TacticalCameraState['lastFramedType'] } = {}
  ): void {
    const insets = this.resolveInsets(options);
    const duration = options.durationMs ?? 900;
    const maxZoom = options.maxZoom ?? 17;

    const bounds: [[number, number], [number, number]] = [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ];

    const fitOptions: FitBoundsOptions = {
      padding: insets,
      duration,
      maxZoom,
      linear: options.mode === 'jumpTo',
    };

    if (typeof this.map.fitBounds === 'function') {
      this.map.fitBounds(bounds, fitOptions);
      this.state = {
        lastFramedType: options.lastFramedType ?? 'BBOX',
        currentInsets: insets,
        activeTarget: [
          [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
        ] as any,
        isAnimating: true,
      };
    }
  }

  /**
   * Resets the camera back to default HUD viewpoint
   */
  public resetCamera(options: { durationMs?: number } = {}): void {
    this.stopAnimations();
    const duration = options.durationMs ?? 600;

    if (duration > 0 && typeof this.map.easeTo === 'function') {
      this.map.easeTo({
        ...this.defaultCamera,
        duration,
      });
    } else if (typeof this.map.jumpTo === 'function') {
      this.map.jumpTo(this.defaultCamera);
    }

    this.state = {
      lastFramedType: 'RESET',
      currentInsets: this.computeViewportInsets(),
      activeTarget: null,
      isAnimating: false,
    };
  }

  /**
   * Stops any currently executing camera pan/zoom animations
   */
  public stopAnimations(): void {
    if (typeof this.map.stop === 'function') {
      try {
        this.map.stop();
      } catch {
        // Safe disposal
      }
    }
    this.state = {
      ...this.state,
      isAnimating: false,
    };
  }

  /**
   * PANIC/DRAIN: SessionDrainHook implementation
   * Stops all transitions, clears targets, and jumps camera to safe default view.
   */
  public drain(_reason = 'CAMERA_DRAIN', _previousSession?: unknown): void {
    this.stopAnimations();
    if (typeof this.map.jumpTo === 'function') {
      try {
        this.map.jumpTo(this.defaultCamera);
      } catch {
        // Safe disposal
      }
    }

    this.state = {
      lastFramedType: 'RESET',
      currentInsets: this.computeViewportInsets('HIDDEN'),
      activeTarget: null,
      isAnimating: false,
    };
  }

  public destroy(): void {
    this.drain('DESTROY');
  }

  private resolveInsets(options: TacticalFramingOptions): ViewportInsets {
    const snap = options.bottomSheetSnap ?? this.currentSnapPoint;
    const customBottom = options.bottomSheetHeightPx ?? this.currentCustomBottomHeight ?? undefined;
    const baseInsets = this.computeViewportInsets(snap, customBottom);

    if (options.additionalInsets) {
      return {
        top: baseInsets.top + (options.additionalInsets.top ?? 0),
        bottom: baseInsets.bottom + (options.additionalInsets.bottom ?? 0),
        left: baseInsets.left + (options.additionalInsets.left ?? 0),
        right: baseInsets.right + (options.additionalInsets.right ?? 0),
      };
    }

    return baseInsets;
  }

  private applyCameraMove(
    mode: TacticalCameraAnimationMode,
    cameraOpts: CameraOptions & { duration?: number },
    insets: ViewportInsets,
    target: Position,
    framedType: TacticalCameraState['lastFramedType']
  ): void {
    // If fitBounds is preferred or direct easeTo
    if (mode === 'easeTo' && typeof this.map.easeTo === 'function') {
      this.map.easeTo({
        ...cameraOpts,
        padding: insets as any,
      } as any);
    } else if (mode === 'flyTo' && typeof this.map.flyTo === 'function') {
      this.map.flyTo({
        ...cameraOpts,
        padding: insets as any,
      } as any);
    } else if (typeof this.map.jumpTo === 'function') {
      this.map.jumpTo({
        ...cameraOpts,
        padding: insets as any,
      } as any);
    }

    this.state = {
      lastFramedType: framedType,
      currentInsets: insets,
      activeTarget: target,
      isAnimating: mode !== 'jumpTo',
    };
  }

  private getViewportHeight(): number {
    if (typeof window !== 'undefined' && window.innerHeight) {
      return window.innerHeight;
    }
    return 800;
  }
}
