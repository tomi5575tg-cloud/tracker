import { describe, it, expect } from 'vitest';
import { MapLibreExpressions } from '../../src/maplibre/expressions.js';

describe('MapLibreExpressions (Type-Safe Style Expressions Helper)', () => {
  it('should generate get expression', () => {
    expect(MapLibreExpressions.get('categoryCode')).toEqual(['get', 'categoryCode']);
  });

  it('should generate feature-state expression', () => {
    expect(MapLibreExpressions.featureState('hover')).toEqual(['feature-state', 'hover']);
  });

  it('should generate hover state case expression', () => {
    const expr = MapLibreExpressions.hoverState(1.5, 1.0);
    expect(expr).toEqual([
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      1.5,
      1.0,
    ]);
  });

  it('should generate selected state case expression', () => {
    const expr = MapLibreExpressions.selectedState('#FF0000', '#0000FF');
    expect(expr).toEqual([
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      '#FF0000',
      '#0000FF',
    ]);
  });

  it('should generate match property expression', () => {
    const expr = MapLibreExpressions.matchProperty(
      'status',
      { ACTIVE: '#4CAF50', INACTIVE: '#9E9E9E', ARCHIVED: '#E91E63' },
      '#000000'
    );
    expect(expr).toEqual([
      'match',
      ['get', 'status'],
      'ACTIVE',
      '#4CAF50',
      'INACTIVE',
      '#9E9E9E',
      'ARCHIVED',
      '#E91E63',
      '#000000',
    ]);
  });

  it('should generate zoom interpolation expression', () => {
    const expr = MapLibreExpressions.interpolateZoom([
      { zoom: 5, value: 2 },
      { zoom: 10, value: 5 },
      { zoom: 15, value: 12 },
    ]);

    expect(expr).toEqual(['interpolate', ['linear'], ['zoom'], 5, 2, 10, 5, 15, 12]);
  });

  it('should generate cluster step color and radius expressions', () => {
    const colorExpr = MapLibreExpressions.clusterColor('#00BCD4', '#FFEB3B', '#F44336');
    expect(colorExpr).toEqual([
      'step',
      ['get', 'point_count'],
      '#00BCD4',
      10,
      '#FFEB3B',
      50,
      '#F44336',
    ]);

    const radiusExpr = MapLibreExpressions.clusterRadius(12, 18, 25);
    expect(radiusExpr).toEqual([
      'step',
      ['get', 'point_count'],
      12,
      10,
      18,
      50,
      25,
    ]);
  });
});
