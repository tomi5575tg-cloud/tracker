import { describe, it, expect, vi } from 'vitest';
import { PoiManager } from '../../src/poi/poiManager.js';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';
import type { UserSession } from '../../src/types.js';

describe('PoiManager (POI Lifecycle, Permissions & Session Drain)', () => {
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
    userId: 'driver-1',
    username: 'driver',
    token: 'token-drv',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'DRIVER',
  };

  it('should create and retrieve a valid POI for Fuel Station category', () => {
    const manager = new PoiManager();

    const created = manager.createPoi(
      {
        id: 'poi-orlen-01',
        categoryId: 'fuel_station',
        name: 'Stacja Orlen Poznań',
        coordinate: [16.9252, 52.4064], // Poznań [lon, lat]
        status: 'ACTIVE',
        attributes: {
          brand: 'Orlen',
          fuel_types: ['DIESEL', 'PB95', 'LPG'],
          is_24h: true,
          gate_code: 'PIN-SECRET',
        },
        createdBy: 'disp-1',
      },
      dispatcherSession
    );

    expect(created.id).toBe('poi-orlen-01');
    expect(created.version).toBe(1);

    const retrieved = manager.getPoi('poi-orlen-01', dispatcherSession);
    expect(retrieved?.attributes['gate_code']).toBe('PIN-SECRET');

    // Driver viewing POI gets masked sensitive attributes
    const driverView = manager.getPoi('poi-orlen-01', driverSession);
    expect(driverView?.attributes['gate_code']).toBe('[CONFIDENTIAL / MASKED]');
  });

  it('should reject creating POI in non-existent category', () => {
    const manager = new PoiManager();
    expect(() =>
      manager.createPoi(
        {
          id: 'poi-unknown-01',
          categoryId: 'non_existent_cat',
          name: 'Test',
          coordinate: [20, 50],
          status: 'ACTIVE',
          attributes: {},
          createdBy: 'disp-1',
        },
        dispatcherSession
      )
    ).toThrow();
  });

  it('should reject deleting POI by unauthorized driver', () => {
    const manager = new PoiManager();
    manager.createPoi(
      {
        id: 'poi-cust-01',
        categoryId: 'customer_site',
        name: 'Klient ABC',
        coordinate: [19.9449, 50.0647],
        status: 'ACTIVE',
        attributes: {
          client_code: 'CLI-001',
          contact_phone: '+48 12 345 6789',
        },
        createdBy: 'disp-1',
      },
      dispatcherSession
    );

    expect(() => manager.deletePoi('poi-cust-01', driverSession)).toThrow();
    expect(manager.deletePoi('poi-cust-01', dispatcherSession)).toBe(true);
  });

  it('should drain in-memory POIs when AuthLockBooth session changes or drains', async () => {
    const authBooth = new AuthLockBooth({
      storage: new InMemoryStorageProvider(),
    });

    const drainedSpy = vi.fn();
    const manager = new PoiManager({
      authBooth,
      onPoiDrained: drainedSpy,
    });

    // Enter user 1
    await authBooth.enterBooth({
      sessionId: 'sess-1',
      userId: 'user-1',
      username: 'user1',
      token: 'tok-1',
      role: 'DISPATCHER',
    });

    manager.createPoi({
      id: 'poi-test-drain',
      categoryId: 'fuel_station',
      name: 'Stacja Test',
      coordinate: [21.0, 52.0],
      status: 'ACTIVE',
      attributes: {
        brand: 'BP',
        fuel_types: ['DIESEL'],
      },
      createdBy: 'user-1',
    });

    expect(manager.listPois()).toHaveLength(1);

    // Switch user in Auth Booth -> triggers session drain
    await authBooth.enterBooth({
      sessionId: 'sess-2',
      userId: 'user-2',
      username: 'user2',
      token: 'tok-2',
      role: 'ADMIN',
    });

    expect(drainedSpy).toHaveBeenCalledWith('SWITCH_USER_OR_RELOGIN', expect.anything());
    expect(manager.listPois()).toHaveLength(0);
  });
});
