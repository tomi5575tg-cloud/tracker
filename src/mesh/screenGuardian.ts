import type { Position } from '../geojson/types.js';
import type { RouteData } from '../types.js';
import type { PoiItem, PoiCategory } from '../poi/types.js';
import {
  DegradationLevel,
  ScreenRenderMode,
  type ScreenGuardianState,
  type TelemetryFix,
} from './types.js';

export interface ScreenRenderData {
  readonly currentFix: TelemetryFix;
  readonly activeRoute: RouteData | null;
  readonly pois: readonly PoiItem[];
  readonly selectedPoi: PoiItem | null;
  readonly selectedCategory?: PoiCategory | null | undefined;
  readonly viewportCenter: Position;
  readonly zoom: number;
  readonly headingDegrees: number;
  readonly degradationLevel: DegradationLevel;
}

export interface ScreenGuardianOptions {
  readonly initialMode?: ScreenRenderMode | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly onModeChanged?: ((mode: ScreenRenderMode, previousMode: ScreenRenderMode, reason: string) => void) | undefined;
  readonly onRecovery?: ((totalRecoveries: number) => void) | undefined;
}

export class ScreenGuardian {
  private currentMode: ScreenRenderMode;
  private webGlAvailable = true;
  private isScreenAlive = true;
  private lastHeartbeatTime = Date.now();
  private totalRecoveries = 0;
  private lastError?: string | undefined;
  private fps = 60;
  private frameCount = 0;
  private lastFpsCalculationTime = Date.now();
  private readonly onModeChanged?: ((mode: ScreenRenderMode, previousMode: ScreenRenderMode, reason: string) => void) | undefined;
  private readonly onRecovery?: ((totalRecoveries: number) => void) | undefined;

  constructor(options: ScreenGuardianOptions = {}) {
    this.currentMode = options.initialMode ?? ScreenRenderMode.WEBGL_VECTOR;
    this.onModeChanged = options.onModeChanged;
    this.onRecovery = options.onRecovery;
  }

  public getRenderMode(): ScreenRenderMode {
    return this.currentMode;
  }

  public isWebGlAvailable(): boolean {
    return this.webGlAvailable;
  }

  public getState(): ScreenGuardianState {
    return {
      renderMode: this.currentMode,
      webGlContextAvailable: this.webGlAvailable,
      renderFps: this.fps,
      isScreenAlive: this.isScreenAlive,
      lastHeartbeatTimestamp: this.lastHeartbeatTime,
      totalRecoveries: this.totalRecoveries,
      lastError: this.lastError,
    };
  }

  /**
   * Heartbeat to confirm rendering loop is actively running and screen is alive.
   */
  public heartbeat(): void {
    const now = Date.now();
    this.lastHeartbeatTime = now;
    this.isScreenAlive = true;
    this.frameCount++;

    const elapsed = now - this.lastFpsCalculationTime;
    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFpsCalculationTime = now;
    }
  }

  /**
   * Called when WebGL context loss is detected.
   * Immediately downgrades rendering to 2D Canvas or SVG Vector to prevent screen blackout.
   */
  public handleWebGlContextLost(reason = 'WebGL context lost'): void {
    this.webGlAvailable = false;
    this.lastError = reason;
    this.totalRecoveries++;

    const previousMode = this.currentMode;
    if (this.currentMode === ScreenRenderMode.WEBGL_VECTOR) {
      this.currentMode = ScreenRenderMode.CANVAS_2D;
      this.onModeChanged?.(this.currentMode, previousMode, reason);
      this.onRecovery?.(this.totalRecoveries);
    }
  }

  /**
   * Called when WebGL context is restored.
   */
  public handleWebGlContextRestored(): void {
    this.webGlAvailable = true;
    this.lastError = undefined;

    const previousMode = this.currentMode;
    if (this.currentMode !== ScreenRenderMode.WEBGL_VECTOR) {
      this.currentMode = ScreenRenderMode.WEBGL_VECTOR;
      this.onModeChanged?.(this.currentMode, previousMode, 'WebGL context restored');
    }
  }

  /**
   * Manually sets or forces render mode (e.g. user toggles high-contrast emergency mode)
   */
  public setRenderMode(mode: ScreenRenderMode, reason = 'Manual mode change'): void {
    if (this.currentMode === mode) return;
    const prev = this.currentMode;
    this.currentMode = mode;
    this.onModeChanged?.(mode, prev, reason);
  }

  /**
   * Safe execution wrapper for render passes. If any renderer throws, it automatically
   * degrades to the next fallback level and produces guaranteed valid HTML/DOM.
   */
  public safeRender(data: ScreenRenderData): string {
    this.heartbeat();

    // Multi-tier Fallback Render Execution
    // Tier 0: WebGL Vector
    if (this.currentMode === ScreenRenderMode.WEBGL_VECTOR && this.webGlAvailable) {
      try {
        return this.renderWebGlContainer(data);
      } catch (err: unknown) {
        this.handleWebGlContextLost(err instanceof Error ? err.message : String(err));
      }
    }

    // Tier 1: 2D Canvas Fallback
    if (this.currentMode === ScreenRenderMode.CANVAS_2D || this.currentMode === ScreenRenderMode.WEBGL_VECTOR) {
      try {
        return this.renderCanvas2DHtml(data);
      } catch (canvasErr: unknown) {
        this.lastError = canvasErr instanceof Error ? canvasErr.message : String(canvasErr);
        this.currentMode = ScreenRenderMode.SVG_VECTOR;
      }
    }

    // Tier 2: SVG Vector Fallback
    if (this.currentMode === ScreenRenderMode.SVG_VECTOR) {
      try {
        return this.renderSvgVectorHtml(data);
      } catch (svgErr: unknown) {
        this.lastError = svgErr instanceof Error ? svgErr.message : String(svgErr);
        this.currentMode = ScreenRenderMode.TEXT_EMERGENCY_HUD;
      }
    }

    // Tier 3: High-Contrast Emergency HUD (Zero-dependency, zero crash)
    return this.renderTextEmergencyHudHtml(data);
  }

  /**
   * Renders WebGL container (standard MapLibre canvas mount)
   */
  private renderWebGlContainer(_data: ScreenRenderData): string {
    return `
<div id="maplibre-cockpit-canvas" class="absolute inset-0 w-full h-full" data-render-mode="WEBGL_VECTOR"></div>
`.trim();
  }

  /**
   * Renders 2D Canvas Fallback Map HTML
   */
  public renderCanvas2DHtml(data: ScreenRenderData): string {
    const coordStr = `${data.currentFix.position[1].toFixed(5)}°N, ${data.currentFix.position[0].toFixed(5)}°E`;
    return `
<div class="absolute inset-0 w-full h-full bg-slate-950 flex flex-col items-center justify-center font-mono select-none" data-render-mode="CANVAS_2D">
  <div class="relative w-full h-full flex flex-col justify-between p-4 bg-[radial-gradient(#083344_1px,transparent_1px)] [background-size:16px_16px]">
    <!-- Top Canvas Status -->
    <div class="flex items-center justify-between px-4 py-2 bg-slate-900/90 border border-amber-500/40 rounded-xl backdrop-blur text-xs">
      <div class="flex items-center gap-2 text-amber-400 font-bold">
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
        <span>TRYB AWARYJNY 2D CANVAS</span>
      </div>
      <div class="text-slate-400 text-[11px]">${coordStr} | KURS: ${Math.round(data.headingDegrees)}°</div>
    </div>

    <!-- Center Schematic Radar Canvas Simulation -->
    <div class="relative flex-1 flex items-center justify-center my-4 border border-cyan-500/20 rounded-2xl bg-slate-950/60 overflow-hidden">
      <!-- Crosshairs -->
      <div class="absolute inset-x-0 top-1/2 h-px bg-cyan-500/20"></div>
      <div class="absolute inset-y-0 left-1/2 w-px bg-cyan-500/20"></div>
      <div class="w-64 h-64 rounded-full border border-cyan-500/25 flex items-center justify-center">
        <div class="w-44 h-44 rounded-full border border-cyan-500/20 flex items-center justify-center">
          <div class="w-24 h-24 rounded-full border border-cyan-500/15"></div>
        </div>
      </div>

      <!-- Vehicle Indicator -->
      <div class="absolute flex flex-col items-center justify-center transform" style="transform: rotate(${data.headingDegrees}deg)">
        <div class="w-0 h-0 border-x-8 border-x-transparent border-b-[18px] border-b-cyan-400 filter drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]"></div>
      </div>

      <div class="absolute bottom-3 left-4 text-[10px] text-cyan-400/80">
        PUNKTY POI: <span class="text-white">${data.pois.length}</span> | TRASA: <span class="text-amber-400">${data.activeRoute ? 'AKTYWNA' : 'BRAK'}</span>
      </div>
    </div>

    <!-- Bottom Status -->
    <div class="text-[11px] text-center text-slate-400">
      Silnik GPU WebGL uległ degradacji. Aktywny wielopoziomowy bufor 2D.
    </div>
  </div>
</div>
`.trim();
  }

  /**
   * Renders SVG Vector Schematic HUD
   */
  public renderSvgVectorHtml(data: ScreenRenderData): string {
    const [lon, lat] = data.currentFix.position;
    return `
<div class="absolute inset-0 w-full h-full bg-slate-950 flex flex-col items-center justify-between p-4 font-mono select-none" data-render-mode="SVG_VECTOR">
  <div class="w-full flex items-center justify-between px-4 py-2 bg-slate-900 border border-orange-500/50 rounded-xl text-xs text-orange-400">
    <span class="font-bold">⚡ SVG VECTOR RADAR HUD</span>
    <span>POZYCJA: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°</span>
  </div>

  <div class="w-full max-w-lg aspect-square relative my-auto border border-orange-500/30 rounded-2xl bg-black/80 flex items-center justify-center">
    <svg viewBox="0 0 200 200" class="w-full h-full p-4">
      <!-- Radar grid rings -->
      <circle cx="100" cy="100" r="90" fill="none" stroke="#f97316" stroke-width="0.75" stroke-dasharray="3,3" opacity="0.4"/>
      <circle cx="100" cy="100" r="60" fill="none" stroke="#f97316" stroke-width="0.75" opacity="0.5"/>
      <circle cx="100" cy="100" r="30" fill="none" stroke="#f97316" stroke-width="0.75" opacity="0.6"/>
      <!-- Axes -->
      <line x1="100" y1="10" x2="100" y2="190" stroke="#f97316" stroke-width="0.5" opacity="0.3"/>
      <line x1="10" y1="100" x2="190" y2="100" stroke="#f97316" stroke-width="0.5" opacity="0.3"/>
      <!-- Compass North mark -->
      <text x="100" y="22" fill="#f97316" font-size="8" text-anchor="middle" font-weight="bold">N</text>
      <!-- Vehicle Triangle -->
      <g transform="translate(100, 100) rotate(${data.headingDegrees})">
        <polygon points="0,-12 8,10 -8,10" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" />
      </g>
    </svg>
  </div>

  <div class="text-xs text-orange-400/80 text-center">
    SVG Fallback Engine | Degradacja: Poziom ${data.degradationLevel}
  </div>
</div>
`.trim();
  }

  /**
   * Renders High-Contrast Emergency HUD (Survival Mode - Zero Crash Guarantee)
   */
  public renderTextEmergencyHudHtml(data: ScreenRenderData): string {
    const [lon, lat] = data.currentFix.position;
    const speed = Math.round(data.currentFix.speedKmh);
    const heading = Math.round(data.headingDegrees);
    const accuracy = Math.round(data.currentFix.accuracyMeters);
    const source = data.currentFix.source;

    // Convert heading to 8-cardinal compass string
    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const cardinalIndex = Math.round(((heading % 360) / 45)) % 8;
    const cardinalStr = cardinals[cardinalIndex] ?? 'N';

    return `
<div class="absolute inset-0 w-full h-full bg-black text-amber-400 p-6 flex flex-col justify-between font-mono select-none" data-render-mode="TEXT_EMERGENCY_HUD">
  <!-- Top Emergency Banner -->
  <div class="border-2 border-amber-400 bg-amber-950/40 p-4 rounded-lg flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="w-4 h-4 rounded-full bg-amber-400 animate-ping"></span>
      <span class="text-lg font-black tracking-widest uppercase">EKRAN AWARYJNY HUD (SURVIVAL MODE)</span>
    </div>
    <div class="text-xs font-bold border border-amber-400 px-3 py-1 rounded">
      STAN: NIEPRZERWANA NAWIGACJA
    </div>
  </div>

  <!-- Main Telemetry Grid -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 my-6">
    <div class="border border-amber-500/50 bg-slate-950 p-4 rounded-lg">
      <div class="text-xs text-amber-500/70 font-semibold">SZEROKOŚĆ (LAT)</div>
      <div class="text-2xl font-bold text-white mt-1">${lat.toFixed(6)}°</div>
    </div>
    <div class="border border-amber-500/50 bg-slate-950 p-4 rounded-lg">
      <div class="text-xs text-amber-500/70 font-semibold">DŁUGOŚĆ (LON)</div>
      <div class="text-2xl font-bold text-white mt-1">${lon.toFixed(6)}°</div>
    </div>
    <div class="border border-amber-500/50 bg-slate-950 p-4 rounded-lg">
      <div class="text-xs text-amber-500/70 font-semibold">PRĘDKOŚĆ</div>
      <div class="text-2xl font-bold text-white mt-1">${speed} <span class="text-sm">km/h</span></div>
    </div>
    <div class="border border-amber-500/50 bg-slate-950 p-4 rounded-lg">
      <div class="text-xs text-amber-500/70 font-semibold">KURS / AZYMUT</div>
      <div class="text-2xl font-bold text-white mt-1">${heading}° <span class="text-amber-400">(${cardinalStr})</span></div>
    </div>
  </div>

  <!-- Middle Route & Positioning Info -->
  <div class="border border-amber-500/40 bg-slate-950/80 p-4 rounded-lg space-y-2 text-sm">
    <div class="flex justify-between border-b border-amber-500/20 pb-2">
      <span class="text-slate-400">ŹRÓDŁO POZYCJI:</span>
      <span class="font-bold text-amber-300">${source}</span>
    </div>
    <div class="flex justify-between border-b border-amber-500/20 pb-2">
      <span class="text-slate-400">DOKŁADNOŚĆ / NIEPEWNOŚĆ:</span>
      <span class="font-bold text-amber-300">±${accuracy} m</span>
    </div>
    <div class="flex justify-between">
      <span class="text-slate-400">STATUS TRASY:</span>
      <span class="font-bold ${data.activeRoute ? 'text-emerald-400' : 'text-rose-400'}">
        ${data.activeRoute ? `AKTYWNA (ID: ${data.activeRoute.routeId})` : 'BRAK'}
      </span>
    </div>
  </div>

  <!-- Footer Notice -->
  <div class="text-center text-xs text-amber-500/80 border-t border-amber-500/30 pt-3">
    Gwarancja anty-awaryjna: Ekran nie wygasa. Nawigacja kontynuowana w trybie awaryjnym.
  </div>
</div>
`.trim();
  }
}
