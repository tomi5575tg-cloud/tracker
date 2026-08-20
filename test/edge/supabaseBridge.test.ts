import { describe, it, expect } from 'vitest';
import { SupabaseTelemetryBridgeHandler } from '../../src/edge/supabaseBridge.js';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import type { TelemetryBatchFrame } from '../../src/edge/types.js';

describe('SupabaseTelemetryBridgeHandler', () => {
  it('should process TelemetryBatchFrame into RouteData and RFC 7946 GeoJSON collections', () => {
    const handler = new SupabaseTelemetryBridgeHandler();

    const frame: TelemetryBatchFrame = {
      frameId: 'frame_101',
      vehicleId: 'vh_titan_01',
      driverId: 'dr_tomi',
      timestamp: 1700000000000,
      unitLoadPct: 45,
      points: [
        { coordinate: [21.0122, 52.2297], timestamp: 1700000000000, speedKmh: 60, headingDeg: 0 },
        { coordinate: [21.0150, 52.2310], timestamp: 1700000001000, speedKmh: 75, headingDeg: 15 },
        { coordinate: [21.0200, 52.2350], timestamp: 1700000002000, speedKmh: 95, headingDeg: 25 },
      ],
    };

    const processed = handler.processTelemetryFrame(frame);

    expect(processed.result.frameId).toBe('frame_101');
    expect(processed.result.processedPointsCount).toBe(3);
    expect(processed.result.averageSpeedKmh).toBeGreaterThan(70);
    expect(processed.route.waypoints.length).toBe(3);
    expect(processed.route.distanceMeters).toBeGreaterThan(100);

    // Verify RFC 7946 GeoJSON
    expect(processed.geojson.routeCollection.type).toBe('FeatureCollection');
    expect(processed.geojson.routeCollection.features[0]?.geometry.type).toBe('LineString');
    expect(processed.geojson.waypointCollection.features.length).toBe(3);
  });

  it('should enforce Single Booth auth validation on edge requests when authBooth is present', async () => {
    const authBooth = new AuthLockBooth();
    const handler = new SupabaseTelemetryBridgeHandler({ authBooth });

    const reqPayload = {
      frameId: 'frame_auth_1',
      vehicleId: 'vh_1',
      points: [{ coordinate: [21.0, 52.0], timestamp: 1000, speedKmh: 50 }],
    };

    // 1. Without active session -> 401 Unauthorized
    const resUnauthorized = await handler.handleEdgeRequest({
      method: 'POST',
      body: JSON.stringify(reqPayload),
    });
    expect(resUnauthorized.status).toBe(401);
    expect(resUnauthorized.body).toContain('UNAUTHORIZED_SINGLE_BOOTH');

    // 2. Occupy booth -> 200 OK
    await authBooth.enterBooth({
      sessionId: 'sess_1',
      userId: 'u_1',
      username: 'Tomi',
      token: 'tok_123',
      loginTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
    });

    const resAuthorized = await handler.handleEdgeRequest({
      method: 'POST',
      body: JSON.stringify(reqPayload),
    });
    expect(resAuthorized.status).toBe(200);
    expect(resAuthorized.headers['x-tracker-turbo-level']).toBeDefined();
    expect(resAuthorized.headers['x-tracker-power-dosing']).toBeDefined();
  });

  it('should clean active routes on session drain', () => {
    const handler = new SupabaseTelemetryBridgeHandler();

    handler.processTelemetryFrame({
      frameId: 'f1',
      vehicleId: 'vh_x',
      points: [{ coordinate: [21.0, 52.0], timestamp: 1000 }],
    });

    expect(handler.getActiveRoute('vh_x')).toBeDefined();

    handler.drain('LOGOUT');

    expect(handler.getActiveRoute('vh_x')).toBeUndefined();
  });
});
