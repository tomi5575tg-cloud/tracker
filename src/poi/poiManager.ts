import type { UserSession } from '../types.js';
import type {
  PoiItem,
  PoiStatus,
  UserRoleContext,
  PoiGeoJsonFeatureCollection,
} from './types.js';
import { PoiCategoryRegistry } from './categoryRegistry.js';
import { PoiSchemaValidator } from './schemaValidator.js';
import { PermissionsMatrixEngine } from './permissionsMatrix.js';
import { PoiGeoJsonConverter } from './converter.js';
import type { SessionDrainHook } from '../auth/drainManager.js';
import type { AuthLockBooth } from '../auth/authBooth.js';

export interface PoiManagerConfig {
  readonly categoryRegistry?: PoiCategoryRegistry | undefined;
  readonly permissionsEngine?: PermissionsMatrixEngine | undefined;
  readonly authBooth?: AuthLockBooth | undefined;
  readonly onPoiDrained?: ((reason: string, previousSession: unknown) => void) | undefined;
}

export class PoiManager implements SessionDrainHook {
  private readonly items = new Map<string, PoiItem>();
  private readonly categoryRegistry: PoiCategoryRegistry;
  private readonly permissionsEngine: PermissionsMatrixEngine;
  private readonly authBooth: AuthLockBooth | undefined;
  private readonly onPoiDrained: ((reason: string, previousSession: unknown) => void) | undefined;
  private unregisterDrainHook: (() => void) | undefined;

  constructor(config: PoiManagerConfig = {}) {
    this.categoryRegistry = config.categoryRegistry ?? new PoiCategoryRegistry();
    this.permissionsEngine = config.permissionsEngine ?? new PermissionsMatrixEngine();
    this.authBooth = config.authBooth;
    this.onPoiDrained = config.onPoiDrained;

    if (this.authBooth) {
      this.unregisterDrainHook = this.authBooth.registerDrainHook(this);
    }
  }

  public getCategoryRegistry(): PoiCategoryRegistry {
    return this.categoryRegistry;
  }

  public getPermissionsEngine(): PermissionsMatrixEngine {
    return this.permissionsEngine;
  }

  /**
   * SessionDrainHook implementation:
   * When session is drained or switched in AuthLockBooth, clear memory cache.
   */
  public drain(reason: string, previousSession: unknown): void {
    this.clear();
    this.onPoiDrained?.(reason, previousSession);
  }

  /**
   * Creates a new POI item with full category contract validation and permission checks.
   */
  public createPoi(
    poiData: Omit<PoiItem, 'createdAt' | 'updatedAt' | 'version'> & {
      createdAt?: number;
      updatedAt?: number;
      version?: number;
    },
    subject?: UserSession | UserRoleContext
  ): PoiItem {
    const effectiveSubject = subject ?? this.authBooth?.getSession();

    // Check if category exists
    const category = this.categoryRegistry.getCategory(poiData.categoryId, effectiveSubject ?? undefined);
    if (!category) {
      throw new Error(
        `Cannot create POI: Category "${poiData.categoryId}" does not exist or user lacks read permission.`
      );
    }

    // Permission check
    if (effectiveSubject) {
      this.permissionsEngine.assertCan(effectiveSubject, 'POI_CREATE', {
        categoryId: category.id,
        categoryClassification: category.classification,
        categoryStatus: category.status,
        tenantId: poiData.tenantId ?? category.tenantId,
      });
    }

    const now = Date.now();
    const poi: PoiItem = {
      id: poiData.id,
      categoryId: poiData.categoryId,
      name: poiData.name,
      ...(poiData.description ? { description: poiData.description } : {}),
      coordinate: poiData.coordinate,
      ...(poiData.address ? { address: poiData.address } : {}),
      status: poiData.status,
      attributes: poiData.attributes ?? {},
      tags: poiData.tags ?? [],
      ...(poiData.tenantId ? { tenantId: poiData.tenantId } : {}),
      createdBy: poiData.createdBy ?? effectiveSubject?.userId ?? 'system',
      createdAt: poiData.createdAt ?? now,
      updatedAt: poiData.updatedAt ?? now,
      version: poiData.version ?? 1,
      ...(poiData.metadata ? { metadata: poiData.metadata } : {}),
    };

    // Validate against category schema
    const validation = PoiSchemaValidator.validatePoi(poi, category);
    if (!validation.isValid) {
      throw new Error(
        `POI validation failed for "${poi.id}": ${validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`
      );
    }

    if (this.items.has(poi.id)) {
      throw new Error(`POI with ID "${poi.id}" already exists.`);
    }

    this.items.set(poi.id, Object.freeze(poi));
    return this.items.get(poi.id)!;
  }

  /**
   * Updates an existing POI item with schema re-validation and access checks.
   */
  public updatePoi(
    id: string,
    updates: Partial<Omit<PoiItem, 'id' | 'createdAt'>>,
    subject?: UserSession | UserRoleContext
  ): PoiItem {
    const existing = this.items.get(id);
    if (!existing) {
      throw new Error(`POI "${id}" not found.`);
    }

    const effectiveSubject = subject ?? this.authBooth?.getSession();
    const categoryId = updates.categoryId ?? existing.categoryId;
    const category = this.categoryRegistry.getCategory(categoryId, effectiveSubject ?? undefined);
    if (!category) {
      throw new Error(`Category "${categoryId}" not found.`);
    }

    if (effectiveSubject) {
      this.permissionsEngine.assertCan(effectiveSubject, 'POI_UPDATE', {
        categoryId: category.id,
        categoryClassification: category.classification,
        categoryStatus: category.status,
        poiOwnerId: existing.createdBy,
        poiStatus: existing.status,
        tenantId: existing.tenantId,
      });
    }

    const updated: PoiItem = {
      ...existing,
      ...updates,
      id: existing.id,
      categoryId,
      attributes: updates.attributes ? { ...existing.attributes, ...updates.attributes } : existing.attributes,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      version: existing.version + 1,
    };

    const validation = PoiSchemaValidator.validatePoi(updated, category);
    if (!validation.isValid) {
      throw new Error(
        `POI update validation failed for "${id}": ${validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`
      );
    }

    this.items.set(id, Object.freeze(updated));
    return this.items.get(id)!;
  }

  /**
   * Deletes a POI item.
   */
  public deletePoi(id: string, subject?: UserSession | UserRoleContext): boolean {
    const existing = this.items.get(id);
    if (!existing) {
      return false;
    }

    const effectiveSubject = subject ?? this.authBooth?.getSession();
    const category = this.categoryRegistry.getCategory(existing.categoryId, effectiveSubject ?? undefined);

    if (effectiveSubject) {
      this.permissionsEngine.assertCan(effectiveSubject, 'POI_DELETE', {
        categoryId: existing.categoryId,
        categoryClassification: category?.classification,
        categoryStatus: category?.status,
        poiOwnerId: existing.createdBy,
        poiStatus: existing.status,
        tenantId: existing.tenantId,
      });
    }

    return this.items.delete(id);
  }

  /**
   * Retrieves a single POI by ID with permission checks and sensitive data masking.
   */
  public getPoi(id: string, subject?: UserSession | UserRoleContext): PoiItem | null {
    const poi = this.items.get(id);
    if (!poi) {
      return null;
    }

    const effectiveSubject = subject ?? this.authBooth?.getSession();
    const category = this.categoryRegistry.getCategory(poi.categoryId, effectiveSubject ?? undefined);

    if (effectiveSubject) {
      const canRead = this.permissionsEngine.can(effectiveSubject, 'POI_READ', {
        categoryId: poi.categoryId,
        categoryClassification: category?.classification,
        categoryStatus: category?.status,
        poiOwnerId: poi.createdBy,
        poiStatus: poi.status,
        tenantId: poi.tenantId,
      });
      if (!canRead) {
        return null;
      }
    }

    const canReadSensitive = effectiveSubject ? this.permissionsEngine.can(effectiveSubject, 'POI_READ_SENSITIVE') : true;
    if (!canReadSensitive) {
      return this.permissionsEngine.sanitizePoi(poi, category ?? undefined);
    }

    return poi;
  }

  /**
   * Lists POIs matching optional filters, filtered by user permissions and sanitized.
   */
  public listPois(
    subject?: UserSession | UserRoleContext,
    filter?: {
      categoryId?: string | undefined;
      status?: PoiStatus | undefined;
      tenantId?: string | undefined;
      tags?: readonly string[] | undefined;
    }
  ): PoiItem[] {
    const effectiveSubject = subject ?? this.authBooth?.getSession();
    let result = Array.from(this.items.values());

    if (filter?.categoryId) {
      result = result.filter((p) => p.categoryId === filter.categoryId);
    }
    if (filter?.status) {
      result = result.filter((p) => p.status === filter.status);
    }
    if (filter?.tenantId) {
      result = result.filter((p) => !p.tenantId || p.tenantId === filter.tenantId);
    }
    if (filter?.tags && filter.tags.length > 0) {
      const tagSet = new Set(filter.tags);
      result = result.filter((p) => p.tags && p.tags.some((t) => tagSet.has(t)));
    }

    const categoryMap = this.categoryRegistry.getCategoryMap();
    return this.permissionsEngine.filterPois(effectiveSubject, result, categoryMap);
  }

  /**
   * Exports POIs as an RFC 7946 FeatureCollection, customized for the user's permissions.
   */
  public toGeoJson(
    subject?: UserSession | UserRoleContext,
    filter?: {
      categoryId?: string | undefined;
      status?: PoiStatus | undefined;
      tenantId?: string | undefined;
      tags?: readonly string[] | undefined;
    }
  ): PoiGeoJsonFeatureCollection {
    const effectiveSubject = subject ?? this.authBooth?.getSession();
    const pois = this.listPois(effectiveSubject ?? undefined, filter);
    const categoryMap = this.categoryRegistry.getCategoryMap();

    return PoiGeoJsonConverter.toFeatureCollection(pois, {
      categories: categoryMap,
      subject: effectiveSubject,
      permissionsEngine: this.permissionsEngine,
    });
  }

  /**
   * Clears all in-memory POI data
   */
  public clear(): void {
    this.items.clear();
  }

  /**
   * Destroys the manager and unregisters hooks
   */
  public destroy(): void {
    this.clear();
    if (this.unregisterDrainHook) {
      this.unregisterDrainHook();
      this.unregisterDrainHook = undefined;
    }
  }
}
