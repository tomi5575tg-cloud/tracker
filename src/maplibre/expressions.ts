/**
 * Type-safe Helper for MapLibre GL JS Expressions
 * Documentation: https://maplibre.org/maplibre-style-spec/expressions/
 */

export class MapLibreExpressions {
  /**
   * ['get', propertyName]
   */
  public static get(propertyName: string): ['get', string] {
    return ['get', propertyName];
  }

  /**
   * ['feature-state', stateKey]
   */
  public static featureState(stateKey: string): ['feature-state', string] {
    return ['feature-state', stateKey];
  }

  /**
   * ['has', propertyName]
   */
  public static has(propertyName: string): ['has', string] {
    return ['has', propertyName];
  }

  /**
   * ['coalesce', ...values]
   */
  public static coalesce(...values: unknown[]): unknown[] {
    return ['coalesce', ...values];
  }

  /**
   * ['case', condition1, output1, condition2, output2, ..., fallback]
   */
  public static caseCondition(
    condition: unknown,
    outputIfTrue: unknown,
    fallback: unknown
  ): unknown[] {
    return ['case', condition, outputIfTrue, fallback];
  }

  /**
   * Evaluates if feature has hover state active:
   * ['case', ['boolean', ['feature-state', 'hover'], false], hoverValue, defaultValue]
   */
  public static hoverState(hoverValue: unknown, defaultValue: unknown): unknown[] {
    return [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      hoverValue,
      defaultValue,
    ];
  }

  /**
   * Evaluates if feature has selected state active:
   * ['case', ['boolean', ['feature-state', 'selected'], false], selectedValue, defaultValue]
   */
  public static selectedState(selectedValue: unknown, defaultValue: unknown): unknown[] {
    return [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      selectedValue,
      defaultValue,
    ];
  }

  /**
   * Match expression for property value:
   * ['match', ['get', propertyName], caseVal1, outVal1, caseVal2, outVal2, ..., fallback]
   */
  public static matchProperty(
    propertyName: string,
    cases: Record<string | number, unknown>,
    fallback: unknown
  ): unknown[] {
    const expr: unknown[] = ['match', ['get', propertyName]];
    for (const [key, val] of Object.entries(cases)) {
      expr.push(key, val);
    }
    expr.push(fallback);
    return expr;
  }

  /**
   * Linear zoom interpolation for styling:
   * ['interpolate', ['linear'], ['zoom'], zoom1, val1, zoom2, val2, ...]
   */
  public static interpolateZoom(
    stops: Array<{ zoom: number; value: number }>,
    interpolation: 'linear' | 'exponential' = 'linear',
    base = 1
  ): unknown[] {
    if (stops.length < 2) {
      throw new Error('interpolateZoom requires at least 2 stops');
    }

    const interpType = interpolation === 'exponential' ? ['exponential', base] : ['linear'];
    const expr: unknown[] = ['interpolate', interpType, ['zoom']];

    const sorted = [...stops].sort((a, b) => a.zoom - b.zoom);
    for (const stop of sorted) {
      expr.push(stop.zoom, stop.value);
    }

    return expr;
  }

  /**
   * Step expression for cluster point counts:
   * ['step', ['get', 'point_count'], defaultVal, threshold1, val1, threshold2, val2, ...]
   */
  public static clusterStep(
    defaultVal: unknown,
    thresholds: Array<{ count: number; value: unknown }>
  ): unknown[] {
    const expr: unknown[] = ['step', ['get', 'point_count'], defaultVal];
    const sorted = [...thresholds].sort((a, b) => a.count - b.count);

    for (const item of sorted) {
      expr.push(item.count, item.value);
    }

    return expr;
  }

  /**
   * Standard cluster circle colors based on point count
   */
  public static clusterColor(
    smallColor = '#51bbd6',
    mediumColor = '#f1f075',
    largeColor = '#f28cb1'
  ): unknown[] {
    return this.clusterStep(smallColor, [
      { count: 10, value: mediumColor },
      { count: 50, value: largeColor },
    ]);
  }

  /**
   * Standard cluster circle radius based on point count
   */
  public static clusterRadius(smallRadius = 15, mediumRadius = 22, largeRadius = 30): unknown[] {
    return this.clusterStep(smallRadius, [
      { count: 10, value: mediumRadius },
      { count: 50, value: largeRadius },
    ]);
  }
}
