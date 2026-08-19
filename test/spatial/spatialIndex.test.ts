import { describe, it, expect } from 'vitest';
import { SpatialPoiIndex } from '../../src/spatial/spatialIndex.js';
import { DEFAULT_SYSTEM_CATEGORIES } from '../../src/poi/defaultCategories.js';
import type { PoiItem, PoiCategory } from '../../src/poi/types.js';
import type { UserSession } from '../../src/types.js';

describe('SpatialPoiIndex (In-Memory Spatial Index & Filter Engine)', () => {
  const categoryMap = new Map<string, PoiCategory>(
    DEFAULT_SYSTEM_CATEGORIES.map((c) => [c.id, c])
  );

  // Warsaw center: [21.0122, 52.2297]
  const poiWarsawCenter: PoiItem = {
    id: 'poi-waw-center',
    categoryId: 'fuel_station',
    name: 'Stacja Warszawa Centrum',
    coordinate: [21.0122, 52.2297],
    status: 'ACTIVE',
    attributes: { brand: 'Orlen', fuel_types: ['DIESEL', 'PB95'], gate_code: 'SECRET_PIN' },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  // Warsaw outskirts (Okęcie): ~8km from center [20.9671, 52.1672]
  const poiWarsawOkecie: PoiItem = {
    id: 'poi-waw-okecie',
    categoryId: 'warehouse_logistics',
    name: 'Magazyn Okęcie Cargo',
    coordinate: [20.9671, 52.1672],
    status: 'ACTIVE',
    attributes: { facility_name: 'Cargo Hub', ramp_count: 12 },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  // Radom: ~95km South of Warsaw [21.1471, 51.4027]
  const poiRadom: PoiItem = {
    id: 'poi-radom',
    categoryId: 'fuel_station',
    name: 'Stacja Radom Południe',
    coordinate: [21.1471, 51.4027],
    status: 'ACTIVE',
    attributes: { brand: 'Shell', fuel_types: ['DIESEL'] },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  // Krakow: ~252km South of Warsaw [19.9449, 50.0647]
  const poiKrakow: PoiItem = {
    id: 'poi-krakow',
    categoryId: 'customer_site',
    name: 'Klient Kraków Rynek',
    coordinate: [19.9449, 50.0647],
    status: 'ACTIVE',
    attributes: { client_code: 'KRAK-01', contact_phone: '+48 12 000 0000' },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  const allPois: PoiItem[] = [poiWarsawCenter, poiWarsawOkecie, poiRadom, poiKrakow];

  const adminSession: UserSession = {
    sessionId: 'sess-admin',
    userId: 'admin-1',
    username: 'admin',
    token: 'token-admin',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'ADMIN',
  };

  const driverSession: UserSession = {
    sessionId: 'sess-driver',
    userId: 'driver-1',
    username: 'driver',
    token: 'token-driver',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'DRIVER',
  };

  it('should search POIs within a BBox filter', () => {
    const index = new SpatialPoiIndex({ items: allPois, categoryLookup: categoryMap });

    // BBox encompassing Warsaw area only
    const result = index.searchBBox([20.8, 52.0, 21.3, 52.4], { subject: adminSession });

    expect(result.totalMatches).toBe(2);
    const ids = result.items.map((p) => p.id);
    expect(ids).toContain('poi-waw-center');
    expect(ids).toContain('poi-waw-okecie');
    expect(ids).not.toContain('poi-radom');
    expect(ids).not.toContain('poi-krakow');

    // Verify GeoJSON FeatureCollection generated
    expect(result.featureCollection.type).toBe('FeatureCollection');
    expect(result.featureCollection.features).toHaveLength(2);
  });

  it('should search POIs within a Radius filter sorted by distance', () => {
    const index = new SpatialPoiIndex({ items: allPois, categoryLookup: categoryMap });

    // Radius 10km around Warsaw Center
    const result10km = index.searchRadius([21.0122, 52.2297], 10000, { subject: adminSession });
    expect(result10km.totalMatches).toBe(2);
    expect(result10km.items[0]!.id).toBe('poi-waw-center'); // Distance 0m
    expect(result10km.items[1]!.id).toBe('poi-waw-okecie'); // Distance ~8km

    // Radius 120km around Warsaw Center (includes Radom)
    const result120km = index.searchRadius([21.0122, 52.2297], 120000, { subject: adminSession });
    expect(result120km.totalMatches).toBe(3);
    expect(result120km.items.map((p) => p.id)).toContain('poi-radom');
    expect(result120km.items.map((p) => p.id)).not.toContain('poi-krakow');
  });

  it('should search POIs along a Route Corridor', () => {
    const index = new SpatialPoiIndex({ items: allPois, categoryLookup: categoryMap });

    // Route from Warsaw to Radom (along S7 road)
    const routeCoordinates = [
      [21.0122, 52.2297], // Warsaw
      [20.9671, 52.1672], // Okęcie
      [21.1471, 51.4027], // Radom
    ];

    // Search within 5km of route
    const corridorResult = index.searchCorridor(routeCoordinates, 5000, { subject: adminSession });
    expect(corridorResult.totalMatches).toBe(3);
    const ids = corridorResult.items.map((p) => p.id);
    expect(ids).toContain('poi-waw-center');
    expect(ids).toContain('poi-waw-okecie');
    expect(ids).toContain('poi-radom');
    expect(ids).not.toContain('poi-krakow');
  });

  it('should filter by Category ID and sanitize sensitive attributes for driver role', () => {
    const index = new SpatialPoiIndex({ items: allPois, categoryLookup: categoryMap });

    const result = index.searchRadius([21.0122, 52.2297], 20000, {
      categoryIds: ['fuel_station'],
      subject: driverSession,
    });

    expect(result.totalMatches).toBe(1);
    expect(result.items[0]!.id).toBe('poi-waw-center');

    // Sensitive field masked for driver
    expect(result.items[0]!.attributes['gate_code']).toBe('[CONFIDENTIAL / MASKED]');
  });
});
