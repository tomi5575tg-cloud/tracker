import { describe, it, expect, vi } from 'vitest';
import { TacticalMapCockpitController } from '../../components/TacticalMapCockpit.js';
import {
  DegradationLevel,
  ScreenRenderMode,
  PositioningSource,
  type TelemetryFix,
} from '../../src/mesh/types.js';

describe('TacticalMapCockpit & Fault-Tolerant Mesh Integration', () => {
  const createMockMap = () => {
    return {
      getSource: vi.fn(),
      addSource: vi.fn(),
      removeSource: vi.fn(),
      getLayer: vi.fn(),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
      setFilter: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      loaded: vi.fn(() => true),
      isStyleLoaded: vi.fn(() => true),
      getCenter: vi.fn(() => ({ lng: 21.0122, lat: 52.2297 })),
      getZoom: vi.fn(() => 12),
      setCenter: vi.fn(),
      setZoom: vi.fn(),
      easeTo: vi.fn(),
      flyTo: vi.fn(),
      fitBounds: vi.fn(),
      setFeatureState: vi.fn(),
      getFeatureState: vi.fn(() => ({})),
      removeFeatureState: vi.fn(),
      getCanvas: vi.fn(() => ({ style: { cursor: 'default' } })),
    } as unknown as import('../../src/maplibre/types.js').MapLibreMapInstance;
  };

  it('should initialize cockpit with FaultTolerantMeshSupervisor and reflect status in ViewModel and TopBar', () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({ map: mockMap });

    const supervisor = cockpit.getMeshSupervisor();
    expect(supervisor).toBeDefined();

    const vm = cockpit.getViewModel();
    expect(vm.topBar.degradationLevel).toBe(DegradationLevel.OPTIMAL);
    expect(vm.topBar.degradationLevelName).toBe('OPTIMAL (L0)');
    expect(vm.topBar.isMeshHealthy).toBe(true);
    expect(vm.topBar.screenRenderMode).toBe(ScreenRenderMode.WEBGL_VECTOR);
    expect(vm.topBar.isSurvivalMode).toBe(false);

    const html = cockpit.renderHtml();
    expect(html).toContain('Tracker HUD Cockpit');
    expect(html).toContain('OPTIMAL (L0)');
    expect(html).toContain('WEBGL_VECTOR');
  });

  it('should render 2D Canvas / Emergency HUD fallback when WebGL fails, with ZERO screen blackout', () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({ map: mockMap });

    // Simulate GPU WebGL crash
    cockpit.getMeshSupervisor().getScreenGuardian().handleWebGlContextLost('GPU driver hung');

    const vm = cockpit.getViewModel();
    expect(vm.topBar.screenRenderMode).toBe(ScreenRenderMode.CANVAS_2D);

    const html = cockpit.renderHtml();
    expect(html).toContain('TRYB AWARYJNY 2D CANVAS');
    expect(html).toContain('CANVAS_2D');

    // Trigger Emergency Survival Mode
    cockpit.triggerEmergencySafeMode('CRITICAL_SYSTEM_OFFLINE');
    const emergencyVm = cockpit.getViewModel();
    expect(emergencyVm.topBar.isSurvivalMode).toBe(true);

    const emergencyHtml = cockpit.renderHtml();
    expect(emergencyHtml).toContain('EKRAN AWARYJNY HUD (SURVIVAL MODE)');
    expect(emergencyHtml).toContain('NIEPRZERWANA NAWIGACJA');
  });

  it('should guarantee ZERO SPOF: when all services throw concurrently, renderHtml never throws and displays navigation', () => {
    const mockMap = createMockMap();
    const cockpit = new TacticalMapCockpitController({ map: mockMap });

    // Trip all subsystems into fault state
    cockpit.getMeshSupervisor().triggerEmergencySafeMode('TOTAL_SPOF_STORM');

    expect(() => {
      const html = cockpit.renderHtml();
      expect(html).toContain('EKRAN AWARYJNY HUD');
      expect(html).toContain('STAN: NIEPRZERWANA NAWIGACJA');
    }).not.toThrow();
  });

  it('should integrate panic drain with emergency safe mode and auth lock booth exit', async () => {
    const mockMap = createMockMap();
    let drainedReason: string | null = null;
    const cockpit = new TacticalMapCockpitController({
      map: mockMap,
      onSessionDrain: (reason) => {
        drainedReason = reason;
      },
    });

    await cockpit.triggerPanicDrain('SECURITY_BREACH_PANIC');

    expect(drainedReason).toBe('SECURITY_BREACH_PANIC');
    expect(cockpit.getAuthBooth().getSession()).toBeNull();
    expect(cockpit.getMeshSupervisor().getDegradationLevel()).toBe(DegradationLevel.CRITICAL_SURVIVAL);
  });
});
