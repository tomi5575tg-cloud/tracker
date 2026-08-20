import type { EmergencyRenderFrame } from '../resilience/types.js';
import { BlankScreenError } from '../weld/errors.js';
import { projectLonLatToScreen, type ScreenPoint } from './projection.js';

export type PixelCommandKind = 'CLEAR' | 'GRID' | 'ROUTE' | 'POI' | 'VEHICLE' | 'BANNER' | 'EMPTY_CABIN';

export interface PixelCommand {
  readonly kind: PixelCommandKind;
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly heading?: number | undefined;
  readonly color?: string | undefined;
  readonly text?: string | undefined;
  readonly vertexCount?: number | undefined;
}

export interface PixelAudit {
  readonly width: number;
  readonly height: number;
  readonly vehicleScreen: ScreenPoint | null;
  readonly routeVertexCount: number;
  readonly poiCount: number;
  readonly banner: string;
  readonly commandCount: number;
  readonly isBlank: boolean;
  readonly screenFilled: boolean;
  readonly paintedAt: number;
}

/**
 * Deterministic pixel ledger for the cabin map pane.
 * Tests X-ray this buffer instead of trusting HTML strings or mocked WebGL.
 */
export class PixelFrameBuffer {
  private commands: PixelCommand[] = [];
  private width = 0;
  private height = 0;
  private vehicleScreen: ScreenPoint | null = null;
  private routeVertexCount = 0;
  private poiCount = 0;
  private banner = '';
  private paintedAt = 0;

  public clear(): void {
    this.commands = [];
    this.width = 0;
    this.height = 0;
    this.vehicleScreen = null;
    this.routeVertexCount = 0;
    this.poiCount = 0;
    this.banner = '';
    this.paintedAt = 0;
  }

  public paint(frame: EmergencyRenderFrame): PixelAudit {
    this.clear();
    this.width = frame.width;
    this.height = frame.height;
    this.paintedAt = Date.now();

    this.commands.push({ kind: 'CLEAR', color: '#05070D' });
    this.commands.push({ kind: 'GRID' });

    if (frame.activeRoute && frame.activeRoute.waypoints.length > 1) {
      this.routeVertexCount = frame.activeRoute.waypoints.length;
      this.commands.push({ kind: 'ROUTE', vertexCount: this.routeVertexCount, color: '#FFD700' });
    }

    for (const poi of frame.nearbyPois) {
      const point = projectLonLatToScreen(poi.coordinate, frame.center, frame.zoom, frame.width, frame.height);
      this.poiCount += 1;
      this.commands.push({ kind: 'POI', x: point.x, y: point.y, text: poi.name, color: '#00F0FF' });
    }

    const vehicle = projectLonLatToScreen(
      frame.currentPosition,
      frame.center,
      frame.zoom,
      frame.width,
      frame.height
    );
    this.vehicleScreen = vehicle;
    this.commands.push({
      kind: 'VEHICLE',
      x: vehicle.x,
      y: vehicle.y,
      heading: frame.heading,
      color: frame.isDeadReckoning ? '#FF9100' : '#00FF9F',
    });

    this.banner = `${frame.degradationLevel} | ${frame.isDeadReckoning ? 'DEAD RECKONING' : '2D EMERGENCY HUD'}`;
    this.commands.push({ kind: 'BANNER', text: this.banner });

    const audit = this.audit();
    if (!audit.screenFilled) {
      throw new BlankScreenError('paint() produced no vehicle pixel');
    }
    return audit;
  }

  public paintEmptyCabin(width: number, height: number, reason: string): PixelAudit {
    this.clear();
    this.width = width;
    this.height = height;
    this.paintedAt = Date.now();
    this.banner = `KABINA PUSTA | ${reason}`;
    this.commands.push({ kind: 'CLEAR', color: '#05070D' });
    this.commands.push({ kind: 'EMPTY_CABIN', text: this.banner });
    return this.audit();
  }

  public audit(): PixelAudit {
    const isBlank = this.commands.length === 0;
    const hasSurface = this.commands.some(
      (cmd) => cmd.kind === 'VEHICLE' || cmd.kind === 'EMPTY_CABIN' || cmd.kind === 'BANNER'
    );
    return {
      width: this.width,
      height: this.height,
      vehicleScreen: this.vehicleScreen,
      routeVertexCount: this.routeVertexCount,
      poiCount: this.poiCount,
      banner: this.banner,
      commandCount: this.commands.length,
      isBlank,
      screenFilled: !isBlank && hasSurface,
      paintedAt: this.paintedAt,
    };
  }

  public getCommands(): readonly PixelCommand[] {
    return this.commands;
  }
}
