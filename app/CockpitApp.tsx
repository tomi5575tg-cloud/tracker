import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AuthLockBooth } from '../src/auth/authBooth.js';
import { InMemoryStorageProvider } from '../src/auth/storage.js';
import { FaultTolerantMeshSupervisor } from '../src/resilience/faultTolerantMesh.js';
import { EmergencyRenderer } from '../src/resilience/emergencyRenderer.js';
import { HardwareToPixelPipeline } from '../src/weld/hardwareToPixelPipeline.js';
import { bindWebGlContextLoss } from '../src/weld/bindWebGlLoss.js';
import { HardwareTelemetryBus } from '../src/hardware/telemetryBus.js';
import { BrowserGnssPort } from '../src/hardware/browserGnssPort.js';
import { SimulatedGnssPort } from '../src/hardware/simulatedGnssPort.js';
import { applyNeonGlowLayers } from '../lib/mapGlowLayers.js';
import { MapLibreRouteManager } from '../src/maplibre/routeManager.js';
import { MapLibrePoiLayerManager } from '../src/maplibre/poiLayerManager.js';
import type { MapLibreMapInstance } from '../src/maplibre/types.js';
import type { WeldAudit } from '../src/weld/hardwareToPixelPipeline.js';
import type { GnssSourceKind } from '../src/hardware/types.js';
import type { RouteData } from '../src/types.js';
import { useCopilotAgent } from './useCopilotAgent.js';
import { HighwayHorn } from '../src/audio/highwayHorn.js';
import { HighwayHornError } from '../src/audio/types.js';
import { evaluateHornTrigger } from '../src/audio/hornTrigger.js';

const WARSAW: [number, number] = [21.0122, 52.2297];

const DEMO_HGV = {
  heightMeters: 4.0,
  widthMeters: 2.55,
  lengthMeters: 16.5,
  grossWeightTonnes: 40,
  axleCount: 5,
  hasTrailer: true,
  limiterKmh: 85,
} as const;

const DEMO_SESSION = {
  sessionId: 'demo-duty-1',
  userId: 'driver-demo',
  username: 'OPERATOR.DEMO',
  token: 'demo-local-token',
  role: 'DRIVER' as const,
  tenantId: 'demo-fleet',
};

function sourceLabel(source: GnssSourceKind): string {
  switch (source) {
    case 'LIVE_GNSS':
      return 'GNSS ŻYWE';
    case 'SIMULATED':
      return 'GNSS SYMULOWANY';
    case 'INERTIAL_DEAD_RECKONING':
      return 'ZLICZENIOWA';
    default:
      return 'OSTATNI FIX';
  }
}

export function CockpitApp() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const overlayNode = useRef<HTMLCanvasElement | null>(null);
  const [audit, setAudit] = useState<WeldAudit | null>(null);
  const [cabinState, setCabinState] = useState('EMPTY');
  const [hardwareNote, setHardwareNote] = useState('inicjalizacja szyny sprzętowej…');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [hornNote, setHornNote] = useState<string | null>(null);
  const [hornCritical, setHornCritical] = useState(false);
  const { advice, source: copilotSource, networkState, requestAdvice } = useCopilotAgent();
  const requestAdviceRef = useRef(requestAdvice);
  requestAdviceRef.current = requestAdvice;
  const pipelineRef = useRef<HardwareToPixelPipeline | null>(null);
  const boothRef = useRef<AuthLockBooth | null>(null);
  const busRef = useRef<HardwareTelemetryBus | null>(null);
  const hornRef = useRef<HighwayHorn | null>(null);
  const wasHornCriticalRef = useRef(false);
  const pendingHornBlastRef = useRef(false);
  if (hornRef.current === null) {
    hornRef.current = new HighwayHorn();
  }

  useEffect(() => {
    const mapContainer = mapNode.current;
    const overlay = overlayNode.current;
    if (!mapContainer || !overlay) {
      throw new Error('Cockpit DOM surfaces are missing');
    }

    overlay.width = overlay.clientWidth || 800;
    overlay.height = overlay.clientHeight || 600;

    const booth = new AuthLockBooth({
      storage: new InMemoryStorageProvider(),
      onStateChange: (state) => setCabinState(state),
    });
    const renderer = new EmergencyRenderer({ canvasElement: overlay });
    const mesh = new FaultTolerantMeshSupervisor({
      initialPosition: WARSAW,
      emergencyRenderer: renderer,
    });
    const pipeline = new HardwareToPixelPipeline({
      booth,
      mesh,
      renderer,
      frameWidth: overlay.width,
      frameHeight: overlay.height,
    });

    boothRef.current = booth;
    pipelineRef.current = pipeline;
    booth.registerDrainHook(hornRef.current!);

    const map = new maplibregl.Map({
      container: mapContainer,
      style: 'https://demotiles.maplibre.org/style.json',
      center: WARSAW,
      zoom: 12,
      attributionControl: true,
    });

    let unbindWebGl: (() => void) | undefined;
    let detachGlow: (() => void) | undefined;
    let routeManager: MapLibreRouteManager | undefined;
    let cancelled = false;

    const applyAudit = (next: WeldAudit): void => {
      if (cancelled) {
        return;
      }
      setAudit(next);
      setErrorText(null);
      const useEmergency = next.activeRenderer !== 'MAPLIBRE_WEBGL';
      overlay.style.opacity = useEmergency ? '1' : '0';
      overlay.style.pointerEvents = useEmergency ? 'auto' : 'none';
    };

    const startHardware = (kind: 'LIVE_GNSS' | 'SIMULATED'): void => {
      busRef.current?.stop();
      const gnss =
        kind === 'LIVE_GNSS'
          ? new BrowserGnssPort()
          : new SimulatedGnssPort({
              startCoordinate: WARSAW,
              headingDeg: 18,
              speedKmh: 38,
              intervalMs: 1000,
            });
      const bus = new HardwareTelemetryBus({
        gnss,
        onFix: (fix) => {
          const next = pipeline.ingestFix(fix);
          applyAudit(next);
          if (routeManager && booth.getSession()) {
            const route = buildDutyRoute(fix.coordinate, booth.getSession()!.userId);
            mesh.setActiveRoute(route);
            routeManager.setRoute(route);
          }
          map.jumpTo({
            center: [next.coordinate[0], next.coordinate[1]],
            bearing: next.vehicleGeoJson.properties.headingDeg,
          });
          void requestAdviceRef.current({
            currentCoords: fix.coordinate,
            speed: fix.speedKmh ?? 0,
            isNight: isNightDuty(new Date()),
            hgvProfile: DEMO_HGV,
            nextManeuver: { type: 'STRAIGHT', distanceMeters: 4000 },
          });
        },
        onError: (error) => {
          if (kind === 'LIVE_GNSS') {
            setHardwareNote('Odbiornik GNSS niedostępny — szyna przełącza się na SYMULOWANY (jawnie).');
            startHardware('SIMULATED');
            return;
          }
          setErrorText(error.message);
        },
      });
      busRef.current = bus;
      setHardwareNote(
        kind === 'LIVE_GNSS'
          ? 'Szyna: LIVE_GNSS (Geolocation API)'
          : 'Szyna: SIMULATED — Cloud Agent / brak odbiornika, źródło opisane w HUD'
      );
      bus.start();
    };

    void booth.enterBooth(DEMO_SESSION).then(() => {
      if (cancelled) {
        return;
      }
      startHardware('LIVE_GNSS');
    });

    map.on('load', () => {
      if (cancelled) {
        return;
      }
      const mapInstance = map as unknown as MapLibreMapInstance;
      routeManager = new MapLibreRouteManager(mapInstance);
      routeManager.ensureLayers();
      new MapLibrePoiLayerManager(mapInstance);
      const glow = applyNeonGlowLayers(mapInstance);
      detachGlow = glow.removeGlowLayers;
      const canvas = map.getCanvas();
      unbindWebGl = bindWebGlContextLoss(canvas, pipeline);
    });

    const onResize = (): void => {
      overlay.width = overlay.clientWidth || overlay.width;
      overlay.height = overlay.clientHeight || overlay.height;
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      unbindWebGl?.();
      detachGlow?.();
      busRef.current?.stop();
      hornRef.current?.stop();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const horn = hornRef.current;
    if (!horn) {
      return;
    }
    const result = evaluateHornTrigger({
      wasCritical: wasHornCriticalRef.current,
      priority: advice?.priority,
      mustStop: advice?.mustStop,
    });
    wasHornCriticalRef.current = result.isCritical;
    setHornCritical(result.isCritical);

    if (result.action === 'STOP') {
      pendingHornBlastRef.current = false;
      horn.stop();
      setHornNote(null);
      return;
    }
    if (result.action !== 'BLAST') {
      return;
    }

    void horn
      .blastCritical()
      .then(() => {
        pendingHornBlastRef.current = false;
        setHornNote(null);
      })
      .catch((error: unknown) => {
        pendingHornBlastRef.current = true;
        const detail = error instanceof Error ? error.message : 'AudioContext zawieszony';
        setHornNote(`kliknij kabinę aby uzbroić klakson 880 Hz (${detail})`);
      });
  }, [advice?.priority, advice?.mustStop]);

  const armCabinHorn = (event: { target: EventTarget | null }): void => {
    if (event.target instanceof Element && event.target.closest('button')) {
      return;
    }
    const horn = hornRef.current;
    if (!horn) {
      return;
    }
    void (async () => {
      try {
        await horn.arm();
        if (pendingHornBlastRef.current) {
          await horn.blastCritical();
          pendingHornBlastRef.current = false;
          setHornNote(null);
        }
      } catch (error) {
        const detail =
          error instanceof HighwayHornError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'brak Web Audio';
        setHornNote(`kliknij kabinę aby uzbroić klakson 880 Hz (${detail})`);
      }
    })();
  };

  const panicDrain = (): void => {
    pendingHornBlastRef.current = false;
    wasHornCriticalRef.current = false;
    setHornCritical(false);
    setHornNote(null);
    hornRef.current?.stop();
    void boothRef.current?.exitBooth('PANIC_DRAIN_HUD');
    busRef.current?.drain('PANIC_DRAIN_HUD');
  };

  const degraded = audit?.activeRenderer !== 'MAPLIBRE_WEBGL';

  return (
    <div className="cockpit-root" onPointerDown={armCabinHorn}>
      <div ref={mapNode} className="cockpit-map" data-testid="map-pane" />
      <canvas
        ref={overlayNode}
        className={`cockpit-emergency ${degraded ? 'is-visible' : ''}`}
        data-testid="emergency-canvas"
      />
      <header className="cockpit-hud">
        <div className="hud-brand">
          <span className="hud-glyph">T</span>
          <div>
            <div className="hud-title">KABINA TAKTYCZNA</div>
            <div className="hud-sub">Jedna kabina · RFC 7946 · zero magii</div>
          </div>
        </div>
        <div className="hud-pills">
          <span className={`pill ${cabinState === 'OCCUPIED' ? 'ok' : 'warn'}`}>ŚLUZA {cabinState}</span>
          <span className={`pill ${audit?.gnssSource === 'LIVE_GNSS' ? 'ok' : 'warn'}`}>
            {audit ? sourceLabel(audit.gnssSource) : 'GNSS —'}
          </span>
          <span className={`pill ${audit?.screenFilled ? 'ok' : 'danger'}`}>
            {audit?.screenFilled ? 'EKRAN PEŁNY' : 'EKRAN?'}
          </span>
          <span className="pill">{audit?.degradationLevel ?? 'LEVEL_?'}</span>
          {hornCritical ? (
            <span className="pill horn" data-testid="highway-horn">
              KLAKSON 880 Hz
            </span>
          ) : null}
        </div>
        <button type="button" className="panic" onClick={panicDrain}>
          DRENAŻ
        </button>
      </header>
      <aside className="cockpit-readout">
        <div>{hardwareNote}</div>
        {audit && (
          <>
            <div>
              pozycja {audit.coordinate[1].toFixed(5)}°N {audit.coordinate[0].toFixed(5)}°E
            </div>
            <div>
              piksel pojazdu{' '}
              {audit.vehicleScreen
                ? `${audit.vehicleScreen.x.toFixed(1)}, ${audit.vehicleScreen.y.toFixed(1)}`
                : 'brak (kabina pusta)'}
            </div>
            <div>GeoJSON {audit.rfc7946Valid ? 'RFC 7946 OK' : 'NIEWAŻNY'}</div>
            <div>
              renderer {audit.activeRenderer}
              {audit.isDeadReckoning ? ' · DR' : ''}
            </div>
          </>
        )}
        {advice && (
          <div className={`advice advice-${advice.priority.toLowerCase()}`}>
            {copilotSource === 'LOCAL_EMERGENCY_INJECTION' ? 'WTRYSK LOKALNY' : 'CHMURA'} · {networkState} · {advice.priority} · {advice.headline}
          </div>
        )}
        {hornNote && <div className="hud-error">{hornNote}</div>}
        {errorText && <div className="hud-error">{errorText}</div>}
      </aside>
    </div>
  );
}

function isNightDuty(at: Date): boolean {
  const hour = at.getHours();
  return hour < 6 || hour >= 21;
}

function buildDutyRoute(coordinate: [number, number] | readonly number[], userId: string): RouteData {
  const [lon, lat] = coordinate;
  return {
    routeId: 'duty-live',
    userId,
    waypoints: [
      { id: 'wp-0', coordinate: [lon - 0.01, lat - 0.008], timestamp: Date.now() - 60_000 },
      { id: 'wp-1', coordinate: [lon, lat], timestamp: Date.now() },
    ],
    distanceMeters: 1200,
    durationSeconds: 90,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
