import { createEmptyFeatureCollection, isValidCoordinate } from '../geojson/types.js';
import type {
  PoiItem,
  PoiCategory,
  PoiPointFeature,
  PoiGeoJsonFeatureCollection,
  PoiGeoJsonFeatureProperties,
  UserRoleContext,
} from './types.js';
import type { UserSession } from '../types.js';
import { PermissionsMatrixEngine } from './permissionsMatrix.js';

export interface PoiToGeoJsonOptions {
  readonly categories?: readonly PoiCategory[] | Map<string, PoiCategory> | undefined;
  readonly subject?: UserSession | UserRoleContext | null | undefined;
  readonly permissionsEngine?: PermissionsMatrixEngine | undefined;
  readonly fallbackMarkerColor?: string | undefined;
  readonly fallbackIconName?: string | undefined;
}

export class PoiGeoJsonConverter {
  /**
   * Converts a single POI item into an RFC 7946 GeoJSON Point Feature.
   */
  public static toFeature(
    poi: PoiItem,
    category?: PoiCategory,
    options?: PoiToGeoJsonOptions
  ): PoiPointFeature | null {
    if (!poi || !isValidCoordinate(poi.coordinate)) {
      return null;
    }

    const engine = options?.permissionsEngine ?? new PermissionsMatrixEngine();
    const canReadSensitive = options?.subject ? engine.can(options.subject, 'POI_READ_SENSITIVE') : true;

    let attributes = poi.attributes ?? {};
    let hasSensitiveDataMasked = false;

    if (!canReadSensitive && category?.attributesSchema) {
      const sensitiveKeys = new Set(
        category.attributesSchema.filter((f) => f.sensitive === true).map((f) => f.key)
      );
      if (sensitiveKeys.size > 0) {
        const masked: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(attributes)) {
          if (sensitiveKeys.has(k)) {
            masked[k] = '[CONFIDENTIAL / MASKED]';
            hasSensitiveDataMasked = true;
          } else {
            masked[k] = v;
          }
        }
        attributes = masked;
      }
    }

    const markerColor = category?.style?.markerColor ?? options?.fallbackMarkerColor ?? '#3F51B5';
    const iconName = category?.style?.iconName ?? options?.fallbackIconName ?? 'marker';

    const properties: PoiGeoJsonFeatureProperties = {
      poiId: poi.id,
      categoryId: poi.categoryId,
      categoryCode: category?.code ?? 'CUSTOM',
      categoryName: category?.name ?? poi.categoryId,
      name: poi.name,
      ...(poi.description ? { description: poi.description } : {}),
      status: poi.status,
      markerColor,
      iconName,
      ...(category?.style?.iconSize !== undefined ? { iconSize: category.style.iconSize } : {}),
      ...(category?.style?.minZoom !== undefined ? { minZoom: category.style.minZoom } : {}),
      ...(category?.style?.maxZoom !== undefined ? { maxZoom: category.style.maxZoom } : {}),
      ...(category?.style?.zIndex !== undefined ? { zIndex: category.style.zIndex } : {}),
      ...(poi.address?.formattedAddress ? { addressFormatted: poi.address.formattedAddress } : {}),
      tags: poi.tags ?? [],
      ...(poi.tenantId ? { tenantId: poi.tenantId } : {}),
      attributes,
      hasSensitiveDataMasked,
      ...(poi.metadata ? { ...poi.metadata } : {}),
    };

    return {
      type: 'Feature',
      id: poi.id,
      geometry: {
        type: 'Point',
        coordinates: [poi.coordinate[0], poi.coordinate[1]],
      },
      properties,
    };
  }

  /**
   * Converts a list of POI items into an RFC 7946 FeatureCollection.
   */
  public static toFeatureCollection(
    pois: readonly PoiItem[],
    options: PoiToGeoJsonOptions = {}
  ): PoiGeoJsonFeatureCollection {
    if (!pois || pois.length === 0) {
      return this.emptyGeoJson();
    }

    let categoryMap: Map<string, PoiCategory>;
    if (options.categories instanceof Map) {
      categoryMap = options.categories;
    } else if (Array.isArray(options.categories)) {
      categoryMap = new Map(options.categories.map((c) => [c.id, c]));
    } else {
      categoryMap = new Map();
    }

    const features: PoiPointFeature[] = [];

    for (const poi of pois) {
      const category = categoryMap.get(poi.categoryId);
      const feature = this.toFeature(poi, category, options);
      if (feature) {
        features.push(feature);
      }
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  /**
   * Returns a compliant, empty RFC 7946 FeatureCollection for POI layers
   */
  public static emptyGeoJson(): PoiGeoJsonFeatureCollection {
    return createEmptyFeatureCollection<PoiPointFeature['geometry'], PoiGeoJsonFeatureProperties>();
  }
}
