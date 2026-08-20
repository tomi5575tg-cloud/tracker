import { describe, it, expect } from 'vitest';
import { PoiManager } from '../../src/poi/poiManager.js';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';

describe('PoiManager Spatial Queries Integration', () => {
  it('should support searchBBox, searchRadius, and searchCorridor on PoiManager with booth session context', async () => {
    const authBooth = new AuthLockBooth({
      storage: new InMemoryStorageProvider(),
    });

    const poiManager = new PoiManager({ authBooth });

    // Enter as Dispatcher
    await authBooth.enterBooth({
      sessionId: 'sess-disp-1',
      userId: 'user-disp',
      username: 'disp_pl',
      token: 'tok-1',
      role: 'DISPATCHER',
    });

    // Populate POIs in manager
    poiManager.createPoi({
      id: 'poi-waw-1',
      categoryId: 'fuel_station',
      name: 'Stacja Paliw Warszawa',
      coordinate: [21.0122, 52.2297],
      status: 'ACTIVE',
      attributes: {
        brand: 'Orlen',
        fuel_types: ['DIESEL', 'PB95'],
        gate_code: 'SUPER_SECRET_PIN',
      },
      createdBy: 'user-disp',
    });

    poiManager.createPoi({
      id: 'poi-lodz-1',
      categoryId: 'warehouse_logistics',
      name: 'Hub Logistyczny Łódź',
      coordinate: [19.4560, 51.7592], // ~120km away from Warsaw
      status: 'ACTIVE',
      attributes: {
        facility_name: 'Łódź Central Hub',
        ramp_count: 20,
      },
      createdBy: 'user-disp',
    });

    // 1. Radius query within 50km of Warsaw
    const wawRadiusResult = poiManager.searchRadius([21.0122, 52.2297], 50000);
    expect(wawRadiusResult.totalMatches).toBe(1);
    expect(wawRadiusResult.items[0]!.id).toBe('poi-waw-1');
    expect(wawRadiusResult.items[0]!.attributes['gate_code']).toBe('SUPER_SECRET_PIN'); // Dispatcher has sensitive read

    // 2. BBox query covering both Warsaw and Łódź
    const bboxResult = poiManager.searchBBox([19.0, 51.5, 21.5, 52.5]);
    expect(bboxResult.totalMatches).toBe(2);

    // 3. Switch to Driver -> session drain clears in-memory POIs
    await authBooth.enterBooth({
      sessionId: 'sess-driver-2',
      userId: 'user-driver',
      username: 'driver_adam',
      token: 'tok-2',
      role: 'DRIVER',
    });

    const drainedResult = poiManager.searchBBox([19.0, 51.5, 21.5, 52.5]);
    expect(drainedResult.totalMatches).toBe(0);
  });
});
