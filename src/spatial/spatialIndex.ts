import type { Position, FeatureCollection } from '../geojson/types.js';
import type { PoiItem, PoiCategory } from '../poi/types.js';
import { PoiGeoJsonConverter } from '../poi/converter.js';
import { PermissionsMatrixEngine } from '../poi/permissionsMatrix.js';
import type {
  BoundingBoxInput,
  SpatialQueryCriteria,
  SpatialMatchResult,
  SpatialSearchResult,
  SpatialExecutionOptions,
} from './types.js';
import { GeoSpatialUtils } from './geoUtils.js';
import { SpatialQueryGenerator } from './queryGenerator.js';

export class SpatialPoiIndex {
  private readonly items = new Map<string, PoiItem>();
  private readonly permissionsEngine: PermissionsMatrixEngine;
  private readonly categoryLookup?: Map<string, PoiCategory> | undefined;

  constructor(options: {
    items?: readonly PoiItem[] | undefined;
    permissionsEngine?: PermissionsMatrixEngine | undefined;
    categoryLookup?: Map<string, PoiCategory> | undefined;
  } = {}) {
    this.permissionsEngine = options.permissionsEngine ?? new PermissionsMatrixEngine();
    this.categoryLookup = options.categoryLookup;

    if (options.items) {
      for (const it of options.items) {
        this.items.set(it.id, it);
      }
    }
  }

  public insert(item: PoiItem): void {
    this.items.set(item.id, item);
  }

  public remove(id: string): boolean {
    return this.items.delete(id);
  }

  public clear(): void {
    this.items.clear();
  }

  public size(): number {
    return this.items.size;
  }

  /**
   * Search POIs within a Bounding Box.
   */
  public searchBBox(
    bboxInput: BoundingBoxInput,
    options: SpatialExecutionOptions = {}
  ): SpatialSearchResult<PoiItem> {
    const generated = SpatialQueryGenerator.fromBBox(bboxInput, {
      categoryIds: options.categoryIds,
      statuses: options.statuses,
      tenantId: options.tenantId,
      tags: options.tags,
      limit: options.limit,
      offset: options.offset,
      sortByDistance: options.sortByDistance,
    });

    return this.executeSpatialQuery(generated.criteria, options);
  }

  /**
   * Search POIs within a circular Radius (meters) from a center coordinate.
   */
  public searchRadius(
    center: Position,
    radiusMeters: number,
    options: SpatialExecutionOptions = {}
  ): SpatialSearchResult<PoiItem> {
    const generated = SpatialQueryGenerator.fromRadius(center, radiusMeters, {
      categoryIds: options.categoryIds,
      statuses: options.statuses,
      tenantId: options.tenantId,
      tags: options.tags,
      limit: options.limit,
      offset: options.offset,
      sortByDistance: options.sortByDistance,
    });

    return this.executeSpatialQuery(generated.criteria, options);
  }

  /**
   * Search POIs along a Route Corridor / Buffer (meters).
   */
  public searchCorridor(
    coordinates: readonly Position[],
    bufferMeters: number,
    options: SpatialExecutionOptions = {}
  ): SpatialSearchResult<PoiItem> {
    const generated = SpatialQueryGenerator.fromCorridor(coordinates, bufferMeters, {
      categoryIds: options.categoryIds,
      statuses: options.statuses,
      tenantId: options.tenantId,
      tags: options.tags,
      limit: options.limit,
      offset: options.offset,
      sortByDistance: options.sortByDistance,
    });

    return this.executeSpatialQuery(generated.criteria, options);
  }

  /**
   * Executes a spatial search with filtering, RBAC sanitization, and sorting.
   */
  public executeSpatialQuery(
    criteria: SpatialQueryCriteria,
    options: SpatialExecutionOptions = {}
  ): SpatialSearchResult<PoiItem> {
    const allItems = Array.from(this.items.values());

    // 1. Filter by Permissions and Role Matrix
    const subject = options.subject;
    const authorizedItems = this.permissionsEngine.filterPois(subject, allItems, this.categoryLookup);

    // 2. Spatial & Attribute Matching
    const matches: SpatialMatchResult<PoiItem>[] = [];

    for (const item of authorizedItems) {
      if (!this.matchesAttributeFilters(item, criteria, options)) {
        continue;
      }

      const spatialEvaluation = this.evaluateSpatialMatch(item.coordinate, criteria);
      if (spatialEvaluation.inside) {
        matches.push({
          item,
          distanceMeters: spatialEvaluation.distanceMeters,
          inside: true,
        });
      }
    }

    // 3. Sorting (by distance if specified or radius search)
    if (criteria.sortByDistance || criteria.type === 'RADIUS') {
      matches.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    // 4. Pagination (offset & limit)
    const offset = criteria.offset ?? options.offset ?? 0;
    const limit = criteria.limit ?? options.limit ?? matches.length;

    const pagedMatches = matches.slice(offset, offset + limit);
    const resultItems = pagedMatches.map((m) => m.item);

    // 5. Convert to GeoJSON FeatureCollection
    const featureCollection = PoiGeoJsonConverter.toFeatureCollection(resultItems, {
      categories: this.categoryLookup,
      subject,
      permissionsEngine: this.permissionsEngine,
    }) as FeatureCollection;

    return {
      items: resultItems,
      totalMatches: matches.length,
      query: criteria,
      featureCollection,
    };
  }

  private evaluateSpatialMatch(
    point: Position,
    criteria: SpatialQueryCriteria
  ): { inside: boolean; distanceMeters: number } {
    switch (criteria.type) {
      case 'BBOX': {
        if (!criteria.bbox) return { inside: false, distanceMeters: Infinity };
        const inside = GeoSpatialUtils.isPointInBBox(point, criteria.bbox);
        const center: Position = [
          (criteria.bbox[0] + criteria.bbox[2]) / 2,
          (criteria.bbox[1] + criteria.bbox[3]) / 2,
        ];
        const dist = GeoSpatialUtils.haversineDistance(point, center);
        return { inside, distanceMeters: dist };
      }

      case 'RADIUS': {
        if (!criteria.radius) return { inside: false, distanceMeters: Infinity };
        const dist = GeoSpatialUtils.haversineDistance(point, criteria.radius.center);
        return {
          inside: dist <= criteria.radius.radiusMeters,
          distanceMeters: dist,
        };
      }

      case 'CORRIDOR': {
        if (!criteria.corridor) return { inside: false, distanceMeters: Infinity };
        const dist = GeoSpatialUtils.distanceToPolyline(point, criteria.corridor.coordinates);
        return {
          inside: dist <= criteria.corridor.bufferMeters,
          distanceMeters: dist,
        };
      }

      case 'POLYGON': {
        if (!criteria.polygon || criteria.polygon.coordinates.length === 0) {
          return { inside: false, distanceMeters: Infinity };
        }
        const outerRing = criteria.polygon.coordinates[0];
        if (!outerRing) return { inside: false, distanceMeters: Infinity };

        const inside = GeoSpatialUtils.isPointInPolygon(point, outerRing);
        return { inside, distanceMeters: 0 };
      }

      default:
        return { inside: false, distanceMeters: Infinity };
    }
  }

  private matchesAttributeFilters(
    item: PoiItem,
    criteria: SpatialQueryCriteria,
    options: SpatialExecutionOptions
  ): boolean {
    const categoryIds = criteria.categoryIds ?? options.categoryIds;
    if (categoryIds && categoryIds.length > 0 && !categoryIds.includes(item.categoryId)) {
      return false;
    }

    const statuses = criteria.statuses ?? options.statuses;
    if (statuses && statuses.length > 0 && !statuses.includes(item.status)) {
      return false;
    }

    const tenantId = criteria.tenantId ?? options.tenantId;
    if (tenantId && item.tenantId && item.tenantId !== tenantId) {
      return false;
    }

    const tags = criteria.tags ?? options.tags;
    if (tags && tags.length > 0) {
      if (!item.tags || !tags.some((t) => item.tags?.includes(t))) {
        return false;
      }
    }

    return true;
  }
}
