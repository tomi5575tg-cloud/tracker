import { describe, it, expect } from 'vitest';
import { PoiSchemaValidator } from '../../src/poi/schemaValidator.js';
import type { PoiCategory, PoiItem } from '../../src/poi/types.js';

describe('PoiSchemaValidator', () => {
  const sampleCategory: PoiCategory = {
    id: 'custom_warehouse',
    code: 'CUST_WH',
    name: 'Magazyn Klienta',
    description: 'Niestandardowy magazyn',
    classification: 'CUSTOM',
    status: 'ACTIVE',
    style: {
      markerColor: '#9C27B0',
      iconName: 'warehouse',
      minZoom: 5,
      maxZoom: 22,
    },
    attributesSchema: [
      {
        key: 'capacity',
        label: 'Pojemność paletowa',
        type: 'NUMBER',
        required: true,
        validation: { min: 10, max: 50000 },
      },
      {
        key: 'manager_email',
        label: 'Email kierownika',
        type: 'EMAIL',
        required: true,
      },
      {
        key: 'contact_phone',
        label: 'Telefon',
        type: 'PHONE',
        validation: { pattern: '^\\+?[0-9\\s-]{7,15}$' },
      },
      {
        key: 'zone_type',
        label: 'Typ strefy',
        type: 'SELECT',
        required: true,
        validation: { options: ['COLD_STORAGE', 'DRY_STORAGE', 'HAZARDOUS'] },
      },
      {
        key: 'amenities',
        label: 'Udogodnienia',
        type: 'MULTISELECT',
        validation: { options: ['RAMP', 'FORKLIFT', 'CCTV', 'PARKING_TIR'], min: 1 },
      },
      {
        key: 'custom_pin',
        label: 'PIN bramki',
        type: 'STRING',
        sensitive: true,
      },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  describe('Category Validation', () => {
    it('should successfully validate a correct category definition', () => {
      const res = PoiSchemaValidator.validateCategory(sampleCategory);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should reject category with invalid ID or code', () => {
      const invalidCat = { ...sampleCategory, id: '', code: '   ' };
      const res = PoiSchemaValidator.validateCategory(invalidCat);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.field === 'id')).toBe(true);
      expect(res.errors.some((e) => e.field === 'code')).toBe(true);
    });

    it('should reject category with invalid color format', () => {
      const invalidCat = {
        ...sampleCategory,
        style: { ...sampleCategory.style, markerColor: 'not-a-color-123' },
      };
      const res = PoiSchemaValidator.validateCategory(invalidCat);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.field === 'style.markerColor')).toBe(true);
    });

    it('should reject category with invalid zoom range (minZoom > maxZoom)', () => {
      const invalidCat = {
        ...sampleCategory,
        style: { ...sampleCategory.style, minZoom: 18, maxZoom: 10 },
      };
      const res = PoiSchemaValidator.validateCategory(invalidCat);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.field === 'style.zoom')).toBe(true);
    });

    it('should detect duplicate attribute keys in schema', () => {
      const duplicateSchemaCat: PoiCategory = {
        ...sampleCategory,
        attributesSchema: [
          { key: 'code', label: 'Code 1', type: 'STRING' },
          { key: 'code', label: 'Code 2', type: 'NUMBER' },
        ],
      };
      const res = PoiSchemaValidator.validateCategory(duplicateSchemaCat);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.code === 'DUPLICATE_FIELD_KEY')).toBe(true);
    });
  });

  describe('POI Item Validation', () => {
    const validPoi: PoiItem = {
      id: 'poi-wh-01',
      categoryId: 'custom_warehouse',
      name: 'Magazyn Centralny Warszawa',
      coordinate: [21.0122, 52.2297], // Warsaw [lon, lat]
      status: 'ACTIVE',
      attributes: {
        capacity: 1500,
        manager_email: 'warehouse@example.com',
        contact_phone: '+48 22 123 4567',
        zone_type: 'DRY_STORAGE',
        amenities: ['RAMP', 'CCTV'],
        custom_pin: '9876',
      },
      tags: ['logistics', 'hub'],
      createdBy: 'user-operator-1',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
    };

    it('should validate valid POI against category contract', () => {
      const res = PoiSchemaValidator.validatePoi(validPoi, sampleCategory);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should reject POI with out-of-bounds RFC 7946 coordinates', () => {
      const invalidPoi: PoiItem = {
        ...validPoi,
        coordinate: [250.0, 52.0], // Lon > 180
      };
      const res = PoiSchemaValidator.validatePoi(invalidPoi, sampleCategory);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.field === 'coordinate')).toBe(true);
    });

    it('should reject POI missing required attributes', () => {
      const missingRequiredPoi: PoiItem = {
        ...validPoi,
        attributes: {
          // capacity missing
          manager_email: 'warehouse@example.com',
          zone_type: 'DRY_STORAGE',
        },
      };
      const res = PoiSchemaValidator.validatePoi(missingRequiredPoi, sampleCategory);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.code === 'REQUIRED_FIELD_MISSING')).toBe(true);
    });

    it('should reject POI with invalid attribute types or constraints', () => {
      const invalidAttrsPoi: PoiItem = {
        ...validPoi,
        attributes: {
          capacity: 5, // Below min: 10
          manager_email: 'invalid-email-address',
          zone_type: 'INVALID_ZONE_OPTION',
          amenities: ['INVALID_AMENITY'],
        },
      };
      const res = PoiSchemaValidator.validatePoi(invalidAttrsPoi, sampleCategory);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.code === 'MIN_VALUE_VIOLATION')).toBe(true);
      expect(res.errors.some((e) => e.code === 'INVALID_EMAIL')).toBe(true);
      expect(res.errors.some((e) => e.code === 'INVALID_SELECT_OPTION')).toBe(true);
      expect(res.errors.some((e) => e.code === 'INVALID_MULTISELECT_OPTION')).toBe(true);
    });

    it('should reject POI category mismatch', () => {
      const mismatchedPoi: PoiItem = {
        ...validPoi,
        categoryId: 'different_category',
      };
      const res = PoiSchemaValidator.validatePoi(mismatchedPoi, sampleCategory);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.code === 'CATEGORY_MISMATCH')).toBe(true);
    });
  });
});
