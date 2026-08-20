import { describe, it, expect } from 'vitest';
import { FaultTolerantMeshSupervisor } from '../../src/resilience/faultTolerantMesh.js';

describe('FaultTolerantMeshSupervisor', () => {
  it('should initialize all subsystems healthy at LEVEL_0_NOMINAL', () => {
    const mesh = new FaultTolerantMeshSupervisor();
    const summary = mesh.getStatusSummary();

    expect(summary.overallLevel).toBe('LEVEL_0_NOMINAL');
    expect(summary.isScreenSafe).toBe(true);
    expect(summary.isNavigationActive).toBe(true);
    expect(summary.activeRenderer).toBe('MAPLIBRE_WEBGL');
    expect(summary.activeTelemetryChannel).toBe('SUPABASE_EDGE');
    expect(summary.subsystems.length).toBe(6);
  });

  it('should gracefully degrade to LEVEL_2_GPS_LOST when GPS signals are lost', () => {
    let observedLevel = '';
    const mesh = new FaultTolerantMeshSupervisor({
      onDegradationChange: (level) => {
        observedLevel = level;
      },
    });

    mesh.reportGpsLoss('TUNNEL_OCCLUSION');

    const summary = mesh.getStatusSummary();
    expect(summary.overallLevel).toBe('LEVEL_2_GPS_LOST');
    expect(observedLevel).toBe('LEVEL_2_GPS_LOST');
    expect(summary.isNavigationActive).toBe(true);
    expect(summary.isScreenSafe).toBe(true);
  });

  it('should gracefully degrade to LEVEL_3_MAP_RENDER_LOST when WebGL context is lost', () => {
    const mesh = new FaultTolerantMeshSupervisor();

    mesh.reportWebGlContextLoss('GPU_CRASH');

    const summary = mesh.getStatusSummary();
    expect(summary.overallLevel).toBe('LEVEL_3_MAP_RENDER_LOST');
    expect(summary.activeRenderer).toBe('EMERGENCY_2D_CANVAS');
    expect(summary.isScreenSafe).toBe(true);

    // Verify emergency SVG can still be rendered effortlessly
    const svg = mesh.renderEmergencySvg(800, 600);
    expect(svg).toContain('LEVEL_3_MAP_RENDER_LOST');
    expect(svg).toContain('<svg');

    // Restore WebGL
    mesh.reportWebGlContextRestored();
    expect(mesh.getStatusSummary().overallLevel).toBe('LEVEL_0_NOMINAL');
  });

  it('should clean and reset on session drain', () => {
    const mesh = new FaultTolerantMeshSupervisor();
    mesh.reportGpsLoss();

    mesh.drain('SESSION_LOGOUT');

    expect(mesh.getStatusSummary().overallLevel).toBe('LEVEL_0_NOMINAL');
  });
});
