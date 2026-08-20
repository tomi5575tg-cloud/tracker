import { describe, it, expect } from 'vitest';
import { FaultTolerantMeshSupervisor } from '../../src/mesh/meshSupervisor.js';
import {
  DegradationLevel,
  MeshSubsystem,
  ScreenRenderMode,
  PositioningSource,
  MeshMessagePriority,
  type TelemetryFix,
} from '../../src/mesh/types.js';

describe('FaultTolerantMeshSupervisor (Central Mesh Resilience & Recovery)', () => {
  it('should initialize with OPTIMAL degradation level when all subsystems are healthy', () => {
    const supervisor = new FaultTolerantMeshSupervisor();
    const summary = supervisor.getHealthSummary();

    expect(summary.overallDegradationLevel).toBe(DegradationLevel.OPTIMAL);
    expect(summary.isFullyOperational).toBe(true);
    expect(summary.isSurvivalMode).toBe(false);
    expect(summary.subsystems[MeshSubsystem.POSITIONING].isHealthy).toBe(true);
    expect(summary.subsystems[MeshSubsystem.RENDERING].isHealthy).toBe(true);
  });

  it('should acquire position using live GPS fix or smoothly degrade to Dead Reckoning', async () => {
    const supervisor = new FaultTolerantMeshSupervisor();

    // 1. Live fix
    const liveFix: TelemetryFix = {
      position: [21.0122, 52.2297],
      speedKmh: 50,
      headingDegrees: 90,
      accuracyMeters: 4,
      timestamp: Date.now(),
      source: PositioningSource.GPS_STANDARD,
    };

    const acquired = await supervisor.acquirePosition(liveFix);
    expect(acquired.position).toEqual([21.0122, 52.2297]);
    expect(acquired.source).toBe(PositioningSource.GPS_STANDARD);

    // 2. GPS loss (null fix passed) -> falls back to Dead Reckoning tier
    const fallbackPosition = await supervisor.acquirePosition(null);
    expect(fallbackPosition).toBeDefined();
    expect(fallbackPosition.position).toBeDefined();
  });

  it('should compute navigation and support route assignment', async () => {
    const supervisor = new FaultTolerantMeshSupervisor();

    supervisor.setRoute({
      routeId: 'route-mesh-1',
      userId: 'driver-01',
      distanceMeters: 3000,
      durationSeconds: 200,
      createdAt: 1000,
      updatedAt: 1000,
      waypoints: [
        { id: 'w1', coordinate: [21.0122, 52.2297], timestamp: 1000, name: 'Start' },
        { id: 'w2', coordinate: [21.0122, 52.2500], timestamp: 1100, name: 'Koniec' },
      ],
    });

    const fix: TelemetryFix = {
      position: [21.0122, 52.2350],
      speedKmh: 45,
      headingDegrees: 0,
      accuracyMeters: 5,
      timestamp: Date.now(),
      source: PositioningSource.GPS_STANDARD,
    };

    const guidance = await supervisor.computeNavigation(fix);
    expect(guidance.targetName).toBe('Koniec');
    expect(guidance.distanceToTargetMeters).toBeGreaterThan(0);
  });

  it('should safely render screen in any degradation mode without blacking out', async () => {
    const supervisor = new FaultTolerantMeshSupervisor();

    const renderData = {
      currentFix: {
        position: [21.0122, 52.2297] as [number, number],
        speedKmh: 50,
        headingDegrees: 90,
        accuracyMeters: 4,
        timestamp: Date.now(),
        source: PositioningSource.GPS_STANDARD,
      },
      activeRoute: null,
      pois: [],
      selectedPoi: null,
      viewportCenter: [21.0122, 52.2297] as [number, number],
      zoom: 12,
      headingDegrees: 90,
      degradationLevel: DegradationLevel.OPTIMAL,
    };

    // 1. WebGL primary
    const webglHtml = await supervisor.renderScreen(renderData);
    expect(webglHtml).toContain('maplibre-cockpit-canvas');

    // 2. Emergency safe mode trigger
    supervisor.triggerEmergencySafeMode('CRITICAL_SYSTEM_FAULT');
    expect(supervisor.getDegradationLevel()).toBe(DegradationLevel.CRITICAL_SURVIVAL);

    const emergencyHtml = await supervisor.renderScreen(renderData);
    expect(emergencyHtml).toContain('EKRAN AWARYJNY HUD (SURVIVAL MODE)');
    expect(emergencyHtml).toContain('NIEPRZERWANA NAWIGACJA');
  });

  it('should buffer telemetry and support self-healing recovery', async () => {
    const supervisor = new FaultTolerantMeshSupervisor();

    // Buffer message
    const buffered = await supervisor.bufferTelemetry(
      'telemetry.gps',
      { speed: 65 },
      MeshMessagePriority.TELEMETRY_HIGH
    );
    expect(buffered).toBe(true);

    // Trip into emergency
    supervisor.triggerEmergencySafeMode();
    expect(supervisor.getDegradationLevel()).toBe(DegradationLevel.CRITICAL_SURVIVAL);

    // Self-healing recovery
    supervisor.triggerSelfHealingRecovery();
    expect(supervisor.getScreenGuardian().getRenderMode()).toBe(ScreenRenderMode.WEBGL_VECTOR);
    expect(supervisor.getHealthSummary().isFullyOperational).toBe(true);
  });
});
