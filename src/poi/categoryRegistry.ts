import type { UserSession } from '../types.js';
import type {
  PoiCategory,
  PoiCategoryClassification,
  PoiCategoryStatus,
  UserRoleContext,
} from './types.js';
import { PoiSchemaValidator } from './schemaValidator.js';
import { PermissionsMatrixEngine } from './permissionsMatrix.js';
import { DEFAULT_SYSTEM_CATEGORIES } from './defaultCategories.js';

export interface CategoryRegistryConfig {
  readonly initialCategories?: readonly PoiCategory[] | undefined;
  readonly permissionsEngine?: PermissionsMatrixEngine | undefined;
  readonly includeDefaultSystemCategories?: boolean | undefined;
}

export class PoiCategoryRegistry {
  private readonly categories = new Map<string, PoiCategory>();
  private readonly permissionsEngine: PermissionsMatrixEngine;

  constructor(config: CategoryRegistryConfig = {}) {
    this.permissionsEngine = config.permissionsEngine ?? new PermissionsMatrixEngine();

    const includeDefaults = config.includeDefaultSystemCategories ?? true;
    if (includeDefaults) {
      for (const cat of DEFAULT_SYSTEM_CATEGORIES) {
        this.categories.set(cat.id, cat);
      }
    }

    if (config.initialCategories) {
      for (const cat of config.initialCategories) {
        const valRes = PoiSchemaValidator.validateCategory(cat);
        if (!valRes.isValid) {
          throw new Error(
            `Cannot initialize registry with invalid category "${cat.id}": ${valRes.errors.map((e) => e.message).join(', ')}`
          );
        }
        this.categories.set(cat.id, cat);
      }
    }
  }

  /**
   * Registers a new POI category with schema validation and access control check.
   */
  public registerCategory(category: PoiCategory, subject?: UserSession | UserRoleContext): PoiCategory {
    // Permission check
    if (subject) {
      this.permissionsEngine.assertCan(subject, 'CATEGORY_CREATE', {
        categoryId: category.id,
        categoryClassification: category.classification,
        categoryStatus: category.status,
        tenantId: category.tenantId,
      });

      if (category.classification === 'SYSTEM') {
        this.permissionsEngine.assertCan(subject, 'CATEGORY_MANAGE_SYSTEM', {
          categoryId: category.id,
          categoryClassification: 'SYSTEM',
        });
      }
    }

    // Schema Validation
    const validation = PoiSchemaValidator.validateCategory(category);
    if (!validation.isValid) {
      throw new Error(
        `Category validation failed for "${category.id}": ${validation.errors.map((e) => e.message).join('; ')}`
      );
    }

    // Check duplicate ID
    if (this.categories.has(category.id)) {
      throw new Error(`Category with ID "${category.id}" already exists in registry.`);
    }

    this.categories.set(category.id, Object.freeze({ ...category }));
    return this.categories.get(category.id)!;
  }

  /**
   * Updates an existing category definition with version increment and access control.
   */
  public updateCategory(
    id: string,
    updates: Partial<Omit<PoiCategory, 'id' | 'createdAt'>>,
    subject?: UserSession | UserRoleContext
  ): PoiCategory {
    const existing = this.categories.get(id);
    if (!existing) {
      throw new Error(`Category "${id}" not found in registry.`);
    }

    // Permission checks
    if (subject) {
      this.permissionsEngine.assertCan(subject, 'CATEGORY_UPDATE', {
        categoryId: existing.id,
        categoryClassification: existing.classification,
        categoryStatus: existing.status,
        tenantId: existing.tenantId,
      });

      if (updates.attributesSchema && updates.attributesSchema !== existing.attributesSchema) {
        this.permissionsEngine.assertCan(subject, 'CATEGORY_MANAGE_SCHEMA', {
          categoryId: existing.id,
          categoryClassification: existing.classification,
        });
      }
    }

    const updated: PoiCategory = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      version: existing.version + 1,
    };

    const validation = PoiSchemaValidator.validateCategory(updated);
    if (!validation.isValid) {
      throw new Error(
        `Updated category validation failed for "${id}": ${validation.errors.map((e) => e.message).join('; ')}`
      );
    }

    this.categories.set(id, Object.freeze(updated));
    return this.categories.get(id)!;
  }

  /**
   * Deletes a category from registry. System categories require CATEGORY_MANAGE_SYSTEM.
   */
  public deleteCategory(id: string, subject?: UserSession | UserRoleContext): boolean {
    const existing = this.categories.get(id);
    if (!existing) {
      return false;
    }

    if (subject) {
      this.permissionsEngine.assertCan(subject, 'CATEGORY_DELETE', {
        categoryId: existing.id,
        categoryClassification: existing.classification,
        categoryStatus: existing.status,
        tenantId: existing.tenantId,
      });
    }

    return this.categories.delete(id);
  }

  /**
   * Retrieves a single category by ID, verifying subject READ permission.
   */
  public getCategory(id: string, subject?: UserSession | UserRoleContext): PoiCategory | null {
    const category = this.categories.get(id);
    if (!category) {
      return null;
    }

    if (subject) {
      const canRead = this.permissionsEngine.can(subject, 'CATEGORY_READ', {
        categoryId: category.id,
        categoryClassification: category.classification,
        categoryStatus: category.status,
        tenantId: category.tenantId,
      });
      if (!canRead) {
        return null;
      }
    }

    return category;
  }

  /**
   * Lists categories matching optional filters and authorized for subject.
   */
  public listCategories(
    subject?: UserSession | UserRoleContext,
    filter?: {
      status?: PoiCategoryStatus | undefined;
      classification?: PoiCategoryClassification | undefined;
      tenantId?: string | undefined;
    }
  ): PoiCategory[] {
    let result = Array.from(this.categories.values());

    if (filter?.status) {
      result = result.filter((c) => c.status === filter.status);
    }
    if (filter?.classification) {
      result = result.filter((c) => c.classification === filter.classification);
    }
    if (filter?.tenantId) {
      result = result.filter((c) => !c.tenantId || c.tenantId === filter.tenantId);
    }

    if (subject) {
      result = this.permissionsEngine.filterCategories(subject, result);
    }

    return result;
  }

  /**
   * Checks if category exists in registry
   */
  public hasCategory(id: string): boolean {
    return this.categories.has(id);
  }

  /**
   * Resets registry to default system categories
   */
  public resetToDefaults(): void {
    this.categories.clear();
    for (const cat of DEFAULT_SYSTEM_CATEGORIES) {
      this.categories.set(cat.id, cat);
    }
  }

  /**
   * Get all categories as a Map for fast lookup
   */
  public getCategoryMap(): Map<string, PoiCategory> {
    return new Map(this.categories);
  }
}
