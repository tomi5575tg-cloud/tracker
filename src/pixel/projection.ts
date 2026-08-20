import type { Position } from '../geojson/types.js';
import { isValidCoordinate } from '../geojson/types.js';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Web-Mercator projection of WGS84 lon/lat onto a screen centered on `center`.
 * Shared by Canvas 2D, SVG, and the pixel audit buffer so all three surfaces
 * paint the same vehicle coordinate — no separate "magic" mapping.
 */
export function projectLonLatToScreen(
  coord: Position,
  center: Position,
  zoom: number,
  screenWidth: number,
  screenHeight: number
): ScreenPoint {
  if (!isValidCoordinate(coord) || !isValidCoordinate(center)) {
    throw new Error('projectLonLatToScreen: coordinate is not a valid RFC 7946 WGS84 position');
  }

  const scale = Math.pow(2, zoom) * 128;
  const [lon, lat] = coord;
  const [cLon, cLat] = center;

  const radLat = (lat * Math.PI) / 180;
  const radCLat = (cLat * Math.PI) / 180;

  const x = ((lon - cLon) * Math.PI) / 180;
  const y =
    Math.log(Math.tan(Math.PI / 4 + radLat / 2)) -
    Math.log(Math.tan(Math.PI / 4 + radCLat / 2));

  return {
    x: screenWidth / 2 + x * scale,
    y: screenHeight / 2 - y * scale,
  };
}
