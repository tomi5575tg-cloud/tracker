import type { FeatureCollection } from './types.js';

export class GeoJsonValidator {
  /**
   * Validates if an object conforms strictly to RFC 7946 FeatureCollection requirements
   */
  public static isRFC7946FeatureCollection(obj: unknown): obj is FeatureCollection {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    const candidate = obj as Record<string, unknown>;
    if (candidate['type'] !== 'FeatureCollection') {
      return false;
    }
    if (!Array.isArray(candidate['features'])) {
      return false;
    }

    for (const feature of candidate['features']) {
      if (!this.isValidFeature(feature)) {
        return false;
      }
    }

    return true;
  }

  public static isValidFeature(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    const feature = obj as Record<string, unknown>;
    if (feature['type'] !== 'Feature') {
      return false;
    }
    if (!('properties' in feature) || typeof feature['properties'] !== 'object') {
      return false;
    }
    if (!('geometry' in feature)) {
      return false;
    }
    if (feature['geometry'] !== null && typeof feature['geometry'] !== 'object') {
      return false;
    }
    if (feature['geometry'] !== null) {
      const geom = feature['geometry'] as Record<string, unknown>;
      if (typeof geom['type'] !== 'string') {
        return false;
      }
      if (!('coordinates' in geom) && !('geometries' in geom)) {
        return false;
      }
    }
    return true;
  }
}
