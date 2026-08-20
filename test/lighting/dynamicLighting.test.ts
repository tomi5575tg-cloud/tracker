import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CelestialCalculator } from '../../src/lighting/celestialCalculator.js';
import { DynamicLightingManager } from '../../src/lighting/dynamicLightingManager.js';
import type {
  MapLibreMapInstance,
  MapLibreLightSpecification,
  MapLibreLayerSpecification,
} from '../../src/maplibre/types.js';
import type { Position } from '../../src/geojson/types.js';

class MockLightingMap implements MapLibreMapInstance {
  public currentLight?: MapLibreLightSpecification;
  public paintProperties = new Map<string, Record<string, unknown>>();
  private layers = new Map<string, MapLibreLayerSpecification>();

  constructor() {
    // Add mock 3D Hillshade & Building layers
    this.layers.set('tracker-terrain-hillshade', {
      id: 'tracker-terrain-hillshade',
      type: 'hillshade',
      source: 'terrain-dem',
    });
    this.layers.set('tracker-3d-buildings', {
      id: 'tracker-3d-buildings',
      type: 'fill-extrusion',
      source: 'composite',
    });
  }

  public getSource(): any {
    return undefined;
  }
  public addSource(): void {}
  public removeSource(): void {}

  public getLayer(id: string): unknown | undefined {
    return this.layers.get(id);
  }
  public addLayer(layer: MapLibreLayerSpecification): void {
    this.layers.set(layer.id, layer);
  }
  public removeLayer(id: string): void {
    this.layers.delete(id);
  }

  public setLayoutProperty(): void {}

  public setPaintProperty(layerId: string, name: string, value: unknown): void {
    const existing = this.paintProperties.get(layerId) ?? {};
    existing[name] = value;
    this.paintProperties.set(layerId, existing);
  }

  public setLight(light: MapLibreLightSpecification): void {
    this.currentLight = light;
  }

  public getLight(): MapLibreLightSpecification | undefined {
    return this.currentLight;
  }

  public isStyleLoaded(): boolean {
    return true;
  }

  public once(): void {}
  public on(): void {}
  public off(): void {}
}

describe('Dynamic Lighting Module (Księżyc vs Słońce)', () => {
  const warsaw: Position = [21.0122, 52.2297];

  describe('CelestialCalculator (Solar & Lunar Ephemeris)', () => {
    it('should calculate Julian Date correctly', () => {
      // Jan 1, 2000, 12:00 UTC = 2451545.0 JD
      const jd = CelestialCalculator.toJulianDate(Date.UTC(2000, 0, 1, 12, 0, 0));
      expect(jd).toBeCloseTo(2451545.0, 4);
    });

    it('should calculate daylight solar elevation at noon in summer', () => {
      // June 21, 2026, 12:00 Local Time (~10:40 UTC in Warsaw)
      const summerNoon = Date.UTC(2026, 5, 21, 10, 40, 0);
      const sun = CelestialCalculator.calculateSun(warsaw, summerNoon);

      expect(sun.isDaylight).toBe(true);
      expect(sun.position.altitudeDegrees).toBeGreaterThan(50); // High sun in Poland
      expect(sun.phase).toBe('DAY');
      expect(sun.solarNoonTimestamp).toBeGreaterThan(0);
    });

    it('should calculate night time solar elevation and civil dusk at midnight', () => {
      // Dec 21, 2026, 23:00 UTC (Midnight in Warsaw)
      const winterMidnight = Date.UTC(2026, 11, 21, 23, 0, 0);
      const sun = CelestialCalculator.calculateSun(warsaw, winterMidnight);

      expect(sun.isDaylight).toBe(false);
      expect(sun.position.altitudeDegrees).toBeLessThan(0);
      expect(sun.phase).toBe('NIGHT');
    });

    it('should calculate lunar phase, age and illumination fraction', () => {
      const now = Date.now();
      const moon = CelestialCalculator.calculateMoon(warsaw, now);

      expect(moon.ageDays).toBeGreaterThanOrEqual(0);
      expect(moon.ageDays).toBeLessThanOrEqual(29.54);
      expect(moon.illuminatedFraction).toBeGreaterThanOrEqual(0);
      expect(moon.illuminatedFraction).toBeLessThanOrEqual(1.0);
      expect(moon.phaseName).toBeDefined();
    });
  });

  describe('DynamicLightingManager (MapLibre Light & 3D Shading Synchronization)', () => {
    let mockMap: MockLightingMap;

    beforeEach(() => {
      mockMap = new MockLightingMap();
    });

    it('should initialize and apply noon solar lighting to MapLibre map', () => {
      // Summer noon
      const noonTime = Date.UTC(2026, 5, 21, 10, 40, 0);
      const manager = new DynamicLightingManager(mockMap, {
        observerCoordinate: warsaw,
        customTimestamp: noonTime,
      });

      const state = manager.getState();
      expect(state.dominantBody).toBe('SUN');
      expect(state.lightSpecification.anchor).toBe('map');
      expect(state.lightSpecification.intensity).toBeGreaterThanOrEqual(0.7);

      // Verify applied to mock map
      expect(mockMap.currentLight).toBeDefined();
      expect(mockMap.currentLight?.intensity).toBe(state.lightSpecification.intensity);

      // 3D Hillshade paint properties updated
      const hillshadeProps = mockMap.paintProperties.get('tracker-terrain-hillshade');
      expect(hillshadeProps).toBeDefined();
      expect(hillshadeProps?.['hillshade-illumination-direction']).toBeDefined();
    });

    it('should transition to Moon night light with lunar color and ambient shading at midnight', () => {
      // Midnight
      const midnightTime = Date.UTC(2026, 5, 21, 23, 0, 0);
      const manager = new DynamicLightingManager(mockMap, {
        observerCoordinate: warsaw,
        customTimestamp: midnightTime,
      });

      const state = manager.getState();
      expect(state.dominantBody).toBe('MOON');
      expect(state.terrainExaggeration).toBe(1.25); // Higher relief at night

      // 3D Building extrusion dark shading
      const buildingProps = mockMap.paintProperties.get('tracker-3d-buildings');
      expect(buildingProps?.['fill-extrusion-color']).toBe('#1A233A');
    });

    it('should advance hours and notify onLightingChange subscribers', () => {
      const onLightChangeSpy = vi.fn();
      const startTime = Date.UTC(2026, 5, 21, 10, 0, 0);

      const manager = new DynamicLightingManager(mockMap, {
        observerCoordinate: warsaw,
        customTimestamp: startTime,
        onLightingChange: onLightChangeSpy,
      });

      expect(manager.getState().dominantBody).toBe('SUN');

      // Fast forward 14 hours (from 10:00 to 00:00)
      const nextState = manager.advanceHours(14);
      expect(nextState.dominantBody).toBe('MOON');
      expect(onLightChangeSpy).toHaveBeenCalled();
    });

    it('should support time simulation loop with multiplier and timer controls', () => {
      vi.useFakeTimers();

      const manager = new DynamicLightingManager(mockMap, {
        observerCoordinate: warsaw,
        updateIntervalMs: 1000,
        simulatedTimeMultiplier: 3600, // 1 hour per real-time second
      });

      expect(manager.isTimerActive()).toBe(true);

      vi.advanceTimersByTime(5000); // 5 simulated hours pass

      manager.stopTimer();
      expect(manager.isTimerActive()).toBe(false);

      vi.useRealTimers();
    });

    it('should execute Session Drain and reset simulated time on drain()', () => {
      const manager = new DynamicLightingManager(mockMap, {
        observerCoordinate: warsaw,
        updateIntervalMs: 1000,
      });

      manager.advanceHours(8);
      expect(manager.isTimerActive()).toBe(true);

      // Drain session
      manager.drain('SESSION_LOGOUT');
      expect(manager.isTimerActive()).toBe(false);
    });
  });
});
