import { describe, it, expect } from 'vitest';
import { ScreenGuardian, type ScreenRenderData } from '../../src/mesh/screenGuardian.js';
import {
  DegradationLevel,
  ScreenRenderMode,
  PositioningSource,
} from '../../src/mesh/types.js';

describe('ScreenGuardian (Zero Blackout Display Protection)', () => {
  const dummyRenderData: ScreenRenderData = {
    currentFix: {
      position: [21.0122, 52.2297],
      speedKmh: 45,
      headingDegrees: 180,
      accuracyMeters: 5,
      timestamp: Date.now(),
      source: PositioningSource.GPS_STANDARD,
    },
    activeRoute: null,
    pois: [],
    selectedPoi: null,
    viewportCenter: [21.0122, 52.2297],
    zoom: 12,
    headingDegrees: 180,
    degradationLevel: DegradationLevel.OPTIMAL,
  };

  it('should render WebGL canvas mount when WebGL is available', () => {
    const guardian = new ScreenGuardian();
    expect(guardian.getRenderMode()).toBe(ScreenRenderMode.WEBGL_VECTOR);

    const html = guardian.safeRender(dummyRenderData);
    expect(html).toContain('maplibre-cockpit-canvas');
    expect(html).toContain('WEBGL_VECTOR');
  });

  it('should automatically downgrade to 2D Canvas when WebGL context loss occurs', () => {
    let changedMode: ScreenRenderMode | null = null;
    let recoveries = 0;

    const guardian = new ScreenGuardian({
      onModeChanged: (mode) => {
        changedMode = mode;
      },
      onRecovery: (total) => {
        recoveries = total;
      },
    });

    guardian.handleWebGlContextLost('GPU driver hung');

    expect(guardian.getRenderMode()).toBe(ScreenRenderMode.CANVAS_2D);
    expect(changedMode).toBe(ScreenRenderMode.CANVAS_2D);
    expect(recoveries).toBe(1);

    const html = guardian.safeRender(dummyRenderData);
    expect(html).toContain('TRYB AWARYJNY 2D CANVAS');
    expect(html).toContain('CANVAS_2D');
  });

  it('should automatically restore to WebGL when context is restored', () => {
    const guardian = new ScreenGuardian();
    guardian.handleWebGlContextLost('GPU lost');
    expect(guardian.getRenderMode()).toBe(ScreenRenderMode.CANVAS_2D);

    guardian.handleWebGlContextRestored();
    expect(guardian.getRenderMode()).toBe(ScreenRenderMode.WEBGL_VECTOR);
  });

  it('should render SVG Vector schematic without throwing', () => {
    const guardian = new ScreenGuardian({ initialMode: ScreenRenderMode.SVG_VECTOR });
    const html = guardian.safeRender(dummyRenderData);

    expect(html).toContain('SVG VECTOR RADAR HUD');
    expect(html).toContain('<svg');
    expect(html).toContain('SVG_VECTOR');
  });

  it('should render High-Contrast Text Emergency HUD for Survival Mode', () => {
    const guardian = new ScreenGuardian({ initialMode: ScreenRenderMode.TEXT_EMERGENCY_HUD });
    const html = guardian.safeRender(dummyRenderData);

    expect(html).toContain('EKRAN AWARYJNY HUD (SURVIVAL MODE)');
    expect(html).toContain('NIEPRZERWANA NAWIGACJA');
    expect(html).toContain('TEXT_EMERGENCY_HUD');
    expect(html).toContain('52.229700°');
    expect(html).toContain('21.012200°');
  });

  it('should maintain screen heartbeat and track fps and state', () => {
    const guardian = new ScreenGuardian();
    guardian.heartbeat();

    const state = guardian.getState();
    expect(state.isScreenAlive).toBe(true);
    expect(state.lastHeartbeatTimestamp).toBeGreaterThan(0);
  });
});
