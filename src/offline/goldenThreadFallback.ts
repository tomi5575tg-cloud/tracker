import type { RouteData } from '../types.js';
import { TacticalTileCacheManager, type TileCoordinate } from './tileCacheManager.js';

export interface GoldenThreadFallbackConfig {
  /**
   * Tile size in pixels for synthetic tile rendering (default: 256)
   */
  readonly tileSize?: number | undefined;
  /**
   * Glow line color (hex or rgb, default: '#FFD700')
   */
  readonly goldenMidColor?: string | undefined;
  /**
   * Glow core line color (default: '#FFF8E7')
   */
  readonly goldenCoreColor?: string | undefined;
  /**
   * Ambient dark background for offline synthetic map tiles (default: '#0B0F19')
   */
  readonly darkBackgroundColor?: string | undefined;
  /**
   * Grid line color for tactical dark tile grid (default: 'rgba(0, 240, 255, 0.12)')
   */
  readonly gridColor?: string | undefined;
}

export interface SyntheticTileResult {
  readonly coordinate: TileCoordinate;
  readonly svg: string;
  readonly hasRouteIntersect: boolean;
  readonly intersectedSegments: number;
}

/**
 * GoldenThreadOfflineFallback:
 * Dynamic synthetic tile & vector fallback generator for Golden Thread route rendering
 * when network or base map tile servers are offline/unreachable.
 *
 * Capabilities:
 * 1. Computes mathematical intersection between route trajectory segments and slippy map tile bounds.
 * 2. Generates standalone, razor-sharp SVG vector tiles representing the tactical Golden Thread in the tile coordinate space.
 * 3. Renders tactical cyberpunk gridlines with GPS reference coordinates even in complete radio silence (offline mode).
 * 4. Injects generated synthetic tiles directly into the TacticalTileCacheManager.
 */
export class GoldenThreadOfflineFallback {
  private readonly config: Required<GoldenThreadFallbackConfig>;
  private activeRoute: RouteData | null = null;

  constructor(config: GoldenThreadFallbackConfig = {}) {
    this.config = {
      tileSize: config.tileSize ?? 256,
      goldenMidColor: config.goldenMidColor ?? '#FFD700',
      goldenCoreColor: config.goldenCoreColor ?? '#FFF8E7',
      darkBackgroundColor: config.darkBackgroundColor ?? '#0B0F19',
      gridColor: config.gridColor ?? 'rgba(0, 240, 255, 0.12)',
    };
  }

  public setActiveRoute(route: RouteData | null): void {
    this.activeRoute = route;
  }

  public getActiveRoute(): RouteData | null {
    return this.activeRoute;
  }

  /**
   * Generates a synthetic SVG tile for a given tile coordinate (z, x, y),
   * plotting any route segments of the active Golden Thread that pass through this tile.
   */
  public generateSyntheticTile(coordinate: TileCoordinate): SyntheticTileResult {
    const { x, y, z } = coordinate;
    const [minLon, minLat, maxLon, maxLat] = TacticalTileCacheManager.tileToLonLatBounds(x, y, z);

    const size = this.config.tileSize ?? 256;
    const pathSegments: string[] = [];
    let intersectedSegments = 0;

    if (this.activeRoute && this.activeRoute.waypoints.length > 1) {
      const waypoints = this.activeRoute.waypoints;

      for (let i = 0; i < waypoints.length - 1; i++) {
        const p1 = waypoints[i]!.coordinate;
        const p2 = waypoints[i + 1]!.coordinate;

        // Check if segment bounding box intersects tile bbox
        const segMinLon = Math.min(p1[0], p2[0]);
        const segMaxLon = Math.max(p1[0], p2[0]);
        const segMinLat = Math.min(p1[1], p2[1]);
        const segMaxLat = Math.max(p1[1], p2[1]);

        const intersects =
          segMinLon <= maxLon &&
          segMaxLon >= minLon &&
          segMinLat <= maxLat &&
          segMaxLat >= minLat;

        if (intersects) {
          intersectedSegments++;
          const px1 = this.lonLatToTilePixel(p1[0], p1[1], coordinate, size);
          const px2 = this.lonLatToTilePixel(p2[0], p2[1], coordinate, size);

          pathSegments.push(`M ${px1[0].toFixed(1)} ${px1[1].toFixed(1)} L ${px2[0].toFixed(1)} ${px2[1].toFixed(1)}`);
        }
      }
    }

    const hasRouteIntersect = pathSegments.length > 0;
    const pathData = pathSegments.join(' ');

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${this.config.darkBackgroundColor}" />
  <!-- Tactical Grid Lines -->
  <path d="M 0 0 L ${size} 0 L ${size} ${size} L 0 ${size} Z" fill="none" stroke="${this.config.gridColor}" stroke-width="1" />
  <path d="M ${size / 2} 0 L ${size / 2} ${size} M 0 ${size / 2} L ${size} ${size / 2}" fill="none" stroke="${this.config.gridColor}" stroke-width="0.75" stroke-dasharray="4,4" />
  
  ${
    hasRouteIntersect
      ? `
  <!-- Golden Thread Outer Glow Fallback -->
  <path d="${pathData}" fill="none" stroke="${this.config.goldenMidColor}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.4" />
  <!-- Golden Thread Mid Radiant -->
  <path d="${pathData}" fill="none" stroke="${this.config.goldenMidColor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
  <!-- Golden Thread Core White-Gold Line -->
  <path d="${pathData}" fill="none" stroke="${this.config.goldenCoreColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="1.0" />
      `
      : ''
  }
  <!-- Tile ID Watermark -->
  <text x="8" y="${size - 8}" fill="rgba(0, 240, 255, 0.3)" font-family="monospace" font-size="9">${z}/${x}/${y}</text>
</svg>
`.trim();

    return {
      coordinate,
      svg,
      hasRouteIntersect,
      intersectedSegments,
    };
  }

  /**
   * Pre-generates and caches all synthetic fallback tiles covering the active Golden Thread route for a range of zoom levels.
   */
  public pregenerateRouteTiles(
    cacheManager: TacticalTileCacheManager,
    minZoom = 10,
    maxZoom = 14
  ): number {
    if (!this.activeRoute || this.activeRoute.waypoints.length === 0) {
      return 0;
    }

    let generatedCount = 0;
    const waypoints = this.activeRoute.waypoints;

    for (let z = minZoom; z <= maxZoom; z++) {
      const tileCoordsSet = new Set<string>();

      for (const wp of waypoints) {
        const tileCoord = TacticalTileCacheManager.lonLatToTile(wp.coordinate[0], wp.coordinate[1], z);
        const key = `${tileCoord.z}/${tileCoord.x}/${tileCoord.y}`;
        tileCoordsSet.add(key);
      }

      for (const key of tileCoordsSet) {
        const parsed = TacticalTileCacheManager.parseTileKey(key);
        if (parsed) {
          const tile = this.generateSyntheticTile(parsed);
          cacheManager.put(parsed, tile.svg, 'image/svg+xml', true, {
            syntheticRouteId: this.activeRoute.routeId,
          });
          generatedCount++;
        }
      }
    }

    return generatedCount;
  }

  private lonLatToTilePixel(lon: number, lat: number, tile: TileCoordinate, tileSize: number): [x: number, y: number] {
    const n = Math.pow(2, tile.z);
    const radLat = (lat * Math.PI) / 180;

    const globalX = ((lon + 180) / 360) * n;
    const globalY = (1 - Math.log(Math.tan(radLat) + 1 / Math.cos(radLat)) / Math.PI) / 2 * n;

    const pixelX = (globalX - tile.x) * tileSize;
    const pixelY = (globalY - tile.y) * tileSize;

    return [pixelX, pixelY];
  }
}
