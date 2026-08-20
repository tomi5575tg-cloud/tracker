import type {
  MapLibreLayerSpecification,
  MapLibreMapInstance,
} from './types.js';
import { MapLibreExpressions } from './expressions.js';

/**
 * Paleta Kolorów Neonowej Poświaty (Neon Glow & Cyberpunk / Gold Luxury Theme)
 */
export const NEON_GLOW_THEME = Object.freeze({
  // Złota Nitka (Golden Thread)
  goldenCore: '#FFF8E7', // Super jasny rdzeń (biało-złoty)
  goldenMid: '#FFD700',  // Głębokie nasycone złoto (Gold)
  goldenGlow: '#FFB300', // Bursztynowa poświata zewnętrzna (Amber Glow)
  goldenShadow: 'rgba(255, 179, 0, 0.25)', // Rozmycie tła

  // Radar POI (Neon Cyberpunk Radar)
  radarPulseOuter: 'rgba(0, 240, 255, 0.2)', // Zewnętrzny pierścień fali radaru (Cyan Glow)
  radarPulseMid: 'rgba(0, 240, 255, 0.45)',  // Środkowy pierścień
  radarCore: '#00F0FF',                      // Neonowy błękit / Cyan rdzeń
  radarCenterDot: '#FFFFFF',                 // Biały punkt skupienia

  // Alternatywne akcenty statusów POI
  hazardGlow: 'rgba(255, 0, 85, 0.4)', // Neonowy karmazyn / Hazard
  activeGlow: 'rgba(0, 255, 159, 0.4)', // Neonowa zieleń / Active
});

export interface GoldenThreadLayerConfig {
  readonly routeSourceId?: string | undefined;
  readonly baseLayerId?: string | undefined;
  readonly outerGlowLayerId?: string | undefined;
  readonly midGlowLayerId?: string | undefined;
  readonly coreLineLayerId?: string | undefined;
  readonly pulseGlow?: boolean | undefined;
  readonly coreColor?: string | undefined;
  readonly midColor?: string | undefined;
  readonly glowColor?: string | undefined;
}

export interface PoiRadarLayerConfig {
  readonly poiSourceId?: string | undefined;
  readonly radarOuterLayerId?: string | undefined;
  readonly radarMidLayerId?: string | undefined;
  readonly radarCoreLayerId?: string | undefined;
  readonly radarCenterDotLayerId?: string | undefined;
  readonly radarLabelLayerId?: string | undefined;
  readonly radarColor?: string | undefined;
  readonly pulseColor?: string | undefined;
}

export interface MapGlowLayersConfig {
  readonly routeSourceId?: string | undefined;
  readonly poiSourceId?: string | undefined;
  readonly goldenThread?: Partial<GoldenThreadLayerConfig> | undefined;
  readonly poiRadar?: Partial<PoiRadarLayerConfig> | undefined;
}

/**
 * 1. Tworzenie Warstw Złotej Nitki (Golden Thread Multi-Layer Neon Glow)
 * 
 * Składa się z 3 nakładających się warstw optycznych:
 * - Warstwa 1 (Outer Amber Glow): Szeroka, rozmyta poświata z dużym `line-blur`
 * - Warstwa 2 (Mid Gold Radiant): Nasycona, średnia linia ze złotym odcieniem
 * - Warstwa 3 (Inner Core Thread): Cienka, ostra, biało-złota nitka centralna
 */
export function createGoldenThreadLayers(
  config: GoldenThreadLayerConfig = {}
): MapLibreLayerSpecification[] {
  const source = config.routeSourceId ?? 'tracker-route-source';
  const outerId = config.outerGlowLayerId ?? 'tracker-route-golden-outer-glow';
  const midId = config.midGlowLayerId ?? 'tracker-route-golden-mid-glow';
  const coreId = config.coreLineLayerId ?? 'tracker-route-golden-core-line';

  const coreColor = config.coreColor ?? NEON_GLOW_THEME.goldenCore;
  const midColor = config.midColor ?? NEON_GLOW_THEME.goldenMid;
  const glowColor = config.glowColor ?? NEON_GLOW_THEME.goldenGlow;

  // 1. Zewnętrzna Poświata (Outer Glow)
  const outerGlowLayer: MapLibreLayerSpecification = {
    id: outerId,
    type: 'line',
    source,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': glowColor,
      'line-width': MapLibreExpressions.interpolateZoom([
        { zoom: 4, value: 6 },
        { zoom: 10, value: 14 },
        { zoom: 16, value: 24 },
      ]),
      'line-blur': MapLibreExpressions.interpolateZoom([
        { zoom: 4, value: 4 },
        { zoom: 10, value: 8 },
        { zoom: 16, value: 14 },
      ]),
      'line-opacity': 0.75,
    },
  };

  // 2. Środkowa Złota Radiant Line (Mid Glow)
  const midGlowLayer: MapLibreLayerSpecification = {
    id: midId,
    type: 'line',
    source,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': midColor,
      'line-width': MapLibreExpressions.interpolateZoom([
        { zoom: 4, value: 3 },
        { zoom: 10, value: 7 },
        { zoom: 16, value: 12 },
      ]),
      'line-blur': 1.5,
      'line-opacity': 0.9,
    },
  };

  // 3. Centralny Jasny Rdzeń (Core Thread)
  const coreLineLayer: MapLibreLayerSpecification = {
    id: coreId,
    type: 'line',
    source,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': coreColor,
      'line-width': MapLibreExpressions.interpolateZoom([
        { zoom: 4, value: 1.5 },
        { zoom: 10, value: 3 },
        { zoom: 16, value: 5 },
      ]),
      'line-opacity': 1.0,
    },
  };

  return [outerGlowLayer, midGlowLayer, coreLineLayer];
}

/**
 * 2. Tworzenie Warstw Punktów Radaru POI (POI Radar Pulses & Glowing Halos)
 * 
 * Składa się z wielopoziomowych kręgów:
 * - Warstwa 1 (Outer Radar Wave): Rozmyty pierścień emitujący fale skanowania radaru
 * - Warstwa 2 (Mid Halo Ring): Dynamiczny obrys z wyróżnieniem stanu hover/selected
 * - Warstwa 3 (Core Pin): Neonowy punkt w kolorze kategorii lub akcentu radaru
 * - Warstwa 4 (Center Hotspot): Punkt skupienia / biały blask
 * - Warstwa 5 (Neon Glow Symbol Label): Etykieta tekstowa z neonowym halo
 */
export function createPoiRadarLayers(
  config: PoiRadarLayerConfig = {}
): MapLibreLayerSpecification[] {
  const source = config.poiSourceId ?? 'tracker-poi-source';
  const outerId = config.radarOuterLayerId ?? 'tracker-poi-radar-outer-wave';
  const midId = config.radarMidLayerId ?? 'tracker-poi-radar-mid-ring';
  const coreId = config.radarCoreLayerId ?? 'tracker-poi-radar-core-circle';
  const dotId = config.radarCenterDotLayerId ?? 'tracker-poi-radar-center-dot';
  const labelId = config.radarLabelLayerId ?? 'tracker-poi-radar-symbols';

  const defaultPulseColor = config.pulseColor ?? NEON_GLOW_THEME.radarPulseOuter;
  const defaultCoreColor = config.radarColor ?? NEON_GLOW_THEME.radarCore;

  // 1. Zewnętrzna Fala Radaru (Outer Radar Wave)
  const outerWaveLayer: MapLibreLayerSpecification = {
    id: outerId,
    type: 'circle',
    source,
    paint: {
      'circle-radius': MapLibreExpressions.caseCondition(
        ['boolean', ['feature-state', 'hover'], false],
        28,
        MapLibreExpressions.interpolateZoom([
          { zoom: 4, value: 12 },
          { zoom: 10, value: 18 },
          { zoom: 16, value: 26 },
        ])
      ),
      'circle-color': MapLibreExpressions.coalesce(
        ['get', 'pulseColor'],
        ['get', 'markerColor'],
        defaultPulseColor
      ),
      'circle-blur': 0.8,
      'circle-opacity': MapLibreExpressions.caseCondition(
        ['boolean', ['feature-state', 'hover'], false],
        0.85,
        0.45
      ),
    },
  };

  // 2. Środkowy Pierścień Radaru (Mid Halo Ring)
  const midRingLayer: MapLibreLayerSpecification = {
    id: midId,
    type: 'circle',
    source,
    paint: {
      'circle-radius': MapLibreExpressions.caseCondition(
        ['boolean', ['feature-state', 'hover'], false],
        16,
        MapLibreExpressions.interpolateZoom([
          { zoom: 4, value: 7 },
          { zoom: 10, value: 11 },
          { zoom: 16, value: 16 },
        ])
      ),
      'circle-color': MapLibreExpressions.coalesce(
        ['get', 'markerColor'],
        defaultCoreColor
      ),
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-opacity': 0.9,
      'circle-opacity': 0.8,
    },
  };

  // 3. Centralny Punkt POI (Core Dot)
  const coreCircleLayer: MapLibreLayerSpecification = {
    id: coreId,
    type: 'circle',
    source,
    paint: {
      'circle-radius': MapLibreExpressions.caseCondition(
        ['boolean', ['feature-state', 'selected'], false],
        9,
        MapLibreExpressions.interpolateZoom([
          { zoom: 4, value: 4 },
          { zoom: 10, value: 6 },
          { zoom: 16, value: 8 },
        ])
      ),
      'circle-color': MapLibreExpressions.coalesce(
        ['get', 'markerColor'],
        defaultCoreColor
      ),
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#FFFFFF',
      'circle-opacity': 1.0,
    },
  };

  // 4. Biały Punkt Skupienia (Center Hotspot)
  const centerDotLayer: MapLibreLayerSpecification = {
    id: dotId,
    type: 'circle',
    source,
    paint: {
      'circle-radius': 2.5,
      'circle-color': NEON_GLOW_THEME.radarCenterDot,
      'circle-opacity': 0.95,
    },
  };

  // 5. Etykieta Tekstowa z Neonowym Halo (Glow Symbol)
  const symbolsLayer: MapLibreLayerSpecification = {
    id: labelId,
    type: 'symbol',
    source,
    minzoom: 8,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': '#0B0F19',
      'text-halo-width': 2.5,
      'text-halo-blur': 1,
    },
  };

  return [outerWaveLayer, midRingLayer, coreCircleLayer, centerDotLayer, symbolsLayer];
}

/**
 * Rejestruje kompletny zestaw neonowej poświaty (Złota Nitka + Radar POI) na instancji MapLibre Map.
 */
export function applyNeonGlowLayers(
  map: MapLibreMapInstance,
  config: MapGlowLayersConfig = {}
): {
  goldenThreadLayerIds: string[];
  poiRadarLayerIds: string[];
  removeGlowLayers: () => void;
} {
  const goldenThreadLayers = createGoldenThreadLayers({
    routeSourceId: config.routeSourceId,
    ...config.goldenThread,
  });

  const poiRadarLayers = createPoiRadarLayers({
    poiSourceId: config.poiSourceId,
    ...config.poiRadar,
  });

  const addedLayerIds: string[] = [];

  const addAllLayers = () => {
    if (!map.isStyleLoaded()) {
      map.once('load', () => addAllLayers());
      return;
    }

    // 1. Add Golden Thread Layers
    for (const layer of goldenThreadLayers) {
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer);
        addedLayerIds.push(layer.id);
      }
    }

    // 2. Add POI Radar Layers
    for (const layer of poiRadarLayers) {
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer);
        addedLayerIds.push(layer.id);
      }
    }
  };

  addAllLayers();

  const removeGlowLayers = () => {
    for (const layerId of addedLayerIds) {
      if (map.getLayer(layerId)) {
        try {
          map.removeLayer(layerId);
        } catch {
          // ignore safe removal
        }
      }
    }
    addedLayerIds.length = 0;
  };

  return {
    goldenThreadLayerIds: goldenThreadLayers.map((l) => l.id),
    poiRadarLayerIds: poiRadarLayers.map((l) => l.id),
    removeGlowLayers,
  };
}
