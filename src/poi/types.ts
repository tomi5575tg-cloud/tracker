import type { Position, PointGeometry, Feature, FeatureCollection } from '../geojson/types.js';

/**
 * Standard User Roles in Tracker System
 */
export type StandardUserRole =
  | 'ADMIN'
  | 'DISPATCHER'
  | 'MANAGER'
  | 'OPERATOR'
  | 'DRIVER'
  | 'VIEWER'
  | 'GUEST'
  | 'AUDITOR';

export type UserRole = StandardUserRole | (string & {});

/**
 * Granular POI & Category Permissions
 */
export type PoiCategoryPermissionAction =
  | 'CATEGORY_CREATE'
  | 'CATEGORY_READ'
  | 'CATEGORY_UPDATE'
  | 'CATEGORY_DELETE'
  | 'CATEGORY_TOGGLE_ACTIVE'
  | 'CATEGORY_MANAGE_SCHEMA'
  | 'CATEGORY_MANAGE_SYSTEM';

export type PoiItemPermissionAction =
  | 'POI_CREATE'
  | 'POI_READ'
  | 'POI_READ_SENSITIVE'
  | 'POI_UPDATE'
  | 'POI_DELETE'
  | 'POI_EXPORT'
  | 'POI_IMPORT'
  | 'POI_AUDIT'
  | 'POI_SHARE';

export type PoiPermissionAction = PoiCategoryPermissionAction | PoiItemPermissionAction;

/**
 * User Context for Role and Permission Evaluation
 */
export interface UserRoleContext {
  readonly userId: string;
  readonly username?: string | undefined;
  readonly role?: UserRole | undefined;
  readonly roles?: readonly UserRole[] | undefined;
  readonly permissions?: readonly PoiPermissionAction[] | undefined;
  readonly tenantId?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * POI Category Classification & Status
 */
export type PoiCategoryClassification = 'SYSTEM' | 'CUSTOM';
export type PoiCategoryStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/**
 * Attribute Schema & Data Types
 */
export type PoiAttributeType =
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'SELECT'
  | 'MULTISELECT'
  | 'EMAIL'
  | 'PHONE'
  | 'URL'
  | 'JSON'
  | 'COLOR';

export interface PoiAttributeOption {
  readonly value: string | number;
  readonly label: string;
  readonly description?: string | undefined;
  readonly color?: string | undefined;
}

export interface PoiAttributeValidationRule {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly pattern?: string | undefined;
  readonly options?: readonly (string | number | PoiAttributeOption)[] | undefined;
  readonly customValidator?: ((value: unknown) => boolean | string) | undefined;
}

export interface PoiFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: PoiAttributeType;
  readonly required?: boolean | undefined;
  readonly sensitive?: boolean | undefined;
  readonly description?: string | undefined;
  readonly defaultValue?: unknown;
  readonly validation?: PoiAttributeValidationRule | undefined;
  readonly unit?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly order?: number | undefined;
}

/**
 * Visual Style and Map Rendering Contract
 */
export interface PoiCategoryStyle {
  readonly markerColor: string;
  readonly iconName: string;
  readonly iconUrl?: string | undefined;
  readonly iconSize?: number | undefined;
  readonly badgeColor?: string | undefined;
  readonly borderColor?: string | undefined;
  readonly minZoom?: number | undefined;
  readonly maxZoom?: number | undefined;
  readonly zIndex?: number | undefined;
  readonly clusterable?: boolean | undefined;
  readonly pulseAnimation?: boolean | undefined;
}

/**
 * POI Category Domain Model
 */
export interface PoiCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly classification: PoiCategoryClassification;
  readonly status: PoiCategoryStatus;
  readonly parentId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly style: PoiCategoryStyle;
  readonly attributesSchema: readonly PoiFieldDefinition[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly version: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * POI Item Domain Model
 */
export type PoiStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT' | 'ARCHIVED';

export interface PoiAddress {
  readonly street?: string | undefined;
  readonly buildingNumber?: string | undefined;
  readonly city?: string | undefined;
  readonly postalCode?: string | undefined;
  readonly state?: string | undefined;
  readonly country?: string | undefined;
  readonly formattedAddress?: string | undefined;
}

export interface PoiItem {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly coordinate: Position;
  readonly address?: PoiAddress | undefined;
  readonly status: PoiStatus;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly tags?: readonly string[] | undefined;
  readonly tenantId?: string | undefined;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly version: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * RFC 7946 GeoJSON Feature Properties for POI
 */
export interface PoiGeoJsonFeatureProperties {
  readonly poiId: string;
  readonly categoryId: string;
  readonly categoryCode: string;
  readonly categoryName: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly status: PoiStatus;
  readonly markerColor: string;
  readonly iconName: string;
  readonly iconSize?: number | undefined;
  readonly minZoom?: number | undefined;
  readonly maxZoom?: number | undefined;
  readonly zIndex?: number | undefined;
  readonly addressFormatted?: string | undefined;
  readonly tags: readonly string[];
  readonly tenantId?: string | undefined;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly hasSensitiveDataMasked?: boolean | undefined;
  [key: string]: unknown;
}

export type PoiPointFeature = Feature<PointGeometry, PoiGeoJsonFeatureProperties>;
export type PoiGeoJsonFeatureCollection = FeatureCollection<PointGeometry, PoiGeoJsonFeatureProperties>;

/**
 * Permissions Matrix Configuration & Evaluation
 */
export interface CategoryPermissionOverride {
  readonly allowedActions?: readonly PoiPermissionAction[] | undefined;
  readonly deniedActions?: readonly PoiPermissionAction[] | undefined;
}

export interface RolePermissionsConfig {
  readonly defaultPermissions: readonly PoiPermissionAction[];
  readonly categoryOverrides?: Readonly<Record<string, CategoryPermissionOverride>> | undefined;
}

export interface PermissionsMatrixConfig {
  readonly rolePermissions: Readonly<Record<UserRole, RolePermissionsConfig | readonly PoiPermissionAction[]>>;
  readonly roleHierarchy?: Readonly<Record<UserRole, readonly UserRole[]>> | undefined;
}

export interface PoiAccessContext {
  readonly categoryId?: string | undefined;
  readonly categoryClassification?: PoiCategoryClassification | undefined;
  readonly tenantId?: string | undefined;
  readonly poiOwnerId?: string | undefined;
  readonly poiStatus?: PoiStatus | undefined;
  readonly categoryStatus?: PoiCategoryStatus | undefined;
}

export interface PoiAccessEvaluationResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
  readonly missingPermissions?: readonly PoiPermissionAction[] | undefined;
  readonly effectiveRoles: readonly UserRole[];
  readonly action: PoiPermissionAction;
}

/**
 * Validation Result Models
 */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
  readonly code: string;
  readonly receivedValue?: unknown;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly ValidationError[];
}
