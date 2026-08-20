import { describe, it, expect } from 'vitest';
import { PoiCategoryRegistry } from '../../src/poi/categoryRegistry.js';
import type { PoiCategory } from '../../src/poi/types.js';
import type { UserSession } from '../../src/types.js';

describe('PoiCategoryRegistry', () => {
  const adminSession: UserSession = {
    sessionId: 'sess-admin',
    userId: 'admin-1',
    username: 'admin',
    token: 'token-admin',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'ADMIN',
  };

  const dispatcherSession: UserSession = {
    sessionId: 'sess-disp',
    userId: 'disp-1',
    username: 'dispatcher',
    token: 'token-disp',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'DISPATCHER',
  };

  const driverSession: UserSession = {
    sessionId: 'sess-drv',
    userId: 'drv-1',
    username: 'driver',
    token: 'token-drv',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'DRIVER',
  };

  it('should initialize with default system categories', () => {
    const registry = new PoiCategoryRegistry();
    expect(registry.hasCategory('fuel_station')).toBe(true);
    expect(registry.hasCategory('warehouse_logistics')).toBe(true);
    expect(registry.listCategories()).toHaveLength(7);
  });

  it('should register a valid custom category by authorized dispatcher', () => {
    const registry = new PoiCategoryRegistry();
    const newCategory: PoiCategory = {
      id: 'custom_crossdock',
      code: 'XDOCK',
      name: 'Cross-Dock Terminal',
      classification: 'CUSTOM',
      status: 'ACTIVE',
      style: { markerColor: '#FF9800', iconName: 'crossdock' },
      attributesSchema: [
        { key: 'terminal_gates', label: 'Liczba bram', type: 'NUMBER', required: true },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
    };

    const registered = registry.registerCategory(newCategory, dispatcherSession);
    expect(registered.id).toBe('custom_crossdock');
    expect(registry.hasCategory('custom_crossdock')).toBe(true);
  });

  it('should reject category registration by unauthorized driver role', () => {
    const registry = new PoiCategoryRegistry();
    const newCategory: PoiCategory = {
      id: 'driver_forbidden_cat',
      code: 'FORBID',
      name: 'Forbidden',
      classification: 'CUSTOM',
      status: 'ACTIVE',
      style: { markerColor: '#FF0000', iconName: 'ban' },
      attributesSchema: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
    };

    expect(() => registry.registerCategory(newCategory, driverSession)).toThrow();
  });

  it('should prevent modifying SYSTEM categories by non-admin roles', () => {
    const registry = new PoiCategoryRegistry();
    expect(() =>
      registry.updateCategory('fuel_station', { name: 'New Name' }, dispatcherSession)
    ).toThrow();

    // Admin can update
    const updated = registry.updateCategory('fuel_station', { name: 'Stacja Paliw i EV' }, adminSession);
    expect(updated.name).toBe('Stacja Paliw i EV');
    expect(updated.version).toBe(2);
  });

  it('should support filtering categories by status and classification', () => {
    const registry = new PoiCategoryRegistry();
    const systemCats = registry.listCategories(adminSession, { classification: 'SYSTEM' });
    expect(systemCats.length).toBe(7);

    const customCats = registry.listCategories(adminSession, { classification: 'CUSTOM' });
    expect(customCats.length).toBe(0);
  });
});
