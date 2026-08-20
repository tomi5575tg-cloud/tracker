import type { Position } from '../geojson/types.js';
import { isValidCoordinate } from '../geojson/types.js';
import { GeoJsonValidator } from '../geojson/validator.js';
import type { Feature, PointGeometry } from '../geojson/types.js';
import type { AuthLockBooth } from '../auth/authBooth.js';
import type { SessionDrainHook } from '../auth/drainManager.js';
import type { UserSession } from '../types.js';
import type { FaultTolerantMeshSupervisor } from '../resilience/faultTolerantMesh.js';
import type { EmergencyRenderer } from '../resilience/emergencyRenderer.js';
import type { MeshDegradationLevel } from '../resilience/types.js';
import type { InertialMotionReading } from '../resilience/types.js';
import { PixelFrameBuffer } from '../pixel/frameBuffer.js';
import type { PixelAudit } from '../pixel/frameBuffer.js';
import type { ScreenPoint } from '../pixel/projection.js';
import type { GnssFix, GnssSourceKind } from '../hardware/types.js';
import { CabinEmptyError, OccupantMismatchError } from './errors.js';

export interface VehicleGeoJsonProperties {
  readonly userId: string;
  readonly sessionId: string;
  readonly gnssSource: GnssSourceKind;
  readonly headingDeg: number;
  readonly speedKmh: number;
  readonly isDeadReckoning: boolean;
  readonly timestamp: number;
}

export type VehiclePointFeature = Feature<PointGeometry, VehicleGeoJsonProperties>;

export interface WeldAudit {
  readonly cabinOccupied: boolean;
  readonly sessionUserId: string | null;
  readonly gnssSource: GnssSourceKind;
  readonly degradationLevel: MeshDegradationLevel;
  readonly activeRenderer: 'MAPLIBRE_WEBGL' | 'EMERGENCY_2D_CANVAS' | 'FALLBACK_SVG';
  readonly vehicleScreen: ScreenPoint | null;
  readonly vehicleGeoJson: VehiclePointFeature;
  readonly rfc7946Valid: boolean;
  readonly screenFilled: boolean;
  readonly isDeadReckoning: boolean;
  readonly coordinate: Position;
  readonly pixel: PixelAudit;
  readonly timestamp: number;
}

export interface HardwareToPixelPipelineConfig {
  readonly booth: AuthLockBooth;
  readonly mesh: FaultTolerantMeshSupervisor;
  readonly renderer: EmergencyRenderer;
  readonly frameBuffer?: PixelFrameBuffer | undefined;
  readonly frameWidth?: number | undefined;
  readonly frameHeight?: number | undefined;
}

/**
 * The weld: GNSS/IMU → Jedna Kabina → mesh degradation → RFC 7946 GeoJSON → cabin pixels.
 * Every hop either produces an audit or throws. No silent catch. No fake WebGL success.
 */
export class HardwareToPixelPipeline implements SessionDrainHook {
  private readonly booth: AuthLockBooth;
  private readonly mesh: FaultTolerantMeshSupervisor;
  private readonly renderer: EmergencyRenderer;
  private readonly frameBuffer: PixelFrameBuffer;
  private readonly frameWidth: number;
  private readonly frameHeight: number;

  private lastSource: GnssSourceKind = 'LAST_KNOWN';
  private lastAudit: WeldAudit | null = null;

  constructor(config: HardwareToPixelPipelineConfig) {
    this.booth = config.booth;
    this.mesh = config.mesh;
    this.renderer = config.renderer;
    this.frameBuffer = config.frameBuffer ?? new PixelFrameBuffer();
    this.frameWidth = config.frameWidth ?? 800;
    this.frameHeight = config.frameHeight ?? 600;

    this.booth.registerDrainHook(this);
    this.booth.registerDrainHook(this.mesh);
  }

  public getFrameBuffer(): PixelFrameBuffer {
    return this.frameBuffer;
  }

  public getLastAudit(): WeldAudit | null {
    return this.lastAudit;
  }

  public ingestFix(fix: GnssFix, occupantUserId?: string): WeldAudit {
    const session = this.requireOccupiedCabin('ingest GNSS fix');
    if (occupantUserId !== undefined && session.userId !== occupantUserId) {
      throw new OccupantMismatchError(session.userId, occupantUserId);
    }
    if (!isValidCoordinate(fix.coordinate)) {
      throw new Error('GNSS fix coordinate is not valid WGS84 / RFC 7946');
    }

    this.lastSource = fix.source;
    this.mesh.updateGps(fix.coordinate, fix.speedKmh, fix.headingDeg, fix.timestamp);
    return this.paint(session);
  }

  public ingestInertial(reading: InertialMotionReading): WeldAudit {
    const session = this.requireOccupiedCabin('ingest IMU');
    this.lastSource = 'INERTIAL_DEAD_RECKONING';
    this.mesh.getDeadReckoningEngine().updateInertialReading(reading);
    this.mesh.reportGpsLoss('IMU_COAST');
    return this.paint(session);
  }

  public notifyWebGlContextLost(reason = 'WEBGL_CONTEXT_LOST'): WeldAudit {
    this.mesh.reportWebGlContextLoss(reason);
    const session = this.booth.getSession();
    if (!session) {
      const pixel = this.frameBuffer.paintEmptyCabin(this.frameWidth, this.frameHeight, reason);
      return this.auditFromEmpty(pixel, reason);
    }
    return this.paint(session);
  }

  public notifyWebGlContextRestored(): WeldAudit {
    this.mesh.reportWebGlContextRestored();
    const session = this.booth.getSession();
    if (!session) {
      const pixel = this.frameBuffer.paintEmptyCabin(this.frameWidth, this.frameHeight, 'WEBGL_RESTORED_EMPTY_CABIN');
      return this.auditFromEmpty(pixel, 'WEBGL_RESTORED_EMPTY_CABIN');
    }
    return this.paint(session);
  }

  public paint(session: UserSession): WeldAudit {
    const frame = this.mesh.getEmergencyFrame(this.frameWidth, this.frameHeight);
    const canvas = this.renderer.getCanvasElement();
    if (canvas) {
      this.renderer.renderToCanvas(canvas, frame);
    }
    const pixel = this.frameBuffer.paint(frame);
    this.mesh.markEmergencyPaintSucceeded();
    const summary = this.mesh.getStatusSummary();
    const vehicleGeoJson = this.toVehicleFeature(session, frame.currentPosition, summary.deadReckoning.isExtrapolating);
    const rfc7946Valid = GeoJsonValidator.isValidFeature(vehicleGeoJson);

    const audit: WeldAudit = {
      cabinOccupied: true,
      sessionUserId: session.userId,
      gnssSource: summary.deadReckoning.isExtrapolating ? 'INERTIAL_DEAD_RECKONING' : this.lastSource,
      degradationLevel: summary.overallLevel,
      activeRenderer: summary.activeRenderer,
      vehicleScreen: pixel.vehicleScreen,
      vehicleGeoJson,
      rfc7946Valid,
      screenFilled: pixel.screenFilled && summary.isScreenSafe,
      isDeadReckoning: summary.deadReckoning.isExtrapolating,
      coordinate: frame.currentPosition,
      pixel,
      timestamp: Date.now(),
    };

    if (!audit.rfc7946Valid) {
      throw new Error('Vehicle GeoJSON failed RFC 7946 validation');
    }

    this.lastAudit = audit;
    return audit;
  }

  public drain(reason = 'PIPELINE_DRAIN', _previousSession?: unknown): void {
    this.lastSource = 'LAST_KNOWN';
    this.frameBuffer.paintEmptyCabin(this.frameWidth, this.frameHeight, reason);
    this.lastAudit = this.auditFromEmpty(this.frameBuffer.audit(), reason);
  }

  private requireOccupiedCabin(operation: string): UserSession {
    const session = this.booth.getSession();
    const status = this.booth.getStatus();
    if (!session || status.state !== 'OCCUPIED') {
      throw new CabinEmptyError(operation);
    }
    return session;
  }

  private toVehicleFeature(
    session: UserSession,
    coordinate: Position,
    isDeadReckoning: boolean
  ): VehiclePointFeature {
    const heading = this.mesh.getStatusSummary().deadReckoning.currentHeadingDeg;
    const speed = this.mesh.getStatusSummary().deadReckoning.currentSpeedKmh;
    return {
      type: 'Feature',
      id: `vehicle:${session.userId}`,
      geometry: {
        type: 'Point',
        coordinates: [coordinate[0], coordinate[1]],
      },
      properties: {
        userId: session.userId,
        sessionId: session.sessionId,
        gnssSource: isDeadReckoning ? 'INERTIAL_DEAD_RECKONING' : this.lastSource,
        headingDeg: heading,
        speedKmh: speed,
        isDeadReckoning,
        timestamp: Date.now(),
      },
    };
  }

  private auditFromEmpty(pixel: PixelAudit, _reason: string): WeldAudit {
    const summary = this.mesh.getStatusSummary();
    const emptyFeature: VehiclePointFeature = {
      type: 'Feature',
      id: 'vehicle:empty',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {
        userId: '',
        sessionId: '',
        gnssSource: 'LAST_KNOWN',
        headingDeg: 0,
        speedKmh: 0,
        isDeadReckoning: false,
        timestamp: Date.now(),
      },
    };
    const audit: WeldAudit = {
      cabinOccupied: false,
      sessionUserId: null,
      gnssSource: 'LAST_KNOWN',
      degradationLevel: summary.overallLevel,
      activeRenderer: summary.activeRenderer,
      vehicleScreen: null,
      vehicleGeoJson: emptyFeature,
      rfc7946Valid: true,
      screenFilled: pixel.screenFilled,
      isDeadReckoning: false,
      coordinate: [0, 0],
      pixel,
      timestamp: Date.now(),
    };
    this.lastAudit = audit;
    this.mesh.markEmergencyPaintSucceeded();
    return audit;
  }
}
