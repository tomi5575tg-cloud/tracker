import { describe, it, expect, vi } from 'vitest';
import {
  TacticalBottomSheetController,
  type TacticalSnapPoint,
} from '../../components/TacticalBottomSheet.js';
import type { PoiItem, PoiCategory } from '../../src/poi/types.js';
import type { RouteData } from '../../src/types.js';

describe('TacticalBottomSheetController (Components / Tactical UI)', () => {
  const samplePoi: PoiItem = {
    id: 'poi-radar-01',
    categoryId: 'fuel_station',
    name: 'Cyber Station Alpha',
    coordinate: [21.0, 52.0],
    status: 'ACTIVE',
    attributes: { brand: 'Orlen Cyber', fuel_types: ['EV_FAST'] },
    createdBy: 'disp-1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  const sampleCategory: PoiCategory = {
    id: 'fuel_station',
    code: 'FUEL',
    name: 'Stacja Paliw i EV',
    classification: 'SYSTEM',
    status: 'ACTIVE',
    style: { markerColor: '#00F0FF', iconName: 'fuel-station' },
    attributesSchema: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  it('should initialize with default state and PEEK snap point', () => {
    const sheet = new TacticalBottomSheetController();
    const state = sheet.getState();

    expect(state.snapPoint).toBe('PEEK');
    expect(state.isVisible).toBe(true);
    expect(state.activeTab).toBe('RADAR_POI');
    expect(state.selectedPoi).toBeNull();
    expect(state.currentHeightPx).toBe(84);
  });

  it('should transition between snap points and notify subscribers', () => {
    const onSnapSpy = vi.fn();
    const sheet = new TacticalBottomSheetController({
      onSnapChange: onSnapSpy,
    });

    const states: TacticalSnapPoint[] = [];
    sheet.subscribe((st) => states.push(st.snapPoint));

    sheet.setSnapPoint('HALF');
    expect(sheet.getState().snapPoint).toBe('HALF');
    expect(sheet.getState().currentHeightPx).toBe(360); // 800 * 0.45
    expect(onSnapSpy).toHaveBeenCalledWith('HALF');

    sheet.setSnapPoint('EXPANDED');
    expect(sheet.getState().snapPoint).toBe('EXPANDED');
    expect(sheet.getState().currentHeightPx).toBe(704); // 800 * 0.88

    sheet.setSnapPoint('HIDDEN');
    expect(sheet.getState().snapPoint).toBe('HIDDEN');
    expect(sheet.getState().isVisible).toBe(false);
    expect(sheet.getState().currentHeightPx).toBe(0);
  });

  it('should inspect selected POI and update header view model', () => {
    const onSelectSpy = vi.fn();
    const sheet = new TacticalBottomSheetController({
      onPoiSelected: onSelectSpy,
    });

    sheet.selectPoi(samplePoi, sampleCategory);

    expect(sheet.getState().selectedPoi?.id).toBe('poi-radar-01');
    expect(onSelectSpy).toHaveBeenCalledWith(samplePoi);

    const header = sheet.getHeaderViewModel();
    expect(header.title).toBe('Cyber Station Alpha');
    expect(header.subtitle).toBe('Stacja Paliw i EV');
    expect(header.statusText).toBe('ACTIVE');
    expect(header.statusBadgeColor).toBe('#00FF9F');
  });

  it('should bind active route telemetry to header view model', () => {
    const sheet = new TacticalBottomSheetController();
    const sampleRoute: RouteData = {
      routeId: 'TR-777',
      userId: 'driver-1',
      distanceMeters: 45000,
      durationSeconds: 2700,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      waypoints: [],
    };

    sheet.setRoute(sampleRoute);
    const header = sheet.getHeaderViewModel();

    expect(header.title).toContain('TR-777');
    expect(header.subtitle).toContain('45.0 km');
    expect(header.statusText).toBe('AKTYWNA');
  });

  it('should handle gesture drag and velocity-assisted snapping', () => {
    const sheet = new TacticalBottomSheetController();

    // Start drag at y=500
    sheet.handleDragStart(500);
    expect(sheet.getState().isDragging).toBe(true);

    // Drag upwards by 200px (to y=300)
    sheet.handleDragMove(300);
    expect(sheet.getState().currentHeightPx).toBe(284); // 84 + 200

    // Release with upward velocity (-1.0) -> Snaps to HALF or EXPANDED
    sheet.handleDragEnd(-1.0);
    expect(sheet.getState().isDragging).toBe(false);
    expect(sheet.getState().snapPoint).toBe('HALF');
  });

  it('should generate CSS container and handle styles with neon accents', () => {
    const sheet = new TacticalBottomSheetController();
    const containerStyles = sheet.getContainerStyles();
    const handleStyles = sheet.getHandleStyles();

    expect(containerStyles.position).toBe('absolute');
    expect(containerStyles.backgroundColor).toBe('#0B0F19');
    expect(containerStyles.borderTop).toContain('rgba(0, 240, 255');
    expect(handleStyles.cursor).toBe('grab');
  });

  it('should execute Session Drain and wipe state on user switch/drain', () => {
    const onDrainedSpy = vi.fn();
    const sheet = new TacticalBottomSheetController({
      onDrained: onDrainedSpy,
    });

    sheet.selectPoi(samplePoi, sampleCategory);
    sheet.setSnapPoint('EXPANDED');

    expect(sheet.getState().selectedPoi).not.toBeNull();

    // Trigger Session Drain
    sheet.drain('SWITCH_USER');

    expect(sheet.getState().snapPoint).toBe('HIDDEN');
    expect(sheet.getState().isVisible).toBe(false);
    expect(sheet.getState().selectedPoi).toBeNull();
    expect(sheet.getState().activeRoute).toBeNull();
    expect(onDrainedSpy).toHaveBeenCalledWith('SWITCH_USER');
  });
});
