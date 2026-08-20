# Tracker — Architektura Odporna na Awarie (Fault-Tolerant Mesh), Śluza Logowania, Drenaż Sesji, Kontrakt POI, Matryca Uprawnień, Generator Zapytań Przestrzennych i Lekki Adapter MapLibre GL JS

Pancerna, modularna implementacja architektury bezpieczeństwa sesji, odporności na awarie (Fault-Tolerant Mesh), wizualizacji telemetrycznej, punktów zainteresowania (POI), kontroli dostępu, silnika geodezyjnego oraz lekkiego adaptera GeoJSON dla MapLibre GL JS w oparciu o:
- **TypeScript** (Strict Mode, `exactOptionalPropertyTypes`, 100% type-safe)
- **Architektura Odporna na Awarie (Fault-Tolerant Mesh)**: Eliminacja pojedynczego punktu awarii (Zero SPOF) dla wszystkich 8 krytycznych podsystemów (`POSITIONING`, `RENDERING`, `ROUTING`, `LIGHTING`, `CONNECTIVITY`, `POI_DISCOVERY`, `AUTH_SESSION`, `UI_CONTROLS`)
- **Graceful Degradation (5 Poziomów Kontrolowanej Degradacji)**:
  - `Level 0: OPTIMAL` — Pełna akceleracja sprzętowa WebGL GPU, GPS RTK/Standard, routing chmurowy online, oświetlenie efemerydalne 3D
  - `Level 1: DEGRADED_ONLINE` — Fluktuacje sieciowe, fallback do HTTP polling, throttled render, bezpośredni azymut geodezyjny
  - `Level 2: OFFLINE_CACHED` — Całkowita utrata łączności, praca na lokalnym indeksie przestrzennym, pamięć podręczna tras, bufor telemetryczny store-and-forward
  - `Level 3: DEGRADED_FALLBACK` — Awaria WebGL / utrata sygnału GPS, fallback do Canvas 2D / SVG Vector, estymacja Dead Reckoning
  - `Level 4: CRITICAL_SURVIVAL` — Tryb awaryjny (Survival Mode), zero-crash guarantee, High-Contrast Emergency HUD, ekran NIGDY nie gaśnie
- **Wielopoziomowy Łańcuch Zastępczy (`FallbackChain<TInput, TOutput>`) & Circuit Breaker**: Ochrona przed kaskadowymi awariami, automatyczny fallback, izolacja błędów i samoleczenie (Self-Healing)
- **Strażnik Ekranu (`ScreenGuardian`)**: Gwarancja braku czarnego ekranu (Zero Black Screen Guarantee) — automatyczny fallback WebGL GPU ➔ Canvas 2D ➔ SVG Vector Radar ➔ High-Contrast Text Emergency HUD
- **Zliczanie Martwe Telemetrii (`TelemetryDeadReckoning`)**: Płynna ekstrapolacja pozycji po zaniku sygnału GPS na sferze WGS84 z uwzględnieniem tarcia prędkości, wzrostu promienia niepewności oraz dociągania do korytarza trasy
- **Zdegradowany Silnik Nawigacji (`DegradedNavigationEngine`)**: Płynne przełączanie między nawigacją korytarzową, bezpośrednim azymutem geodezyjnym (Great-Circle Bearing), boją Dead Reckoning a bazą bezpieczeństwa (Safe Haven)
- **Priorytetowy Bufor Offline Mesh (`OfflineTelemetryMeshBuffer`)**: Kolejka store-and-forward z gwarantowanymi slotami dla alarmów krytycznych (`EMERGENCY_CRITICAL`), kompaktowaniem telemetrii i odtwarzaniem po powrocie sieci
- **Nadzorca Siatki Odpornościowej (`FaultTolerantMeshSupervisor`)**: Centralny orkiestrator monitorujący macierz zdrowia, pętle watchdog i integrujący kokpit HUD
- **Lekki Adapter GeoJSON dla MapLibre GL JS** (`MapLibreGeoJsonAdapter`, `MapLibreExpressions`, zarządzanie cyklem życia warstw, buforowanie/debouncing, interaktywny `feature-state` i zdarzenia `onFeatureClick`/`onFeatureHover`)
- **Generator Zapytań Przestrzennych & Indeks Przestrzenny** (Bounding Box, Radius / Bufor kołowy, Korytarz trasy, Poligony, wzory Haversine i rzutowanie wektorowe)
- **Wielobazowy Eksport Zapytań** (PostGIS `ST_MakeEnvelope` / `ST_DWithin`, MongoDB `$geoWithin` / `$centerSphere`, SQLite bounding box, URL Query Params, RFC 7946 Polygon)
- **Kontrakt Kategorii POI** (Schematy atrybutów, typowanie, reguły walidacji i stylizacja mapowa)
- **Matryca Uprawnień RBAC / ABAC** (Role, granularne uprawnienia, ochrona kategorii systemowych i maskowanie pól poufnych)
- **RFC 7946 GeoJSON** (Ścisła walidacja geometrii `[longitude, latitude]` WGS84 oraz `FeatureCollection`)
- **Śluza Logowania (Zasada Jednej Kabiny)** i **Pancerny Drenaż Sesji (`clearRoute`, `clearPoi`, `clear`)**

---

## Główne Moduły i Koncepcje

### 1. Architektura Odporna na Awarie (Fault-Tolerant Mesh & Graceful Degradation)
Centralny system odporności eliminujący pojedyncze punkty awarii (SPOF) w misjach telemetrycznych i nawigacyjnych:

- **5 Poziomów Degradacji (`DegradationLevel`)**:
  - `OPTIMAL (0)`: Pełna sprawność wszystkich modułów online i GPU.
  - `DEGRADED_ONLINE (1)`: Zwiększone opóźnienia sieciowe, przejście na zapytania bezpośrednie.
  - `OFFLINE_CACHED (2)`: Praca 100% offline z pamięci podręcznej i bufora telemetrycznego.
  - `DEGRADED_FALLBACK (3)`: Awaria WebGL lub brak sygnału GPS — aktywacja 2D Canvas / SVG i estymacji Dead Reckoning.
  - `CRITICAL_SURVIVAL (4)`: Ekstremalny tryb awaryjny o zerowym ryzyku awarii (Zero Crash Policy) z interfejsem tekstowym High-Contrast HUD.

- **Wielopoziomowy Łańcuch Zastępczy (`FallbackChain<TInput, TOutput>`)**:
  - Rejestracja kolejnych poziomów wykonawczych (Tier 0 ➔ Tier 1 ➔ Tier 2 ➔ Ultimate Survival Handler).
  - Każdy poziom zabezpieczony własnym bezpiecznikiem `CircuitBreaker` (stany `CLOSED`, `OPEN`, `HALF_OPEN`), limitami czasu (`timeoutMs`) i kryteriami dostępności.
  - Bezpieczne wywołanie — błędy są przechwytywane do łańcucha diagnostycznego `errorChain`, a sterowanie natychmiast przekazywane do kolejnego poziomu bez rzucania niespójnych wyjątków.

- **Strażnik Ekranu (`ScreenGuardian` — Zero Black Screen Guarantee)**:
  - Ekran NIGDY nie ma prawa zgasnąć podczas nawigacji.
  - Dynamiczny monitoring kontekstu WebGL (`webglcontextlost` / `webglcontextrestored`), pętli renderowania oraz wskaźnika FPS i heartbeat.
  - Wielopoziomowe renderowanie: `WEBGL_VECTOR` ➔ `CANVAS_2D` ➔ `SVG_VECTOR` ➔ `TEXT_EMERGENCY_HUD`.

- **Estymacja Pozycji i Zliczanie Martwe (`TelemetryDeadReckoning`)**:
  - Płynne podtrzymanie pozycji telemetrycznej po utracie sygnału GPS.
  - Kinematyczne całkowanie prędkości z uwzględnieniem współczynnika zaniku/tarcia (`velocityDecayFactorPerSec`).
  - Dociąganie estymacji do zdefiniowanego korytarza trasy (`ROUTE_SNAPPED`).
  - Kontrolowana ekspansja promienia niepewności pozycji (`uncertaintyRadiusMeters`) do zdefiniowanego limitu bezpieczeństwa.
  - Płynne przejście do trybu stacjonarnego `LAST_KNOWN` po przekroczeniu limitu czasu (`maxExtrapolationDurationMs`).

- **Zdegradowany Silnik Nawigacji (`DegradedNavigationEngine`)**:
  - `OFFLINE_CACHED_CORRIDOR`: Płynne prowadzenie wzdłuż geometrii trasy offline z kalkulacją błędu zejścia z trasy (Cross-Track Error) i ETA.
  - `DIRECT_GEODETIC_BEARING`: Obliczanie ortodromy (Haversine) i azymutu geodezyjnego wprost do celu w przypadku zboczenia z trasy.
  - `DEAD_RECKONING_BEACON`: Nawigacja kierunkowa w warunkach braku sygnału GNSS.
  - `EMERGENCY_SAFE_HAVEN`: Automatyczne wyznaczanie kursu do najbliższej bazy bezpieczeństwa.

- **Priorytetowy Bufor Telemetrii Offline (`OfflineTelemetryMeshBuffer`)**:
  - Kolejka Store-and-Forward z 4 poziomami priorytetów (`EMERGENCY_CRITICAL`, `TELEMETRY_HIGH`, `POI_MEDIUM`, `DIAGNOSTIC_LOW`).
  - Gwarantowana rezerwa slotów dla pakietów alarmowych / drenażu sesji (`emergencyReserveSlots`).
  - Inteligentne kompaktowanie danych (downsampling pośrednich próbek telemetrii przy zachowaniu kluczowych punktów).
  - Serializacja i deserializacja JSON pod kątem trwałej pamięci lokalnej (IndexedDB / LocalStorage).

- **Nadzorca Siatki Odpornościowej (`FaultTolerantMeshSupervisor`)**:
  - Centralna orkiestracja podsystemów, agregacja raportów zdrowia (`SubsystemHealthReport`, `MeshHealthSummary`).
  - Pętla samoleczenia (`triggerSelfHealingRecovery`) przywracająca działanie po ustąpieniu awarii sprzętowych i sieciowych.

---

### 2. Neonowa Poświata na Mapie (Złota Nitka + Punkty Radaru POI — `lib/mapGlowLayers.ts` & `src/maplibre/glowLayers.ts`)
Wielowarstwowy system efektów świetlnych optymalizowany pod kątem renderowania na GPU w MapLibre GL JS:
- **Złota Nitka Trasy (`createGoldenThreadLayers`)**:
  - **Outer Amber Glow**: Rozmyta, szeroka poświata zewnętrzna z dynamicznym `line-blur` interpolowanym wraz z zoomem.
  - **Mid Gold Radiant**: Nasycona, półprzezroczysta złota linia pośrednia (`#FFD700`).
  - **Core White-Gold Thread**: Wyrazista, ostra nitka centralna (`#FFF8E7`) o maksymalnym kontraście.
- **Punkty Radaru POI (`createPoiRadarLayers`)**:
  - **Outer Radar Wave**: Pulsująca fala skanowania radaru z rozmyciem `circle-blur` i reakcją na stan `hover` (`feature-state`).
  - **Mid Halo Ring**: Zewnętrzny pierścień z białym obrysem i adaptacyjnym promieniem.
  - **Core Circle**: Centralny neonowy punkt w barwie kategorii / statusu POI.
  - **Center Hotspot**: Biały punkt skupienia o wysokiej jasności.
  - **Neon Glow Symbols**: Etykiety tekstowe z ciemnym halo (`#0B0F19`) dla doskonałej czytelności w trybie nocnym / dark theme.
- **Aplikacja i Bezpieczne Usuwanie (`applyNeonGlowLayers`)**:
  - Funkcja pomocnicza rejestrująca komplet warstw z obsługą zdarzenia `load` mapy oraz funkcją `removeGlowLayers()` do natychmiastowego demontażu.

---

### 3. Lekki Adapter GeoJSON dla Silnika MapLibre GL JS (`src/maplibre/geoJsonAdapter.ts` & `src/maplibre/expressions.ts`)
Wysokowydajny, modularny adapter integrujący dane GeoJSON ze stylem i silnikiem MapLibre GL JS:
- **Zarządzanie Źródłem i Warstwami (`MapLibreGeoJsonAdapter`)**:
  - Automatyczna rejestracja źródła GeoJSON i warstw (`circle`, `symbol`, `line`, `fill`, `heatmap`, `fill-extrusion`) z obsługą dynamicznego ładowania i przeładowywania stylów mapy (`style.load`).
  - Optymalizacja transferu danych: bezpośrednia aktualizacja przez `setData()` lub buforowana / odroczona przez `setDataDebounced(data, delayMs)` dla szybkiego strumieniowania telemetrii GPS.
  - Automatyczne dopasowanie kamery do granic danych (`autoFitBounds`, `fitToData()`).
- **Interaktywność, Zdarzenie `onItemSelect` i Zarządzanie Stanem (`feature-state`)**:
  - `selectItem(feature, options)`: programowa lub sterowana zdarzeniem selekcja punktu/linii z centrowaniem kamery (`easeTo`, `flyTo`) i podświetleniem w silniku GPU MapLibre.
  - `setHoveredFeature(id)` / `setSelectedFeature(id)`: automatyczne przełączanie stanów `hover` i `selected` w GPU.
  - `changeCursorOnHover`: automatyczna zmiana kursora myszy (`pointer`, `crosshair`).
  - Rejestracja zdarzeń: `onFeatureClick(layerId, handler)` oraz `onFeatureHover(layerId, handler)`.
- **Pomocnik Wyrażeń MapLibre (`MapLibreExpressions`)**:
  - Type-safe budowanie wyrażeń warstw: `get()`, `featureState()`, `hoverState()`, `selectedState()`, `matchProperty()`, `interpolateZoom()`, `clusterColor()`, `clusterRadius()`.
- **Pancerny Drenaż Pamięci i Sesji (`SessionDrainHook`)**:
  - Implementacja `drain()` / `clear()` — natychmiastowe resetowanie źródła do pustego `FeatureCollection`, wyczyszczenie stanów obiektów, markerów HTML (`MapLibreMarker`) i popupów (`MapLibrePopup`).

---

### 4. Generator Zapytań Przestrzennych (`SpatialQueryGenerator` & `GeoSpatialUtils`)
Moduł geodezyjny i generator zapytań przestrzennych (`src/spatial/`):
- **Wzory Geodezyjne i Matematyka Przestrzenna (`GeoSpatialUtils`)**:
  - `haversineDistance(coordA, coordB)`: Precyzyjna odległość ortodromiczna w metrach (Great-Circle Distance) na elipsoidzie WGS84.
  - `calculateBearing(start, end)`: Azymut początkowy w stopniach (0–360°).
  - `destinationPoint(start, bearing, distanceMeters)`: Punkt docelowy na sferze ziemskiej.
  - `bboxFromRadius(center, radiusMeters)`: Obliczenie otaczającego Bounding Boxa dla promienia (z uwzględnieniem spłaszczenia południków w wyższych szerokościach geograficznych).
  - `isPointInPolygon(point, ring)`: Algorytm Ray-Casting sprawdzający zawieranie punktu w dowolnym wielokącie (geofence).
  - `distanceToSegment` & `distanceToPolyline`: Najkrótsza odległość punktu od odcinka lub łamanej (trasy przejazdu).
- **Generator Zapytań Przestrzennych (`SpatialQueryGenerator`)**:
  - **Bounding Box (`fromBBox`)**: Zapytania prostokątne `[minLon, minLat, maxLon, maxLat]`.
  - **Promień / Koło (`fromRadius`)**: Zapytania radialne ze środkiem `[lon, lat]` i promieniem w metrach.
  - **Korytarz Trasy (`fromCorridor`)**: Bufor wokół trasy telemetrycznej.
  - **Wielokąt / Geofence (`fromPolygon`)**: Dowolne obszary wielokątne.
- **Wieloplatformowe Klauzule Zapytań (`GeneratedSpatialQuery`)**:
  - **PostGIS / PostgreSQL**: `ST_Intersects(geom, ST_MakeEnvelope(...))` oraz `ST_DWithin(geom::geography, ...)` z parametryzacją SQL `$1, $2, ...`.
  - **MongoDB**: Filtry `$geoWithin` z `$box`, `$centerSphere` i `$geometry`.
  - **SQLite / SQL**: Klauzule zindeksowanych współrzędnych.
  - **GeoJSON Polygon**: Geometria RFC 7946 Polygon.
  - **URL Query Parameters**: Parametry HTTP API.

---

### 5. Dynamiczne Oświetlenie (Księżyc vs Słońce — `src/lighting/`)
- Obliczanie pozycji słońca i księżyca, faz księżyca, cieni 3D i hillshade dla MapLibre GL JS w oparciu o efemerydy astronomiczne.

---

### 6. Śluza Logowania (Zasada Jednej Kabiny) i Pancerny Drenaż Sesji (`src/auth/`)
- Ścisła izolacja pojedynczej sesji (`AuthLockBooth`, `MobileAuthGate`).
- Kaskadowy drenaż sesji po wylogowaniu / zdarzeniu panicznym (`clearRoute`, wyczyszczenie pamięci podręcznej, markerów, warstw i HUD).

---

## Przykłady Użycia

### 1. Użycie Fault-Tolerant Mesh i Łańcucha Zastępczego (Graceful Degradation)

```typescript
import {
  FaultTolerantMeshSupervisor,
  DegradationLevel,
  ScreenRenderMode,
  PositioningSource,
} from 'tracker';

// Inicjalizacja centralnego nadzorcy odporności na awarie
const supervisor = new FaultTolerantMeshSupervisor({
  initialCenter: [21.0122, 52.2297], // Warszawa
});

// Rejestracja nasłuchiwania na zmiany poziomu degradacji
supervisor.addEventListener((event) => {
  console.log(`[MESH EVENT] ${event.type} | Poziom degradacji: ${event.degradationLevel}`);
});

// 1. Płynne pozyskiwanie pozycji (z automatycznym Dead Reckoning w razie utraty GPS)
const fix = await supervisor.acquirePosition({
  position: [21.0122, 52.2297],
  speedKmh: 65,
  headingDegrees: 90,
  accuracyMeters: 4,
  timestamp: Date.now(),
  source: PositioningSource.GPS_STANDARD,
});

// 2. Bezawaryjne renderowanie ekranu (Zero Black Screen Guarantee)
const screenHtml = await supervisor.renderScreen({
  currentFix: fix,
  activeRoute: null,
  pois: [],
  selectedPoi: null,
  viewportCenter: [21.0122, 52.2297],
  zoom: 12,
  headingDegrees: 90,
  degradationLevel: supervisor.getDegradationLevel(),
});

// 3. Wymuszenie trybu awaryjnego (Survival Mode) w sytuacji krytycznej
supervisor.triggerEmergencySafeMode('CRITICAL_HARDWARE_FAILURE');
console.log('Poziom degradacji:', supervisor.getDegradationLevel()); // CRITICAL_SURVIVAL (Level 4)

// 4. Samoleczenie i powrót do pełnej sprawności
supervisor.triggerSelfHealingRecovery();
```

---

### 2. Główny Widok Kokpitu (React + MapLibre + Tactical HUD + Fault-Tolerant Mesh)

```typescript
import {
  TacticalMapCockpit,
  TacticalMapCockpitController,
  TACTICAL_COCKPIT_TAILWIND_CLASSES,
} from 'tracker';

// Inicjalizacja głównego widoku kokpitu z wbudowanym Fault-Tolerant Mesh
const cockpit = TacticalMapCockpit({
  map: mapInstance,
  authBooth: authLockBooth,
  initialCenter: [21.0122, 52.2297], // Warszawa
  enableNeonGlow: true,
  onItemSelect: (poi) => console.log('Wybrano punkt:', poi?.name),
});

// Pobranie aktualnego stanu zdrowia całego ekosystemu
const healthSummary = cockpit.controller.getMeshSupervisor().getHealthSummary();
console.log('Siatka w pełni sprawna:', healthSummary.isFullyOperational);

// Wykonanie skanu radarowego
cockpit.controller.performRadarScan(15000);

// Generowanie HTML kokpitu (z automatycznym renderowaniem awaryjnym w razie awarii GPU)
const cockpitHtml = cockpit.controller.renderHtml();
```

---

## Budowanie i Testy

```bash
# Uruchomienie pełnego zestawu 176 testów jednostkowych i integracyjnych
npm test

# Kompilacja TypeScript (strict mode, zero błędów)
npm run build
```
