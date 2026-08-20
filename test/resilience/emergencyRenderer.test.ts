import { describe, it, expect } from 'vitest';
import { EmergencyRenderer } from '../../src/resilience/emergencyRenderer.js';
import type { EmergencyRenderFrame } from '../../src/resilience/types.js';

describe('EmergencyRenderer', () => {
  it('should render complete standalone SVG frame without throwing during WebGL outage', () => {
    const renderer = new EmergencyRenderer();

    const frame: EmergencyRenderFrame = {
      width: 800,
      height: 600,
      center: [21.0122, 52.2297],
      heading: 45,
      zoom: 13,
      currentPosition: [21.0122, 52.2297],
      isDeadReckoning: false,
      activeRoute: {
        routeId: 'rt_emergency',
        userId: 'u1',
        waypoints: [
          { id: 'w1', coordinate: [21.01, 52.22], timestamp: 1000 },
          { id: 'w2', coordinate: [21.02, 52.23], timestamp: 2000 },
        ],
        distanceMeters: 2500,
        durationSeconds: 120,
        createdAt: 1000,
        updatedAt: 1000,
      },
      nearbyPois: [
        {
          id: 'poi_1',
          categoryId: 'fuel_station',
          name: 'Emergency Station',
          coordinate: [21.015, 52.225],
          status: 'ACTIVE',
          attributes: {},
          tags: [],
          createdBy: 'u1',
          createdAt: 1000,
          updatedAt: 1000,
          version: 1,
        },
      ],
      degradationLevel: 'LEVEL_3_MAP_RENDER_LOST',
      healthReports: [],
    };

    const svg = renderer.renderSvgFrame(frame);

    expect(svg).toContain('<svg');
    expect(svg).toContain('LEVEL_3_MAP_RENDER_LOST');
    expect(svg).toContain('#FFD700'); // Golden Thread
    expect(svg).toContain('Emergency Station'); // POI
    expect(svg).toContain('rotate(45)'); // Vehicle Heading
  });
});
