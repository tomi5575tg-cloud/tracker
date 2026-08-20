import { describe, it, expect } from 'vitest';
import { PoiGeoJsonConverter } from '../../src/poi/converter.js';
import { GeoJsonValidator } from '../../src/geojson/validator.js';
import { FUEL_STATION_CATEGORY } from '../../src/poi/defaultCategories.js';
import type { PoiItem } from '../../src/poi/types.js';
import type { UserSession } from '../../src/types.js';

describe('PoiGeoJsonConverter & RFC 7946 Compliance', () => {
  const samplePoi: PoiItem = {
    id: 'poi-fuel-01',
    categoryId: 'fuel_station',
    name: 'Orlen Stacja Paliw A2',
    description: 'Stacja przy autostradzie',
    coordinate: [20.5012, 52.1234], // [lon, lat]
    status: 'ACTIVE',
    attributes: {
      brand: 'Orlen',
      fuel_types: ['DIESEL', 'PB95', 'ADBLUE'],
      is_24h: true,
      gate_code: 'PIN-1234',
    },
    tags: ['fuel', 'highway'],
    createdBy: 'user-dispatcher',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
  };

  it('should generate valid RFC 7946 empty FeatureCollection', () => {
    const empty = PoiGeoJsonConverter.emptyGeoJson();
    expect(GeoJsonValidator.isRFC7946FeatureCollection(empty)).toBe(true);
    expect(empty.type).toBe('FeatureCollection');
    expect(empty.features).toHaveLength(0);
  });

  it('should convert PoiItem to Point Feature with category styling and RFC 7946 coordinates', () => {
    const feature = PoiGeoJsonConverter.toFeature(samplePoi, FUEL_STATION_CATEGORY);

    expect(feature).not.toBeNull();
    expect(feature!.type).toBe('Feature');
    expect(feature!.id).toBe('poi-fuel-01');
    expect(feature!.geometry.type).toBe('Point');
    expect(feature!.geometry.coordinates).toEqual([20.5012, 52.1234]);
    expect(feature!.properties.poiId).toBe('poi-fuel-01');
    expect(feature!.properties.categoryId).toBe('fuel_station');
    expect(feature!.properties.markerColor).toBe('#0288D1');
    expect(feature!.properties.iconName).toBe('fuel-station');
    expect(feature!.properties.name).toBe('Orlen Stacja Paliw A2');
  });

  it('should mask sensitive attributes when subject lacks POI_READ_SENSITIVE', () => {
    const driverSubject: UserSession = {
      sessionId: 'sess-driver',
      userId: 'driver-1',
      username: 'driver',
      token: 'token',
      loginTimestamp: 1700000000000,
      lastActiveTimestamp: 1700000000000,
      role: 'DRIVER',
    };

    const collection = PoiGeoJsonConverter.toFeatureCollection([samplePoi], {
      categories: [FUEL_STATION_CATEGORY],
      subject: driverSubject,
    });

    expect(GeoJsonValidator.isRFC7946FeatureCollection(collection)).toBe(true);
    expect(collection.features).toHaveLength(1);
    const feat = collection.features[0]!;

    expect(feat.properties.hasSensitiveDataMasked).toBe(true);
    expect(feat.properties.attributes['brand']).toBe('Orlen');
    expect(feat.properties.attributes['gate_code']).toBe('[CONFIDENTIAL / MASKED]');
  });

  it('should filter out invalid coordinates out of RFC 7946 WGS84 range', () => {
    const invalidPoi: PoiItem = {
      ...samplePoi,
      id: 'poi-invalid-coords',
      coordinate: [-200, 45], // Lon < -180
    };

    const collection = PoiGeoJsonConverter.toFeatureCollection([samplePoi, invalidPoi], {
      categories: [FUEL_STATION_CATEGORY],
    });

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]!.id).toBe('poi-fuel-01');
  });
});
