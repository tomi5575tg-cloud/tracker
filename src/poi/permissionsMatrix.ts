import type { UserSession } from '../types.js';
import type {
  PoiPermissionAction,
  PoiCategoryPermissionAction,
  PoiItemPermissionAction,
  UserRole,
  UserRoleContext,
  PermissionsMatrixConfig,
  RolePermissionsConfig,
  CategoryPermissionOverride,
  PoiAccessContext,
  PoiAccessEvaluationResult,
  PoiCategory,
  PoiItem,
  PoiFieldDefinition,
} from './types.js';

export class SecurityAccessDeniedError extends Error {
  public readonly action: PoiPermissionAction;
  public readonly reason: string;
  public readonly userId?: string | undefined;
  public readonly roles: readonly UserRole[];
  public readonly context?: PoiAccessContext | undefined;

  constructor(
    action: PoiPermissionAction,
    reason: string,
    roles: readonly UserRole[] = [],
    userId?: string,
    context?: PoiAccessContext
  ) {
    super(`Access Denied for action "${action}": ${reason}`);
    this.name = 'SecurityAccessDeniedError';
    this.action = action;
    this.reason = reason;
    this.roles = roles;
    this.userId = userId;
    this.context = context;
  }
}

/**
 * All available Category Actions
 */
export const ALL_CATEGORY_PERMISSIONS: readonly PoiCategoryPermissionAction[] = [
  'CATEGORY_CREATE',
  'CATEGORY_READ',
  'CATEGORY_UPDATE',
  'CATEGORY_DELETE',
  'CATEGORY_TOGGLE_ACTIVE',
  'CATEGORY_MANAGE_SCHEMA',
  'CATEGORY_MANAGE_SYSTEM',
];

/**
 * All available POI Item Actions
 */
export const ALL_POI_ITEM_PERMISSIONS: readonly PoiItemPermissionAction[] = [
  'POI_CREATE',
  'POI_READ',
  'POI_READ_SENSITIVE',
  'POI_UPDATE',
  'POI_DELETE',
  'POI_EXPORT',
  'POI_IMPORT',
  'POI_AUDIT',
  'POI_SHARE',
];

export const ALL_PERMISSIONS: readonly PoiPermissionAction[] = [
  ...ALL_CATEGORY_PERMISSIONS,
  ...ALL_POI_ITEM_PERMISSIONS,
];

/**
 * Canonical Default Permissions Matrix for Tracker
 */
export const DEFAULT_PERMISSIONS_MATRIX: PermissionsMatrixConfig = {
  roleHierarchy: {
    ADMIN: ['MANAGER', 'DISPATCHER', 'AUDITOR'],
    MANAGER: ['DISPATCHER', 'OPERATOR'],
    DISPATCHER: ['OPERATOR'],
    OPERATOR: ['DRIVER', 'VIEWER'],
    DRIVER: ['VIEWER'],
    AUDITOR: ['VIEWER'],
    VIEWER: ['GUEST'],
    GUEST: [],
  },
  rolePermissions: {
    ADMIN: {
      defaultPermissions: ALL_PERMISSIONS,
    },
    MANAGER: {
      defaultPermissions: [
        'CATEGORY_CREATE',
        'CATEGORY_READ',
        'CATEGORY_UPDATE',
        'CATEGORY_TOGGLE_ACTIVE',
        'CATEGORY_MANAGE_SCHEMA',
        'POI_CREATE',
        'POI_READ',
        'POI_READ_SENSITIVE',
        'POI_UPDATE',
        'POI_DELETE',
        'POI_EXPORT',
        'POI_IMPORT',
        'POI_SHARE',
      ],
    },
    DISPATCHER: {
      defaultPermissions: [
        'CATEGORY_CREATE',
        'CATEGORY_READ',
        'CATEGORY_UPDATE',
        'CATEGORY_TOGGLE_ACTIVE',
        'CATEGORY_MANAGE_SCHEMA',
        'POI_CREATE',
        'POI_READ',
        'POI_READ_SENSITIVE',
        'POI_UPDATE',
        'POI_DELETE',
        'POI_EXPORT',
        'POI_IMPORT',
        'POI_SHARE',
      ],
    },
    OPERATOR: {
      defaultPermissions: [
        'CATEGORY_READ',
        'POI_CREATE',
        'POI_READ',
        'POI_UPDATE',
        'POI_EXPORT',
        'POI_SHARE',
      ],
    },
    DRIVER: {
      defaultPermissions: [
        'CATEGORY_READ',
        'POI_CREATE',
        'POI_READ',
        'POI_UPDATE',
      ],
    },
    AUDITOR: {
      defaultPermissions: [
        'CATEGORY_READ',
        'POI_READ',
        'POI_READ_SENSITIVE',
        'POI_EXPORT',
        'POI_AUDIT',
      ],
    },
    VIEWER: {
      defaultPermissions: [
        'CATEGORY_READ',
        'POI_READ',
      ],
    },
    GUEST: {
      defaultPermissions: [
        'CATEGORY_READ',
        'POI_READ',
      ],
    },
  },
};

export class PermissionsMatrixEngine {
  private readonly config: PermissionsMatrixConfig;

  constructor(config: PermissionsMatrixConfig = DEFAULT_PERMISSIONS_MATRIX) {
    this.config = config;
  }

  /**
   * Evaluates whether the given user session or role context is allowed to perform the action.
   */
  public evaluate(
    subject: UserSession | UserRoleContext | null | undefined,
    action: PoiPermissionAction,
    context?: PoiAccessContext
  ): PoiAccessEvaluationResult {
    const roles = this.extractRoles(subject);
    const directPermissions = this.extractDirectPermissions(subject);

    if (!subject) {
      return {
        allowed: false,
        reason: 'Unauthenticated: No user session or context provided',
        effectiveRoles: [],
        action,
        missingPermissions: [action],
      };
    }

    // Check Multi-Tenancy Isolation
    if (context?.tenantId && subject.tenantId && subject.tenantId !== context.tenantId && !roles.includes('ADMIN')) {
      return {
        allowed: false,
        reason: `Tenant isolation violation: User tenant (${subject.tenantId}) does not match resource tenant (${context.tenantId})`,
        effectiveRoles: roles,
        action,
        missingPermissions: [action],
      };
    }

    // SYSTEM category security constraint: Only users with CATEGORY_MANAGE_SYSTEM can modify or delete SYSTEM categories
    if (
      context?.categoryClassification === 'SYSTEM' &&
      ['CATEGORY_UPDATE', 'CATEGORY_DELETE', 'CATEGORY_MANAGE_SCHEMA', 'CATEGORY_TOGGLE_ACTIVE'].includes(action)
    ) {
      const hasSystemManage = directPermissions.has('CATEGORY_MANAGE_SYSTEM') || this.rolesHavePermission(roles, 'CATEGORY_MANAGE_SYSTEM', context?.categoryId);
      if (!hasSystemManage) {
        return {
          allowed: false,
          reason: 'System Category Protection: Modifying or deleting SYSTEM categories requires CATEGORY_MANAGE_SYSTEM permission',
          effectiveRoles: roles,
          action,
          missingPermissions: ['CATEGORY_MANAGE_SYSTEM'],
        };
      }
    }

    // Status constraints: INACTIVE / ARCHIVED categories
    if (context?.categoryStatus === 'ARCHIVED' && action === 'POI_CREATE') {
      return {
        allowed: false,
        reason: 'Category is ARCHIVED. Creating new POIs in archived categories is disallowed.',
        effectiveRoles: roles,
        action,
        missingPermissions: [action],
      };
    }

    // Direct explicit permission check
    if (directPermissions.has(action)) {
      return {
        allowed: true,
        effectiveRoles: roles,
        action,
      };
    }

    // Evaluated against Role Matrix (including hierarchy & overrides)
    const allowedByRoles = this.rolesHavePermission(roles, action, context?.categoryId);
    if (allowedByRoles) {
      return {
        allowed: true,
        effectiveRoles: roles,
        action,
      };
    }

    return {
      allowed: false,
      reason: `User roles [${roles.join(', ')}] lack required permission "${action}"`,
      effectiveRoles: roles,
      action,
      missingPermissions: [action],
    };
  }

  /**
   * Returns true if subject can execute action, false otherwise.
   */
  public can(
    subject: UserSession | UserRoleContext | null | undefined,
    action: PoiPermissionAction,
    context?: PoiAccessContext
  ): boolean {
    return this.evaluate(subject, action, context).allowed;
  }

  /**
   * Asserts permission or throws SecurityAccessDeniedError.
   */
  public assertCan(
    subject: UserSession | UserRoleContext | null | undefined,
    action: PoiPermissionAction,
    context?: PoiAccessContext
  ): void {
    const res = this.evaluate(subject, action, context);
    if (!res.allowed) {
      throw new SecurityAccessDeniedError(
        action,
        res.reason ?? 'Access denied by permissions matrix',
        res.effectiveRoles,
        subject?.userId,
        context
      );
    }
  }

  /**
   * Retrieves all effective permissions for a given subject and optional category context.
   */
  public getEffectivePermissions(
    subject: UserSession | UserRoleContext | null | undefined,
    context?: PoiAccessContext
  ): Set<PoiPermissionAction> {
    const effective = new Set<PoiPermissionAction>();
    if (!subject) {
      return effective;
    }

    // Add direct permissions
    for (const perm of this.extractDirectPermissions(subject)) {
      effective.add(perm);
    }

    // Expand roles via hierarchy
    const allRoles = this.expandRoles(this.extractRoles(subject));

    for (const role of allRoles) {
      const roleConfig = (this.config.rolePermissions as Record<string, RolePermissionsConfig | readonly PoiPermissionAction[] | undefined>)[role];
      if (!roleConfig) continue;

      let perms: readonly PoiPermissionAction[] = [];
      let overrides: Readonly<Record<string, CategoryPermissionOverride>> | undefined;

      if (Array.isArray(roleConfig)) {
        perms = roleConfig;
      } else {
        perms = (roleConfig as RolePermissionsConfig).defaultPermissions ?? [];
        overrides = (roleConfig as RolePermissionsConfig).categoryOverrides;
      }

      for (const p of perms) {
        effective.add(p);
      }

      // Apply category overrides if applicable
      if (context?.categoryId && overrides) {
        const override = overrides[context.categoryId];
        if (override) {
          if (override.allowedActions) {
            for (const a of override.allowedActions) {
              effective.add(a);
            }
          }
          if (override.deniedActions) {
            for (const d of override.deniedActions) {
              effective.delete(d);
            }
          }
        }
      }
    }

    return effective;
  }

  /**
   * Filters a list of categories to only those readable by the subject.
   */
  public filterCategories<T extends PoiCategory>(
    subject: UserSession | UserRoleContext | null | undefined,
    categories: readonly T[]
  ): T[] {
    return categories.filter((cat) => {
      return this.can(subject, 'CATEGORY_READ', {
        categoryId: cat.id,
        categoryClassification: cat.classification,
        categoryStatus: cat.status,
        tenantId: cat.tenantId,
      });
    });
  }

  /**
   * Filters and sanitizes a list of POIs according to subject permissions.
   * If subject lacks POI_READ_SENSITIVE, sensitive fields are stripped/masked.
   */
  public filterPois<T extends PoiItem>(
    subject: UserSession | UserRoleContext | null | undefined,
    pois: readonly T[],
    categoryLookup?: Map<string, PoiCategory>
  ): T[] {
    const canReadSensitive = this.can(subject, 'POI_READ_SENSITIVE');

    return pois
      .filter((poi) => {
        const category = categoryLookup?.get(poi.categoryId);
        return this.can(subject, 'POI_READ', {
          categoryId: poi.categoryId,
          categoryClassification: category?.classification,
          categoryStatus: category?.status,
          poiOwnerId: poi.createdBy,
          poiStatus: poi.status,
          tenantId: poi.tenantId,
        });
      })
      .map((poi) => {
        if (canReadSensitive) {
          return poi;
        }
        const category = categoryLookup?.get(poi.categoryId);
        return this.sanitizePoi(poi, category) as T;
      });
  }

  /**
   * Strips or masks sensitive attributes from a POI item if the category schema defines sensitive fields.
   */
  public sanitizePoi<T extends PoiItem>(poi: T, category?: PoiCategory): T {
    if (!category || !category.attributesSchema || category.attributesSchema.length === 0) {
      return poi;
    }

    const sensitiveKeys = new Set(
      category.attributesSchema.filter((field) => field.sensitive === true).map((field) => field.key)
    );

    if (sensitiveKeys.size === 0) {
      return poi;
    }

    const sanitizedAttrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(poi.attributes)) {
      if (sensitiveKeys.has(k)) {
        sanitizedAttrs[k] = '[CONFIDENTIAL / MASKED]';
      } else {
        sanitizedAttrs[k] = v;
      }
    }

    return {
      ...poi,
      attributes: sanitizedAttrs,
    };
  }

  /**
   * Helper to mask sensitive fields directly on attributes object
   */
  public maskSensitiveAttributes(
    attributes: Readonly<Record<string, unknown>>,
    schema: readonly PoiFieldDefinition[]
  ): Record<string, unknown> {
    const sensitiveKeys = new Set(
      schema.filter((field) => field.sensitive === true).map((field) => field.key)
    );

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(attributes)) {
      if (sensitiveKeys.has(key)) {
        result[key] = '[CONFIDENTIAL / MASKED]';
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  private rolesHavePermission(roles: readonly UserRole[], action: PoiPermissionAction, categoryId?: string): boolean {
    const expanded = this.expandRoles(roles);

    for (const role of expanded) {
      const roleConfig = (this.config.rolePermissions as Record<string, RolePermissionsConfig | readonly PoiPermissionAction[] | undefined>)[role];
      if (!roleConfig) continue;

      if (Array.isArray(roleConfig)) {
        if (roleConfig.includes(action)) return true;
      } else {
        const rConfig = roleConfig as RolePermissionsConfig;
        if (categoryId && rConfig.categoryOverrides && rConfig.categoryOverrides[categoryId]) {
          const override = rConfig.categoryOverrides[categoryId];
          if (override?.deniedActions?.includes(action)) {
            continue;
          }
          if (override?.allowedActions?.includes(action)) {
            return true;
          }
        }
        if (rConfig.defaultPermissions.includes(action)) {
          return true;
        }
      }
    }

    return false;
  }

  private expandRoles(roles: readonly UserRole[]): readonly UserRole[] {
    const expanded = new Set<UserRole>();
    const hierarchy = (this.config.roleHierarchy ?? {}) as Record<string, readonly UserRole[] | undefined>;

    const traverse = (role: UserRole) => {
      if (expanded.has(role)) return;
      expanded.add(role);
      const inherited = hierarchy[role];
      if (Array.isArray(inherited)) {
        for (const childRole of inherited) {
          traverse(childRole);
        }
      }
    };

    for (const r of roles) {
      traverse(r);
    }

    return Array.from(expanded);
  }

  private extractRoles(subject: UserSession | UserRoleContext | null | undefined): readonly UserRole[] {
    if (!subject) return [];
    if (subject.roles && Array.isArray(subject.roles) && subject.roles.length > 0) {
      return subject.roles;
    }
    if (subject.role) {
      return [subject.role];
    }
    // Fallback: Check metadata
    if (subject.metadata && typeof subject.metadata === 'object' && 'role' in subject.metadata) {
      const metaRole = (subject.metadata as Record<string, unknown>)['role'];
      if (typeof metaRole === 'string') return [metaRole];
    }
    return ['VIEWER']; // Default baseline role
  }

  private extractDirectPermissions(subject: UserSession | UserRoleContext | null | undefined): Set<PoiPermissionAction> {
    const set = new Set<PoiPermissionAction>();
    if (!subject || !subject.permissions || !Array.isArray(subject.permissions)) {
      return set;
    }
    for (const p of subject.permissions) {
      set.add(p);
    }
    return set;
  }
}
