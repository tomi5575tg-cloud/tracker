import { describe, it, expect, beforeEach } from 'vitest';
import { AuthLockBooth } from '../../src/auth/authBooth.js';
import { FaultTolerantMeshSupervisor } from '../../src/resilience/faultTolerantMesh.js';
import { EmergencyRenderer } from '../../src/resilience/emergencyRenderer.js';
import { SimulatedGnssPort } from '../../src/hardware/simulatedGnssPort.js';
import { ManualInertialPort } from '../../src/hardware/manualInertialPort.js';
import { HardwareTelemetryBus } from '../../src/hardware/telemetryBus.js';
import { HardwareToPixelPipeline } from '../../src/weld/hardwareToPixelPipeline.js';
import { CabinEmptyError, OccupantMismatchError } from '../../src/weld/errors.js';
import { projectLonLatToScreen } from '../../src/pixel/projection.js';
import { GeoJsonValidator } from '../../src/geojson/validator.js';
import { InMemoryStorageProvider } from '../../src/auth/storage.js';

const WARSAW: [number, number] = [21.0122, 52.2297];

async function occupyDemoCabin(booth: AuthLockBooth) {
  return booth.enterBooth({
    sessionId: 'sess-weld-1',
    userId: 'driver-demo',
    username: 'OPERATOR.DEMO',
    token: 'demo-local-token',
    role: 'DRIVER',
    tenantId: 'demo-fleet',
  });
}

function createPipeline() {
  const booth = new AuthLockBooth({ storage: new InMemoryStorageProvider() });
  const renderer = new EmergencyRenderer();
  const mesh = new FaultTolerantMeshSupervisor({
    initialPosition: WARSAW,
    emergencyRenderer: renderer,
  });
  const pipeline = new HardwareToPixelPipeline({
    booth,
    mesh,
    renderer,
    frameWidth: 800,
    frameHeight: 600,
  });
  return { booth, renderer, mesh, pipeline };
}

describe('Hardware → cabin pixel weld', () => {
  let booth: AuthLockBooth;
  let mesh: FaultTolerantMeshSupervisor;
  let pipeline: HardwareToPixelPipeline;

  beforeEach(() => {
    const created = createPipeline();
    booth = created.booth;
    mesh = created.mesh;
    pipeline = created.pipeline;
  });

  it('refuses to paint vehicle pixels while the cabin is empty', () => {
    expect(() =>
      pipeline.ingestFix({
        timestamp: 1_000,
        coordinate: WARSAW,
        source: 'LIVE_GNSS',
        speedKmh: 40,
        headingDeg: 15,
      })
    ).toThrow(CabinEmptyError);
    expect(pipeline.getFrameBuffer().audit().isBlank).toBe(true);
  });

  it('welds a live GNSS fix to RFC 7946 GeoJSON and a non-blank vehicle pixel', async () => {
    await occupyDemoCabin(booth);

    const now = Date.now();
    const audit = pipeline.ingestFix({
      timestamp: now,
      coordinate: WARSAW,
      source: 'LIVE_GNSS',
      speedKmh: 48,
      headingDeg: 22,
    });

    expect(audit.cabinOccupied).toBe(true);
    expect(audit.sessionUserId).toBe('driver-demo');
    expect(audit.gnssSource).toBe('LIVE_GNSS');
    expect(audit.rfc7946Valid).toBe(true);
    expect(audit.screenFilled).toBe(true);
    expect(audit.isDeadReckoning).toBe(false);
    expect(audit.vehicleGeoJson.geometry.type).toBe('Point');
    expect(audit.vehicleGeoJson.geometry.coordinates[0]).toBe(WARSAW[0]);
    expect(audit.vehicleGeoJson.geometry.coordinates[1]).toBe(WARSAW[1]);
    expect(audit.vehicleGeoJson.properties.userId).toBe('driver-demo');
    expect(GeoJsonValidator.isValidFeature(audit.vehicleGeoJson)).toBe(true);

    const expected = projectLonLatToScreen(WARSAW, WARSAW, 13, 800, 600);
    expect(audit.vehicleScreen).not.toBeNull();
    expect(audit.vehicleScreen?.x).toBeCloseTo(expected.x, 8);
    expect(audit.vehicleScreen?.y).toBeCloseTo(expected.y, 8);
    expect(audit.pixel.banner).toContain('LEVEL_0_NOMINAL');
  });

  it('rejects a payload for a different occupant (no cross-cabin leak)', async () => {
    await occupyDemoCabin(booth);
    expect(() =>
      pipeline.ingestFix(
        {
          timestamp: 1_000,
          coordinate: WARSAW,
          source: 'LIVE_GNSS',
        },
        'other-driver'
      )
    ).toThrow(OccupantMismatchError);
  });

  it('keeps navigation pixels under GPS loss via inertial dead reckoning', async () => {
    await occupyDemoCabin(booth);
    const gpsAt = Date.now();
    pipeline.ingestFix({
      timestamp: gpsAt,
      coordinate: WARSAW,
      source: 'LIVE_GNSS',
      speedKmh: 72,
      headingDeg: 90,
    });

    const audit = pipeline.ingestInertial({
      timestamp: gpsAt + 3_000,
      speedKmh: 72,
      headingDeg: 90,
    });

    expect(audit.isDeadReckoning).toBe(true);
    expect(audit.gnssSource).toBe('INERTIAL_DEAD_RECKONING');
    expect(audit.screenFilled).toBe(true);
    expect(audit.vehicleScreen).not.toBeNull();
    expect(audit.coordinate[0]).not.toBe(WARSAW[0]);
    expect(audit.degradationLevel).toBe('LEVEL_2_GPS_LOST');
    expect(audit.pixel.banner).toContain('DEAD RECKONING');
  });

  it('on WebGL loss paints the same vehicle through the emergency 2D surface', async () => {
    await occupyDemoCabin(booth);
    const live = pipeline.ingestFix({
      timestamp: 1_000,
      coordinate: WARSAW,
      source: 'LIVE_GNSS',
      headingDeg: 45,
    });

    const emergency = pipeline.notifyWebGlContextLost('GPU_CRASH');

    expect(emergency.degradationLevel).toBe('LEVEL_3_MAP_RENDER_LOST');
    expect(emergency.activeRenderer).toBe('EMERGENCY_2D_CANVAS');
    expect(emergency.screenFilled).toBe(true);
    expect(emergency.vehicleScreen?.x).toBeCloseTo(live.vehicleScreen!.x, 8);
    expect(emergency.vehicleScreen?.y).toBeCloseTo(live.vehicleScreen!.y, 8);
    expect(emergency.pixel.banner).toContain('LEVEL_3_MAP_RENDER_LOST');
    expect(mesh.getStatusSummary().isScreenSafe).toBe(true);
  });

  it('paints KABINA PUSTA on drain instead of a black pane, then blocks GNSS until re-entry', async () => {
    await occupyDemoCabin(booth);
    pipeline.ingestFix({
      timestamp: 1_000,
      coordinate: WARSAW,
      source: 'LIVE_GNSS',
    });

    await booth.exitBooth('PANIC_DRAIN');

    const drained = pipeline.getLastAudit();
    expect(drained?.cabinOccupied).toBe(false);
    expect(drained?.screenFilled).toBe(true);
    expect(drained?.pixel.banner).toContain('KABINA PUSTA');
    expect(pipeline.getFrameBuffer().getCommands().some((c) => c.kind === 'EMPTY_CABIN')).toBe(true);

    expect(() =>
      pipeline.ingestFix({
        timestamp: 2_000,
        coordinate: WARSAW,
        source: 'LIVE_GNSS',
      })
    ).toThrow(CabinEmptyError);
  });

  it('labels SIMULATED GNSS explicitly and never reports it as LIVE_GNSS', async () => {
    await occupyDemoCabin(booth);
    const port = new SimulatedGnssPort({
      startCoordinate: WARSAW,
      speedKmh: 0,
      intervalMs: 60_000,
    });
    let seenSource = '';
    const bus = new HardwareTelemetryBus({
      gnss: port,
      onFix: (fix) => {
        seenSource = fix.source;
        pipeline.ingestFix(fix);
      },
    });

    bus.start();
    const status = bus.getStatus();
    expect(status.gnssKind).toBe('SIMULATED');
    expect(seenSource).toBe('SIMULATED');
    expect(pipeline.getLastAudit()?.gnssSource).toBe('SIMULATED');
    bus.stop();
  });

  it('propagates a failing drain hook instead of swallowing it', async () => {
    await occupyDemoCabin(booth);
    booth.registerDrainHook({
      drain: () => {
        throw new Error('hook exploded');
      },
    });

    await expect(booth.exitBooth('XRAY')).rejects.toThrow(/Session drain incomplete/);
  });

  it('opens the GNSS circuit after repeated hardware errors and does not invent a fix', async () => {
    const inertial = new ManualInertialPort();
    const port = new SimulatedGnssPort({ speedKmh: 0, intervalMs: 60_000 });
    const errors: string[] = [];
    const bus = new HardwareTelemetryBus({
      gnss: port,
      inertial,
      gnssFailureThreshold: 2,
      onError: (err) => errors.push(err.name),
    });

    expect(() => {
      bus.ingestFix({
        timestamp: 1,
        coordinate: WARSAW,
        source: 'LIVE_GNSS',
      });
    }).not.toThrow();

    const failingPort = {
      kind: 'LIVE_GNSS' as const,
      start(_onFix: (fix: never) => void, onError: (error: Error) => void) {
        onError(new Error('receiver mute'));
        onError(new Error('receiver mute'));
      },
      stop() {
        /* no-op */
      },
    };

    const failingBus = new HardwareTelemetryBus({
      gnss: failingPort,
      gnssFailureThreshold: 2,
      onError: (err) => errors.push(err.name),
    });
    failingBus.start();
    expect(failingBus.getBreakerState()).toBe('OPEN');
    expect(failingBus.getStatus().lastFix).toBeNull();
  });
});
