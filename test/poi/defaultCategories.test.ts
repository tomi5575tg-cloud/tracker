import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SYSTEM_CATEGORIES,
  FUEL_STATION_CATEGORY,
  WAREHOUSE_LOGISTICS_CATEGORY,
  CUSTOMER_SITE_CATEGORY,
  REST_AREA_TRUCK_STOP_CATEGORY,
  SERVICE_WORKSHOP_CATEGORY,
  HAZARD_DANGER_ZONE_CATEGORY,
  CHECKPOINT_TOLL_CATEGORY,
} from '../../src/poi/defaultCategories.js';
import { PoiSchemaValidator } from '../../src/poi/schemaValidator.js';

describe('Default System POI Categories Contract', () => {
  it('should define exactly 7 standard system categories with SYSTEM classification and ACTIVE status', () => {
    expect(DEFAULT_SYSTEM_CATEGORIES).toHaveLength(7);

    for (const cat of DEFAULT_SYSTEM_CATEGORIES) {
      expect(cat.classification).toBe('SYSTEM');
      expect(cat.status).toBe('ACTIVE');
      expect(cat.id).toBeDefined();
      expect(cat.code).toBeDefined();
      expect(cat.name).toBeDefined();
      expect(cat.style.markerColor).toBeDefined();
      expect(cat.style.iconName).toBeDefined();
      expect(Array.isArray(cat.attributesSchema)).toBe(true);
      expect(cat.attributesSchema.length).toBeGreaterThan(0);
    }
  });

  it('all default system categories should strictly pass PoiSchemaValidator', () => {
    for (const category of DEFAULT_SYSTEM_CATEGORIES) {
      const res = PoiSchemaValidator.validateCategory(category);
      expect(res.isValid, `Category "${category.id}" failed validation: ${res.errors.map((e) => e.message).join(', ')}`).toBe(true);
      expect(res.errors).toHaveLength(0);
    }
  });

  it('should verify specific schema properties for Fuel Station category', () => {
    expect(FUEL_STATION_CATEGORY.id).toBe('fuel_station');
    expect(FUEL_STATION_CATEGORY.code).toBe('FUEL');
    const brandField = FUEL_STATION_CATEGORY.attributesSchema.find((f) => f.key === 'brand');
    expect(brandField).toBeDefined();
    expect(brandField?.required).toBe(true);

    const sensitivePin = FUEL_STATION_CATEGORY.attributesSchema.find((f) => f.key === 'gate_code');
    expect(sensitivePin?.sensitive).toBe(true);
  });

  it('should verify Warehouse, Customer, Rest Area, Service, Hazard, and Toll categories exist', () => {
    const ids = DEFAULT_SYSTEM_CATEGORIES.map((c) => c.id);
    expect(ids).toContain(WAREHOUSE_LOGISTICS_CATEGORY.id);
    expect(ids).toContain(CUSTOMER_SITE_CATEGORY.id);
    expect(ids).toContain(REST_AREA_TRUCK_STOP_CATEGORY.id);
    expect(ids).toContain(SERVICE_WORKSHOP_CATEGORY.id);
    expect(ids).toContain(HAZARD_DANGER_ZONE_CATEGORY.id);
    expect(ids).toContain(CHECKPOINT_TOLL_CATEGORY.id);
  });
});
