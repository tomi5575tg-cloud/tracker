import { describe, it, expect } from 'vitest';
import {
  PermissionsMatrixEngine,
  SecurityAccessDeniedError,
  DEFAULT_PERMISSIONS_MATRIX,
} from '../../src/poi/permissionsMatrix.js';
import type { UserSession } from '../../src/types.js';
import type { PoiItem, PoiCategory } from '../../src/poi/types.js';

describe('PermissionsMatrixEngine (Matryca Uprawnień)', () => {
  const engine = new PermissionsMatrixEngine(DEFAULT_PERMISSIONS_MATRIX);

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
    sessionId: 'sess-dispatcher',
    userId: 'disp-1',
    username: 'dispatcher_john',
    token: 'token-disp',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'DISPATCHER',
  };

  const driverSession: UserSession = {
    sessionId: 'sess-driver',
    userId: 'driver-1',
    username: 'driver_mike',
    token: 'token-driver',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'DRIVER',
  };

  const viewerSession: UserSession = {
    sessionId: 'sess-viewer',
    userId: 'viewer-1',
    username: 'guest_viewer',
    token: 'token-viewer',
    loginTimestamp: 1700000000000,
    lastActiveTimestamp: 1700000000000,
    role: 'VIEWER',
  };

  describe('Standard Role Permissions Evaluation', () => {
    it('ADMIN should have full permissions including SYSTEM category management and sensitive data', () => {
      expect(engine.can(adminSession, 'CATEGORY_CREATE')).toBe(true);
      expect(engine.can(adminSession, 'CATEGORY_MANAGE_SYSTEM', { categoryClassification: 'SYSTEM' })).toBe(true);
      expect(engine.can(adminSession, 'POI_CREATE')).toBe(true);
      expect(engine.can(adminSession, 'POI_READ_SENSITIVE')).toBe(true);
      expect(engine.can(adminSession, 'POI_DELETE')).toBe(true);
      expect(engine.can(adminSession, 'POI_AUDIT')).toBe(true);
    });

    it('DISPATCHER should have POI management and custom category creation, but NOT SYSTEM category management', () => {
      expect(engine.can(dispatcherSession, 'POI_CREATE')).toBe(true);
      expect(engine.can(dispatcherSession, 'POI_READ_SENSITIVE')).toBe(true);
      expect(engine.can(dispatcherSession, 'POI_DELETE')).toBe(true);
      expect(engine.can(dispatcherSession, 'CATEGORY_CREATE')).toBe(true);

      // Modifying SYSTEM category is disallowed for DISPATCHER
      expect(
        engine.can(dispatcherSession, 'CATEGORY_UPDATE', { categoryClassification: 'SYSTEM' })
      ).toBe(false);
    });

    it('DRIVER should be able to read and create POIs, but not delete or read sensitive fields', () => {
      expect(engine.can(driverSession, 'POI_READ')).toBe(true);
      expect(engine.can(driverSession, 'POI_CREATE')).toBe(true);
      expect(engine.can(driverSession, 'POI_READ_SENSITIVE')).toBe(false);
      expect(engine.can(driverSession, 'POI_DELETE')).toBe(false);
      expect(engine.can(driverSession, 'CATEGORY_CREATE')).toBe(false);
    });

    it('VIEWER should only have read access to categories and non-sensitive POI data', () => {
      expect(engine.can(viewerSession, 'CATEGORY_READ')).toBe(true);
      expect(engine.can(viewerSession, 'POI_READ')).toBe(true);
      expect(engine.can(viewerSession, 'POI_CREATE')).toBe(false);
      expect(engine.can(viewerSession, 'POI_DELETE')).toBe(false);
      expect(engine.can(viewerSession, 'POI_READ_SENSITIVE')).toBe(false);
    });
  });

  describe('assertCan & Security Exceptions', () => {
    it('assertCan should not throw when action is allowed', () => {
      expect(() => engine.assertCan(adminSession, 'POI_DELETE')).not.toThrow();
    });

    it('assertCan should throw SecurityAccessDeniedError with descriptive details when action is denied', () => {
      expect(() => engine.assertCan(viewerSession, 'POI_DELETE')).toThrow(SecurityAccessDeniedError);

      try {
        engine.assertCan(viewerSession, 'POI_DELETE');
      } catch (err) {
        expect(err).toBeInstanceOf(SecurityAccessDeniedError);
        const secErr = err as SecurityAccessDeniedError;
        expect(secErr.action).toBe('POI_DELETE');
        expect(secErr.userId).toBe('viewer-1');
        expect(secErr.roles).toContain('VIEWER');
      }
    });
  });

  describe('Multi-Tenancy Isolation', () => {
    const tenantSessionA: UserSession = {
      ...dispatcherSession,
      tenantId: 'tenant-alpha',
    };

    it('should allow access within the same tenant', () => {
      expect(engine.can(tenantSessionA, 'POI_READ', { tenantId: 'tenant-alpha' })).toBe(true);
    });

    it('should deny access across different tenants for regular roles', () => {
      expect(engine.can(tenantSessionA, 'POI_READ', { tenantId: 'tenant-beta' })).toBe(false);
    });

    it('ADMIN should bypass tenant isolation', () => {
      const adminTenantSession: UserSession = {
        ...adminSession,
        tenantId: 'tenant-alpha',
      };
      expect(engine.can(adminTenantSession, 'POI_READ', { tenantId: 'tenant-beta' })).toBe(true);
    });
  });

  describe('Sensitive Data Sanitization', () => {
    const sensitiveCategory: PoiCategory = {
      id: 'secure_client',
      code: 'SEC_CLI',
      name: 'Klient Chroniony',
      classification: 'CUSTOM',
      status: 'ACTIVE',
      style: { markerColor: '#000000', iconName: 'shield' },
      attributesSchema: [
        { key: 'public_name', label: 'Nazwa', type: 'STRING' },
        { key: 'gate_alarm_pin', label: 'PIN Alarmu', type: 'STRING', sensitive: true },
        { key: 'vip_phone', label: 'Telefon VIP', type: 'PHONE', sensitive: true },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
    };

    const testPoi: PoiItem = {
      id: 'poi-sec-01',
      categoryId: 'secure_client',
      name: 'Placówka Bankowa',
      coordinate: [21.0, 52.0],
      status: 'ACTIVE',
      attributes: {
        public_name: 'Oddział 1',
        gate_alarm_pin: '4321-SECURE',
        vip_phone: '+48 500 600 700',
      },
      createdBy: 'user-admin',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
    };

    it('should preserve sensitive attributes for users with POI_READ_SENSITIVE (ADMIN/DISPATCHER)', () => {
      const sanitized = engine.sanitizePoi(testPoi, sensitiveCategory);
      const filtered = engine.filterPois(adminSession, [testPoi], new Map([[sensitiveCategory.id, sensitiveCategory]]));

      expect(filtered[0]!.attributes['gate_alarm_pin']).toBe('4321-SECURE');
      expect(filtered[0]!.attributes['vip_phone']).toBe('+48 500 600 700');
    });

    it('should mask sensitive attributes for users WITHOUT POI_READ_SENSITIVE (DRIVER/VIEWER)', () => {
      const filtered = engine.filterPois(driverSession, [testPoi], new Map([[sensitiveCategory.id, sensitiveCategory]]));

      expect(filtered[0]!.attributes['public_name']).toBe('Oddział 1');
      expect(filtered[0]!.attributes['gate_alarm_pin']).toBe('[CONFIDENTIAL / MASKED]');
      expect(filtered[0]!.attributes['vip_phone']).toBe('[CONFIDENTIAL / MASKED]');
    });
  });
});
