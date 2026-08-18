import { isValidCoordinate } from '../geojson/types.js';
import type {
  PoiCategory,
  PoiFieldDefinition,
  PoiItem,
  ValidationResult,
  ValidationError,
  PoiAttributeType,
} from './types.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s\-()./]{6,25}$/;
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class PoiSchemaValidator {
  /**
   * Validates a POI Category definition for structural and schema integrity.
   */
  public static validateCategory(category: PoiCategory): ValidationResult {
    const errors: ValidationError[] = [];

    if (!category) {
      return {
        isValid: false,
        errors: [{ field: 'category', message: 'Category object is required', code: 'CATEGORY_REQUIRED' }],
      };
    }

    if (!category.id || typeof category.id !== 'string' || category.id.trim() === '') {
      errors.push({ field: 'id', message: 'Category ID is required and must be a non-empty string', code: 'INVALID_ID' });
    }

    if (!category.code || typeof category.code !== 'string' || category.code.trim() === '') {
      errors.push({ field: 'code', message: 'Category code is required and must be a non-empty string', code: 'INVALID_CODE' });
    }

    if (!category.name || typeof category.name !== 'string' || category.name.trim() === '') {
      errors.push({ field: 'name', message: 'Category name is required and must be a non-empty string', code: 'INVALID_NAME' });
    }

    if (category.classification !== 'SYSTEM' && category.classification !== 'CUSTOM') {
      errors.push({
        field: 'classification',
        message: 'Classification must be either SYSTEM or CUSTOM',
        code: 'INVALID_CLASSIFICATION',
        receivedValue: category.classification,
      });
    }

    if (!['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(category.status)) {
      errors.push({
        field: 'status',
        message: 'Status must be ACTIVE, INACTIVE, or ARCHIVED',
        code: 'INVALID_STATUS',
        receivedValue: category.status,
      });
    }

    // Validate visual style
    if (!category.style || typeof category.style !== 'object') {
      errors.push({ field: 'style', message: 'Category style is required', code: 'STYLE_REQUIRED' });
    } else {
      if (!category.style.markerColor || typeof category.style.markerColor !== 'string' || !this.isValidColor(category.style.markerColor)) {
        errors.push({
          field: 'style.markerColor',
          message: 'markerColor must be a valid color string (e.g. #FF5722 or rgba)',
          code: 'INVALID_MARKER_COLOR',
          receivedValue: category.style.markerColor,
        });
      }

      if (!category.style.iconName || typeof category.style.iconName !== 'string' || category.style.iconName.trim() === '') {
        errors.push({
          field: 'style.iconName',
          message: 'iconName is required and must be a non-empty string',
          code: 'INVALID_ICON_NAME',
          receivedValue: category.style.iconName,
        });
      }

      if (category.style.minZoom !== undefined && category.style.maxZoom !== undefined) {
        if (
          typeof category.style.minZoom !== 'number' ||
          typeof category.style.maxZoom !== 'number' ||
          category.style.minZoom < 0 ||
          category.style.maxZoom > 24 ||
          category.style.minZoom > category.style.maxZoom
        ) {
          errors.push({
            field: 'style.zoom',
            message: 'Zoom range must satisfy 0 <= minZoom <= maxZoom <= 24',
            code: 'INVALID_ZOOM_RANGE',
          });
        }
      }
    }

    // Validate attributes schema
    if (!Array.isArray(category.attributesSchema)) {
      errors.push({
        field: 'attributesSchema',
        message: 'attributesSchema must be an array of field definitions',
        code: 'INVALID_ATTRIBUTES_SCHEMA',
      });
    } else {
      const fieldKeys = new Set<string>();
      category.attributesSchema.forEach((field, index) => {
        const fieldErrors = this.validateFieldDefinition(field, index);
        errors.push(...fieldErrors);

        if (field && typeof field.key === 'string') {
          if (fieldKeys.has(field.key)) {
            errors.push({
              field: `attributesSchema[${index}].key`,
              message: `Duplicate field key: "${field.key}"`,
              code: 'DUPLICATE_FIELD_KEY',
              receivedValue: field.key,
            });
          }
          fieldKeys.add(field.key);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates a single field definition within a category schema.
   */
  public static validateFieldDefinition(field: PoiFieldDefinition, index: number): ValidationError[] {
    const errors: ValidationError[] = [];
    const prefix = `attributesSchema[${index}]`;

    if (!field || typeof field !== 'object') {
      errors.push({ field: prefix, message: 'Field definition must be an object', code: 'INVALID_FIELD' });
      return errors;
    }

    if (!field.key || typeof field.key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(field.key)) {
      errors.push({
        field: `${prefix}.key`,
        message: 'Field key is required and must contain only alphanumeric characters, dashes, or underscores',
        code: 'INVALID_FIELD_KEY',
        receivedValue: field.key,
      });
    }

    if (!field.label || typeof field.label !== 'string' || field.label.trim() === '') {
      errors.push({
        field: `${prefix}.label`,
        message: 'Field label is required and must be a non-empty string',
        code: 'INVALID_FIELD_LABEL',
      });
    }

    const validTypes: PoiAttributeType[] = [
      'STRING',
      'NUMBER',
      'BOOLEAN',
      'DATE',
      'DATETIME',
      'SELECT',
      'MULTISELECT',
      'EMAIL',
      'PHONE',
      'URL',
      'JSON',
      'COLOR',
    ];

    if (!field.type || !validTypes.includes(field.type)) {
      errors.push({
        field: `${prefix}.type`,
        message: `Field type must be one of: ${validTypes.join(', ')}`,
        code: 'INVALID_FIELD_TYPE',
        receivedValue: field.type,
      });
    }

    if (field.type === 'SELECT' || field.type === 'MULTISELECT') {
      const options = field.validation?.options;
      if (!Array.isArray(options) || options.length === 0) {
        errors.push({
          field: `${prefix}.validation.options`,
          message: `${field.type} requires a non-empty options array in validation rules`,
          code: 'OPTIONS_REQUIRED',
        });
      }
    }

    if (field.validation?.pattern) {
      try {
        new RegExp(field.validation.pattern);
      } catch {
        errors.push({
          field: `${prefix}.validation.pattern`,
          message: 'Invalid regular expression pattern',
          code: 'INVALID_REGEX_PATTERN',
          receivedValue: field.validation.pattern,
        });
      }
    }

    if (field.validation?.min !== undefined && field.validation?.max !== undefined) {
      if (field.validation.min > field.validation.max) {
        errors.push({
          field: `${prefix}.validation.range`,
          message: 'Validation min must be less than or equal to max',
          code: 'INVALID_MIN_MAX_RANGE',
        });
      }
    }

    return errors;
  }

  /**
   * Validates a POI item instance against its category contract.
   */
  public static validatePoi(poi: PoiItem, category?: PoiCategory): ValidationResult {
    const errors: ValidationError[] = [];

    if (!poi || typeof poi !== 'object') {
      return {
        isValid: false,
        errors: [{ field: 'poi', message: 'POI item is required', code: 'POI_REQUIRED' }],
      };
    }

    if (!poi.id || typeof poi.id !== 'string' || poi.id.trim() === '') {
      errors.push({ field: 'id', message: 'POI ID is required and must be a non-empty string', code: 'INVALID_POI_ID' });
    }

    if (!poi.categoryId || typeof poi.categoryId !== 'string' || poi.categoryId.trim() === '') {
      errors.push({ field: 'categoryId', message: 'POI categoryId is required', code: 'INVALID_CATEGORY_ID' });
    }

    if (!poi.name || typeof poi.name !== 'string' || poi.name.trim() === '') {
      errors.push({ field: 'name', message: 'POI name is required and must be a non-empty string', code: 'INVALID_NAME' });
    }

    // RFC 7946 WGS84 coordinates validation
    if (!isValidCoordinate(poi.coordinate)) {
      errors.push({
        field: 'coordinate',
        message: 'Invalid coordinate. Must be [longitude, latitude] conforming to RFC 7946 WGS84 (-180..180, -90..90)',
        code: 'INVALID_COORDINATE',
        receivedValue: poi.coordinate,
      });
    }

    if (!['ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED'].includes(poi.status)) {
      errors.push({
        field: 'status',
        message: 'POI status must be ACTIVE, INACTIVE, DRAFT, or ARCHIVED',
        code: 'INVALID_STATUS',
        receivedValue: poi.status,
      });
    }

    if (!poi.createdBy || typeof poi.createdBy !== 'string' || poi.createdBy.trim() === '') {
      errors.push({ field: 'createdBy', message: 'POI createdBy is required', code: 'INVALID_CREATED_BY' });
    }

    if (!poi.attributes || typeof poi.attributes !== 'object') {
      errors.push({ field: 'attributes', message: 'POI attributes must be an object', code: 'INVALID_ATTRIBUTES' });
    }

    // Validate attributes against Category Schema contract if category is provided
    if (category) {
      if (category.id !== poi.categoryId) {
        errors.push({
          field: 'categoryId',
          message: `POI categoryId ("${poi.categoryId}") does not match provided Category ID ("${category.id}")`,
          code: 'CATEGORY_MISMATCH',
        });
      }

      if (category.status === 'ARCHIVED' && poi.status === 'ACTIVE') {
        errors.push({
          field: 'status',
          message: 'Cannot create or activate POI in an ARCHIVED category',
          code: 'CATEGORY_ARCHIVED',
        });
      }

      if (category.attributesSchema && poi.attributes) {
        for (const field of category.attributesSchema) {
          const value = poi.attributes[field.key];
          const attrErrors = this.validateAttributeValue(value, field);
          errors.push(...attrErrors);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates a single attribute value against a field schema definition.
   */
  public static validateAttributeValue(value: unknown, field: PoiFieldDefinition): ValidationError[] {
    const errors: ValidationError[] = [];
    const isPresent = value !== undefined && value !== null && value !== '';

    if (field.required && !isPresent) {
      errors.push({
        field: `attributes.${field.key}`,
        message: `Field "${field.label}" (${field.key}) is required`,
        code: 'REQUIRED_FIELD_MISSING',
      });
      return errors;
    }

    if (!isPresent) {
      return errors;
    }

    switch (field.type) {
      case 'STRING': {
        if (typeof value !== 'string') {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a string`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
          break;
        }
        if (field.validation?.min !== undefined && value.length < field.validation.min) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" length (${value.length}) must be at least ${field.validation.min}`,
            code: 'MIN_LENGTH_VIOLATION',
          });
        }
        if (field.validation?.max !== undefined && value.length > field.validation.max) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" length (${value.length}) exceeds maximum of ${field.validation.max}`,
            code: 'MAX_LENGTH_VIOLATION',
          });
        }
        if (field.validation?.pattern) {
          const regex = new RegExp(field.validation.pattern);
          if (!regex.test(value)) {
            errors.push({
              field: `attributes.${field.key}`,
              message: `Field "${field.label}" does not match the required pattern`,
              code: 'PATTERN_MISMATCH',
              receivedValue: value,
            });
          }
        }
        break;
      }

      case 'NUMBER': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a finite number`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
          break;
        }
        if (field.validation?.min !== undefined && value < field.validation.min) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" value (${value}) must be >= ${field.validation.min}`,
            code: 'MIN_VALUE_VIOLATION',
          });
        }
        if (field.validation?.max !== undefined && value > field.validation.max) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" value (${value}) must be <= ${field.validation.max}`,
            code: 'MAX_VALUE_VIOLATION',
          });
        }
        break;
      }

      case 'BOOLEAN': {
        if (typeof value !== 'boolean') {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a boolean`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
        }
        break;
      }

      case 'DATE': {
        if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
          const d = new Date(value);
          if (isNaN(d.getTime())) {
            errors.push({
              field: `attributes.${field.key}`,
              message: `Field "${field.label}" must be a valid ISO date (YYYY-MM-DD)`,
              code: 'INVALID_DATE',
              receivedValue: value,
            });
          }
        } else if (value instanceof Date) {
          if (isNaN(value.getTime())) {
            errors.push({
              field: `attributes.${field.key}`,
              message: `Field "${field.label}" must be a valid Date`,
              code: 'INVALID_DATE',
            });
          }
        } else {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a date string (YYYY-MM-DD)`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
        }
        break;
      }

      case 'DATETIME': {
        if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
          const d = new Date(value);
          if (isNaN(d.getTime())) {
            errors.push({
              field: `attributes.${field.key}`,
              message: `Field "${field.label}" must be a valid ISO datetime or timestamp`,
              code: 'INVALID_DATETIME',
              receivedValue: value,
            });
          }
        } else {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a datetime string, timestamp, or Date`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
        }
        break;
      }

      case 'SELECT': {
        const rawOptions = field.validation?.options ?? [];
        const validValues = rawOptions.map((opt) => (typeof opt === 'object' && opt !== null ? opt.value : opt));
        if (!validValues.includes(value as string | number)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" value is not among permitted options: [${validValues.join(', ')}]`,
            code: 'INVALID_SELECT_OPTION',
            receivedValue: value,
          });
        }
        break;
      }

      case 'MULTISELECT': {
        if (!Array.isArray(value)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be an array of selected options`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
          break;
        }
        const rawOptions = field.validation?.options ?? [];
        const validValues = new Set(rawOptions.map((opt) => (typeof opt === 'object' && opt !== null ? opt.value : opt)));
        for (const item of value) {
          if (!validValues.has(item)) {
            errors.push({
              field: `attributes.${field.key}`,
              message: `Field "${field.label}" contains invalid option: "${String(item)}"`,
              code: 'INVALID_MULTISELECT_OPTION',
              receivedValue: item,
            });
          }
        }
        if (field.validation?.min !== undefined && value.length < field.validation.min) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must have at least ${field.validation.min} selections`,
            code: 'MIN_SELECTIONS_VIOLATION',
          });
        }
        if (field.validation?.max !== undefined && value.length > field.validation.max) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" can have at most ${field.validation.max} selections`,
            code: 'MAX_SELECTIONS_VIOLATION',
          });
        }
        break;
      }

      case 'EMAIL': {
        if (typeof value !== 'string' || !EMAIL_REGEX.test(value)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a valid email address`,
            code: 'INVALID_EMAIL',
            receivedValue: value,
          });
        }
        break;
      }

      case 'PHONE': {
        if (typeof value !== 'string' || !PHONE_REGEX.test(value)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a valid phone number`,
            code: 'INVALID_PHONE',
            receivedValue: value,
          });
        }
        break;
      }

      case 'URL': {
        if (typeof value !== 'string' || !this.isValidUrl(value)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a valid URL`,
            code: 'INVALID_URL',
            receivedValue: value,
          });
        }
        break;
      }

      case 'COLOR': {
        if (typeof value !== 'string' || !this.isValidColor(value)) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be a valid color string`,
            code: 'INVALID_COLOR',
            receivedValue: value,
          });
        }
        break;
      }

      case 'JSON': {
        if (typeof value !== 'object' || value === null) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" must be an object or array`,
            code: 'TYPE_MISMATCH',
            receivedValue: value,
          });
        }
        break;
      }
    }

    // Evaluate custom validator if provided
    if (field.validation?.customValidator) {
      try {
        const customRes = field.validation.customValidator(value);
        if (customRes === false) {
          errors.push({
            field: `attributes.${field.key}`,
            message: `Field "${field.label}" failed custom validation`,
            code: 'CUSTOM_VALIDATION_FAILED',
            receivedValue: value,
          });
        } else if (typeof customRes === 'string') {
          errors.push({
            field: `attributes.${field.key}`,
            message: customRes,
            code: 'CUSTOM_VALIDATION_FAILED',
            receivedValue: value,
          });
        }
      } catch (err) {
        errors.push({
          field: `attributes.${field.key}`,
          message: `Field "${field.label}" custom validator error: ${err instanceof Error ? err.message : String(err)}`,
          code: 'CUSTOM_VALIDATION_ERROR',
        });
      }
    }

    return errors;
  }

  public static isValidColor(colorStr: string): boolean {
    if (!colorStr || typeof colorStr !== 'string') return false;
    if (HEX_COLOR_REGEX.test(colorStr)) return true;
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/i.test(colorStr)) return true;
    if (/^hsla?\(\s*\d+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)$/i.test(colorStr)) return true;
    const standardColors = ['transparent', 'currentColor', 'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'gray', 'grey'];
    return standardColors.includes(colorStr.toLowerCase());
  }

  public static isValidUrl(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
