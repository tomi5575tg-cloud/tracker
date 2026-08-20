// Core types
export * from './types.js';

// RFC 7946 GeoJSON
export * from './geojson/types.js';
export * from './geojson/converter.js';
export * from './geojson/validator.js';

// Auth Booth (Zasada Jednej Kabiny)
export * from './auth/mutex.js';
export * from './auth/storage.js';
export * from './auth/drainManager.js';
export * from './auth/authBooth.js';
export * from './auth/queryRaceGuard.js';

// Mobile Startup Auth Gate
export * from './auth/mobileTypes.js';
export * from './auth/mobileGate.js';

// MapLibre GL JS & Lightweight GeoJSON Adapter & Neon Glow Layers
export * from './maplibre/types.js';
export * from './maplibre/expressions.js';
export * from './maplibre/geoJsonAdapter.js';
export * from './maplibre/glowLayers.js';
export * from './maplibre/cameraOptics.js';
export * from './maplibre/routeManager.js';
export * from './maplibre/poiLayerManager.js';

// POI Category Contract & Permissions Matrix
export * from './poi/types.js';
export * from './poi/schemaValidator.js';
export * from './poi/permissionsMatrix.js';
export * from './poi/defaultCategories.js';
export * from './poi/converter.js';
export * from './poi/categoryRegistry.js';
export * from './poi/poiManager.js';

// Spatial Query Generator & Index
export * from './spatial/types.js';
export * from './spatial/geoUtils.js';
export * from './spatial/queryGenerator.js';
export * from './spatial/spatialIndex.js';

// Offline Tile Cache & Golden Thread Fallback Service Worker
export * from './offline/tileCacheManager.js';
export * from './offline/goldenThreadFallback.js';
export * from './offline/serviceWorkerHandler.js';

// Supabase Edge Functions Adaptive Telemetry Bridge & AI Tier Scaling
export * from './edge/types.js';
export * from './edge/adaptiveSampler.js';
export * from './edge/aiTierEngine.js';
export * from './edge/supabaseBridge.js';

// Fault-Tolerant Mesh & Graceful Degradation Navigation
export * from './resilience/types.js';
export * from './resilience/circuitBreaker.js';
export * from './resilience/deadReckoningEngine.js';
export * from './resilience/emergencyRenderer.js';
export * from './resilience/faultTolerantMesh.js';

export * from './hardware/types.js';
export * from './hardware/simulatedGnssPort.js';
export * from './hardware/browserGnssPort.js';
export * from './hardware/manualInertialPort.js';
export * from './hardware/telemetryBus.js';

export * from './pixel/projection.js';
export * from './pixel/frameBuffer.js';

export * from './weld/errors.js';
export * from './weld/hardwareToPixelPipeline.js';
export * from './weld/bindWebGlLoss.js';

export * from './tactical/types.js';
export * from './tactical/advice.js';
export * from './tactical/copilotAgent.js';

export * from './audio/types.js';
export * from './audio/hornTrigger.js';
export { HighwayHorn } from './audio/highwayHorn.js';
export type { HighwayHornConfig } from './audio/highwayHorn.js';

// Tactical UI Components
export * from './components/TacticalBottomSheet.js';
export * from './components/TacticalMapCockpit.js';

// Dynamic Lighting Module (Księżyc vs Słońce & Autonomous Solar Styles)
export * from './lighting/types.js';
export * from './lighting/celestialCalculator.js';
export * from './lighting/dynamicLightingManager.js';
export * from './lighting/solarStyleManager.js';

// Integration Coordinator
export * from './integration/coordinator.js';

