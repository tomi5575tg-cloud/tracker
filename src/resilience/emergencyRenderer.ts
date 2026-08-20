import type { Position } from '../geojson/types.js';
import type { EmergencyRenderFrame } from './types.js';

export interface EmergencyRendererConfig {
  readonly canvasElement?: HTMLCanvasElement | undefined;
  readonly defaultWidth?: number | undefined;
  readonly defaultHeight?: number | undefined;
  readonly neonThemeAccent?: string | undefined;
}

/**
 * EmergencyRenderer:
 * Autonomous 2D Canvas & Vector SVG emergency renderer guaranteeing that
 * the screen never goes black during WebGL context loss, GPU process crashes,
 * memory pressure or driver stalls (SPOF Screen Protection).
 *
 * Capabilities:
 * 1. Renders tactical navigation HUD directly to HTML5 2D Canvas or generates complete SVG render trees.
 * 2. Visualizes vehicle position (GPS or Dead Reckoning pulsing reticle), Golden Thread route, POIs, and heading.
 * 3. Shows active Graceful Degradation status badge (e.g. "LEVEL_3: 2D VECTOR FALLBACK").
 * 4. Ultra-low overhead, zero WebGL dependency.
 */
export class EmergencyRenderer {
  private readonly config: Required<EmergencyRendererConfig>;

  constructor(config: EmergencyRendererConfig = {}) {
    this.config = {
      canvasElement: config.canvasElement ?? undefined as any,
      defaultWidth: config.defaultWidth ?? 800,
      defaultHeight: config.defaultHeight ?? 600,
      neonThemeAccent: config.neonThemeAccent ?? '#00F0FF',
    };
  }

  /**
   * Generates a complete standalone SVG vector frame representation of the emergency HUD map.
   */
  public renderSvgFrame(frame: EmergencyRenderFrame): string {
    const w: number = frame.width || (this.config.defaultWidth ?? 800);
    const h: number = frame.height || (this.config.defaultHeight ?? 600);
    const center = frame.center;
    const currentPos = frame.currentPosition;
    const zoom = frame.zoom;

    const currentPx = this.lonLatToScreen(currentPos, center, zoom, w, h);

    // Render active route polyline if present
    let routeSvg = '';
    if (frame.activeRoute && frame.activeRoute.waypoints.length > 1) {
      const pts = frame.activeRoute.waypoints.map((wp) => {
        const [px, py] = this.lonLatToScreen(wp.coordinate, center, zoom, w, h);
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      });
      const pointsAttr = pts.join(' ');
      routeSvg = `
        <polyline points="${pointsAttr}" fill="none" stroke="#FFA726" stroke-width="8" stroke-linecap="round" opacity="0.3" />
        <polyline points="${pointsAttr}" fill="none" stroke="#FFD700" stroke-width="4" stroke-linecap="round" opacity="0.85" />
        <polyline points="${pointsAttr}" fill="none" stroke="#FFF8E7" stroke-width="2" stroke-linecap="round" opacity="1.0" />
      `;
    }

    // Render POIs
    let poisSvg = '';
    for (const poi of frame.nearbyPois) {
      const [px, py] = this.lonLatToScreen(poi.coordinate, center, zoom, w, h);
      if (px >= 0 && px <= w && py >= 0 && py <= h) {
        poisSvg += `
          <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="#00F0FF" stroke="#FFFFFF" stroke-width="1.5" opacity="0.9" />
          <text x="${px.toFixed(1)}" y="${(py + 14).toFixed(1)}" fill="#00F0FF" font-family="monospace" font-size="10" text-anchor="middle">${poi.name}</text>
        `;
      }
    }

    // Vehicle Reticle (Arrow/Cone with Dead Reckoning indicator)
    const reticleColor = frame.isDeadReckoning ? '#FF9100' : '#00FF9F';
    const reticlePulse = frame.isDeadReckoning
      ? `<circle cx="${currentPx[0].toFixed(1)}" cy="${currentPx[1].toFixed(1)}" r="18" fill="none" stroke="#FF9100" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.8" />`
      : '';

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background-color: #05070D;">
  <!-- Tactical Grid -->
  <defs>
    <pattern id="tac-grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0, 240, 255, 0.08)" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#tac-grid)" />

  <!-- Compass Crosshair at center -->
  <line x1="${w / 2 - 30}" y1="${h / 2}" x2="${w / 2 + 30}" y2="${h / 2}" stroke="rgba(0, 240, 255, 0.25)" stroke-width="1" />
  <line x1="${w / 2}" y1="${h / 2 - 30}" x2="${w / 2}" y2="${h / 2 + 30}" stroke="rgba(0, 240, 255, 0.25)" stroke-width="1" />

  <!-- Active Route -->
  ${routeSvg}

  <!-- POIs -->
  ${poisSvg}

  <!-- Vehicle Position & Heading Arrow -->
  <g transform="translate(${currentPx[0].toFixed(1)}, ${currentPx[1].toFixed(1)}) rotate(${frame.heading})">
    <polygon points="0,-14 9,10 0,5 -9,10" fill="${reticleColor}" stroke="#FFFFFF" stroke-width="1.5" />
  </g>
  ${reticlePulse}

  <!-- Degradation Status Banner -->
  <rect x="16" y="16" width="310" height="32" rx="6" fill="rgba(11, 15, 25, 0.9)" stroke="rgba(255, 145, 0, 0.5)" stroke-width="1" />
  <circle cx="32" cy="32" r="5" fill="${frame.isDeadReckoning ? '#FF9100' : '#00F0FF'}" />
  <text x="46" y="36" fill="#FFFFFF" font-family="monospace" font-size="11" font-weight="bold">
    ${frame.degradationLevel} | ${frame.isDeadReckoning ? 'DEAD RECKONING' : '2D EMERGENCY HUD'}
  </text>
</svg>
    `.trim();
  }

  /**
   * Renders the emergency frame onto an HTML5 2D Canvas context.
   */
  public renderToCanvas(canvas: HTMLCanvasElement, frame: EmergencyRenderFrame): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const center = frame.center;
    const zoom = frame.zoom;

    // 1. Background
    ctx.fillStyle = '#05070D';
    ctx.fillRect(0, 0, w, h);

    // 2. Tactical Grid
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 3. Route
    if (frame.activeRoute && frame.activeRoute.waypoints.length > 1) {
      ctx.beginPath();
      frame.activeRoute.waypoints.forEach((wp, idx) => {
        const [px, py] = this.lonLatToScreen(wp.coordinate, center, zoom, w, h);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = '#FFA726';
      ctx.lineWidth = 8;
      ctx.globalAlpha = 0.3;
      ctx.stroke();

      ctx.strokeStyle = '#FFD700';
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      ctx.strokeStyle = '#FFF8E7';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1.0;
      ctx.stroke();
    }

    // 4. Vehicle reticle
    const [vx, vy] = this.lonLatToScreen(frame.currentPosition, center, zoom, w, h);
    ctx.save();
    ctx.translate(vx, vy);
    ctx.rotate((frame.heading * Math.PI) / 180);
    ctx.fillStyle = frame.isDeadReckoning ? '#FF9100' : '#00FF9F';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 5. Emergency Banner
    ctx.fillStyle = 'rgba(11, 15, 25, 0.9)';
    ctx.strokeStyle = 'rgba(255, 145, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.fillRect(16, 16, 310, 32);
    ctx.strokeRect(16, 16, 310, 32);

    ctx.fillStyle = frame.isDeadReckoning ? '#FF9100' : '#00F0FF';
    ctx.beginPath();
    ctx.arc(32, 32, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(
      `${frame.degradationLevel} | ${frame.isDeadReckoning ? 'DEAD RECKONING' : '2D EMERGENCY HUD'}`,
      46,
      36
    );
  }

  private lonLatToScreen(
    coord: Position,
    center: Position,
    zoom: number,
    screenWidth: number,
    screenHeight: number
  ): [x: number, y: number] {
    const scale = Math.pow(2, zoom) * 128;
    const [lon, lat] = coord;
    const [cLon, cLat] = center;

    const radLat = (lat * Math.PI) / 180;
    const radCLat = (cLat * Math.PI) / 180;

    const x = ((lon - cLon) * Math.PI) / 180;
    const y =
      Math.log(Math.tan(Math.PI / 4 + radLat / 2)) -
      Math.log(Math.tan(Math.PI / 4 + radCLat / 2));

    const screenX = screenWidth / 2 + x * scale;
    const screenY = screenHeight / 2 - y * scale;

    return [screenX, screenY];
  }
}
