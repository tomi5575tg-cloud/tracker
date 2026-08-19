# Tracker — Śluza Logowania, Drenaż Sesji, Kontrakt POI, Matryca Uprawnień, Generator Zapytań Przestrzennych i Lekki Adapter MapLibre GL JS

Pancerna, modularna implementacja architektury bezpieczeństwa sesji, wizualizacji telemetrycznej, punktów zainteresowania (POI), kontroli dostępu, silnika geodezyjnego oraz lekkiego adaptera GeoJSON dla MapLibre GL JS w oparciu o:
- **TypeScript** (Strict Mode, `exactOptionalPropertyTypes`, 100% type-safe)
- **Lekki Adapter GeoJSON dla MapLibre GL JS** (`MapLibreGeoJsonAdapter`, `MapLibreExpressions`, zarządzanie cyklem życia warstw, buforowanie/debouncing, interaktywny `feature-state` i zdarzenia `onFeatureClick`/`onFeatureHover`)
- **Generator Zapytań Przestrzennych & Indeks Przestrzenny** (Bounding Box, Radius / Bufor kołowy, Korytarz trasy, Poligony, wzory Haversine i rzutowanie wektorowe)
- **Wielobazowy Eksport Zapytań** (PostGIS `ST_MakeEnvelope` / `ST_DWithin`, MongoDB `$geoWithin` / `$centerSphere`, SQLite bounding box, URL Query Params, RFC 7946 Polygon)
- **Kontrakt Kategorii POI** (Schematy atrybutów, typowanie, reguły walidacji i stylizacja mapowa)
- **Matryca Uprawnień RBAC / ABAC** (Role, granularne uprawnienia, ochrona kategorii systemowych i maskowanie pól poufnych)
- **RFC 7946 GeoJSON** (Ścisła walidacja geometrii `[longitude, latitude]` WGS84 oraz `FeatureCollection`)
- **Śluza Logowania (Zasada Jednej Kabiny)** i **Pancerny Drenaż Sesji (`clearRoute`, `clearPoi`, `clear`)**

---

## Główne Moduły i Koncepcje

### 1. Neonowa Poświata na Mapie (Złota Nitka + Punkty Radaru POI — `lib/mapGlowLayers.ts` & `src/maplibre/glowLayers.ts`)
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

### 2. Lekki Adapter GeoJSON dla Silnika MapLibre GL JS (`src/maplibre/geoJsonAdapter.ts` & `src/maplibre/expressions.ts`)
Wysokowydajny, modularny adapter integrujący dane GeoJSON ze stylem i silnikiem MapLibre GL JS:
- **Zarządzanie Źródłem i Warstwami (`MapLibreGeoJsonAdapter`)**:
  - Automatyczna rejestracja źródła GeoJSON i warstw (`circle`, `symbol`, `line`, `fill`, `heatmap`, `fill-extrusion`) z obsługą dynamicznego ładowania i przeładowywania stylów mapy (`style.load`).
  - Optymalizacja transferu danych: bezpośrednia aktualizacja przez `setData()` lub buforowana / odroczona przez `setDataDebounced(data, delayMs)` dla szybkiego strumieniowania telemetrii GPS.
  - Automatyczne dopasowanie kamery do granic danych (`autoFitBounds`, `fitToData()`).
- **Interaktywność i Zarządzanie Stanem (`feature-state`)**:
  - `setHoveredFeature(id)` / `setSelectedFeature(id)`: automatyczne przełączanie stanów `hover` i `selected` w silniku GPU MapLibre.
  - `changeCursorOnHover`: automatyczna zmiana kursora myszy (`pointer`, `crosshair`).
  - Rejestracja zdarzeń: `onFeatureClick(layerId, handler)` oraz `onFeatureHover(layerId, handler)`.
- **Pomocnik Wyrażeń MapLibre (`MapLibreExpressions`)**:
  - Type-safe budowanie wyrażeń warstw: `get()`, `featureState()`, `hoverState()`, `selectedState()`, `matchProperty()`, `interpolateZoom()`, `clusterColor()`, `clusterRadius()`.
- **Pancerny Drenaż Pamięci i Sesji (`SessionDrainHook`)**:
  - Implementacja `drain()` / `clear()` — natychmiastowe resetowanie źródła do pustego `FeatureCollection`, wyczyszczenie stanów obiektów, markerów HTML (`MapLibreMarker`) i popupów (`MapLibrePopup`).

---

### 2. Generator Zapytań Przestrzennych (`SpatialQueryGenerator` & `GeoSpatialUtils`)
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
  - **Korytarz Trasy (`fromCorridor`)**: Bufor wokół trasy telemetrycznej (np. znajdź stacje benzynowe w promieniu 5 km wzdłuż trasy).
  - **Wielokąt / Geofence (`fromPolygon`)**: Dowolne obszary wielokątne.
- **Wieloplatformowe Klauzule Zapytań (`GeneratedSpatialQuery`)**:
  - **PostGIS / PostgreSQL**: `ST_Intersects(geom, ST_MakeEnvelope(...))` oraz `ST_DWithin(geom::geography, ...)` z parametryzacją SQL `$1, $2, ...`.
  - **MongoDB**: Filtry `$geoWithin` z `$box`, `$centerSphere` (promień w radianach) i `$geometry` (GeoJSON Polygon).
  - **SQLite / SQL**: Klauzule zindeksowanych współrzędnych `(longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?)`.
  - **GeoJSON Polygon**: Geometria RFC 7946 Polygon z zachowaniem reguły prawej ręki (right-hand rule).
  - **URL Query Parameters**: Parametry HTTP API (np. `?spatial_type=radius&lat=52.22&lon=21.01&radius=5000`).

---

### 3. Indeks Przestrzenny i Wyszukiwanie POI (`SpatialPoiIndex` & `PoiManager`)
- Wbudowany in-memory indeks przestrzenny zintegrowany z silnikiem kontroli dostępu RBAC/ABAC:
  - `searchBBox(bbox, options)`
  - `searchRadius(center, radiusMeters, options)`
  - `searchCorridor(coordinates, bufferMeters, options)`
  - Sortowanie wyników według odległości od środka lub początku trasy.
  - Paginacja (`limit`, `offset`), filtry kategorii, statusu, tenantów i tagów.
  - Automatyczna sanityzacja pól poufnych (`[CONFIDENTIAL / MASKED]`) w wynikach wyszukiwania dla ról bez uprawnienia `POI_READ_SENSITIVE`.

---

### 4. Kontrakt Kategorii POI (`src/poi/`)
Zapewnia ustrukturyzowany, zwalidowany schemat danych dla punktów zainteresowania (POI) w systemie:
- **Hierarchia i Klasyfikacja**:
  - `classification`: `'SYSTEM'` (wbudowane kategorie bazowe) vs `'CUSTOM'` (tworzone przez organizację/użytkownika).
  - `status`: `'ACTIVE' | 'INACTIVE' | 'ARCHIVED'`.
- **Kontrakt Stylu Mapowego (`PoiCategoryStyle`)**:
  - `markerColor`, `iconName`, `iconSize`, `minZoom`, `maxZoom`, `zIndex`, `clusterable`, `pulseAnimation`.
- **Kontrakt Atrybutów (`PoiFieldDefinition[]`)**:
  - 12 typów danych (`PoiAttributeType`): `STRING`, `NUMBER`, `BOOLEAN`, `DATE`, `DATETIME`, `SELECT`, `MULTISELECT`, `EMAIL`, `PHONE`, `URL`, `JSON`, `COLOR`.
  - Reguły walidacyjne: `min`, `max`, `pattern` (Regex), `options` (dozwolone wartości), `customValidator`.
  - Oznaczanie pól poufnych (`sensitive: true`).
- **7 Standardowych Kategorii Systemowych (`src/poi/defaultCategories.ts`)**:
  1. `fuel_station` (`FUEL`): Stacje paliw, LPG, AdBlue, ładowarki EV, karty flotowe.
  2. `warehouse_logistics` (`WH`): Centra dystrybucyjne, magazyny, liczba ramp, awizacje time-slot.
  3. `customer_site` (`CUST`): Miejsca dostaw odbiorców, instrukcje rozładunku, telefony kontaktowe.
  4. `rest_area_truck_stop` (`REST`): MOP / Parkingi TIR, prysznice, ochrona, miejsca postojowe.
  5. `service_workshop` (`SRV`): Autoryzowane serwisy pojazdów, wulkanizacja, pomoc 24h.
  6. `hazard_danger_zone` (`HAZARD`): Ograniczenia skrajni i tonażu, utrudnienia drogowe.
  7. `checkpoint_toll` (`TOLL`): Bramki opłat viaTOLL/e-TOLL, kontrole drogowe, przejścia graniczne.

---

### 5. Matryca Uprawnień (Permissions Matrix — `src/poi/permissionsMatrix.ts`)
Zaawansowany silnik kontroli dostępu (RBAC z elementami ABAC) integrujący się z tożsamością sesji (`UserSession`):
- **Role Systemowe**: `ADMIN`, `DISPATCHER`, `MANAGER`, `OPERATOR`, `DRIVER`, `AUDITOR`, `VIEWER`, `GUEST`.
- **Zabezpieczenia Biznesowe**:
  - **Ochrona Kategorii Systemowych**: Modyfikacja lub usunięcie kategorii `SYSTEM` wymaga `CATEGORY_MANAGE_SYSTEM`.
  - **Izolacja Wielotenantowa (`tenantId`)**: Weryfikacja spójności identyfikatora tenanta użytkownika i zasobu.
  - **Sanityzacja Danych (`sanitizePoi`)**: Maskowanie danych poufnych dla nieuprawnionych ról.

---

### 6. Taktyczny Panel Dolny (`components/TacticalBottomSheet.ts` & `src/components/`)
Wysokowydajny kontroler i komponent panelu dolnego (Bottom Sheet) w estetyce Cyberpunk/Dark Obsidian:
- **Snap Points (`TacticalSnapPoint`)**: `HIDDEN` (0 px), `PEEK` (84 px), `HALF` (45% wysokości ekranu), `EXPANDED` (88% wysokości ekranu).
- **Gestury i Magnetyzm**: Płynne przeciąganie (`handleDragStart`, `handleDragMove`, `handleDragEnd`) z asystą prędkości (velocity fling) i zatrzaskiwaniem do najbliższego punktu.
- **Zakładki Taktyczne (`TacticalSheetTab`)**: `RADAR_POI` (inspektor wybranego punktu), `TELEMETRY_ROUTE` (telemetria trasy), `ACTIONS` (operacje taktyczne).
- **Stylizacja i View-Model**: Generowanie stylów kontenera z neonową ramką (`borderTop: 1px solid rgba(0, 240, 255, 0.3)`), cieniem poświaty i uchwytem `grabber`.
- **Pancerny Drenaż Sesji (`SessionDrainHook`)**: Przy wylogowaniu lub zmianie użytkownika w śluzie stan jest bezwzględnie czyszczony, wybrane punkty/trasy usuwane, a panel chowany do stanu `HIDDEN`.

---

### 7. Integracja z Koordynatorem Sesji (`src/integration/`)
- `SecureTrackingSessionCoordinator`: Łączy `AuthLockBooth`, `MapLibreRouteManager`, `MapLibrePoiLayerManager`, `PoiManager` oraz `TacticalBottomSheetController` w spójny ekosystem bezpieczeństwa:
  - Zmiana użytkownika w śluzie (`enterBooth`) bezwarunkowo drenuje trasę (`clearRoute`), punkty POI (`clearPoi`) oraz panel taktyczny (`drain`).
  - Wyświetlanie POI (`displayPois`) automatycznie respektuje uprawnienia aktywnej sesji.

---

## Architektura Modułów

```
components/
└── TacticalBottomSheet.ts    # Taktyczny Panel Dolny (Snap Points, Gestury, Dark/Neon Theme)
lib/
└── mapGlowLayers.ts          # Neonowa Poświata na Mapie (Złota Nitka + Punkty Radaru POI)
src/
├── components/
│   └── TacticalBottomSheet.ts# Eksport komponentu TacticalBottomSheet
├── maplibre/
│   ├── types.ts              # Abstrakcja interfejsów MapLibre GL JS, zdarzeń i opcji
│   ├── expressions.ts        # Helper wyrażeń stylów (feature-state, match, interpolate)
│   ├── glowLayers.ts         # Warstwy neonowej poświaty (Złota Nitka + Punkty Radaru POI)
│   ├── geoJsonAdapter.ts     # Lekki Adapter GeoJSON z cyklem życia i drenażem
│   ├── routeManager.ts       # Zarządzanie trasami i procedura clearRoute
│   └── poiLayerManager.ts    # Zarządzanie warstwami POI i procedura clearPoi
├── spatial/
│   ├── types.ts              # Definicje typów zapytań przestrzennych (BBox, Radius, Corridor)
│   ├── geoUtils.ts           # Obliczenia geodezyjne (Haversine, DestinationPoint, Poligony)
│   ├── queryGenerator.ts     # Generator zapytań (PostGIS, MongoDB, SQLite, URL, GeoJSON)
│   └── spatialIndex.ts       # Indeks przestrzenny i silnik ewaluacji z uprawnieniami RBAC
├── poi/
│   ├── types.ts              # Typy POI, Kategorii, Schematów, Ról i Matrycy Uprawnień
│   ├── schemaValidator.ts    # Walidator schematów atrybutów i integralności POI
│   ├── permissionsMatrix.ts  # Matryca Uprawnień RBAC/ABAC i silnik ewaluacji
│   ├── defaultCategories.ts  # 7 Wbudowanych Kategorii Systemowych
│   ├── converter.ts          # Konwerter POI -> RFC 7946 GeoJSON FeatureCollection
│   ├── categoryRegistry.ts   # Rejestr Kategorii POI
│   └── poiManager.ts         # Menedżer POI ze wsparciem zapytań przestrzennych i drenażu
├── geojson/
│   ├── types.ts              # Definicje typów RFC 7946 GeoJSON
│   ├── converter.ts          # Konwerter RouteData -> FeatureCollection (LineString + Point)
│   └── validator.ts          # Walidacja zgodności RFC 7946
├── auth/
│   ├── mutex.ts              # Asynchroniczny Mutex dla śluzy
│   ├── storage.ts            # Bezpieczne providery storage (InMemory, SafeBrowser)
│   ├── drainManager.ts       # Menedżer drenażu sesji z AbortController & Hookami
│   ├── authBooth.ts          # Śluza Logowania (Zasada Jednej Kabiny)
│   ├── mobileTypes.ts        # Typy autoryzacji mobilnej i bootstrapu
│   └── mobileGate.ts         # Śluza startowa mobilki (MobileAuthGate)
├── integration/
│   └── coordinator.ts        # Koordynator sesji, tras, POI i UI (SecureTrackingSessionCoordinator)
└── index.ts                  # Główny punkt eksportu biblioteki
```

---

## Przykładowe Użycie

### 1. Zastosowanie Neonowej Poświaty (Złota Nitka + Radar POI)

```typescript
import { applyNeonGlowLayers, NEON_GLOW_THEME } from 'tracker';
// lub bezpośrednio: import { createGoldenThreadLayers, createPoiRadarLayers } from './lib/mapGlowLayers.js';

// Rejestracja kompletnego zestawu warstw świetlnych na mapie
const { goldenThreadLayerIds, poiRadarLayerIds, removeGlowLayers } = applyNeonGlowLayers(mapInstance, {
  routeSourceId: 'tracker-route-source',
  poiSourceId: 'tracker-poi-source',
});

// Natychmiastowe usunięcie warstw poświaty przy zmianie widoku
// removeGlowLayers();
```

### 2. Użycie Lekkiego Adaptera GeoJSON dla MapLibre GL JS

```typescript
import { MapLibreGeoJsonAdapter, MapLibreExpressions } from 'tracker';

// Inicjalizacja adaptera
const poiAdapter = new MapLibreGeoJsonAdapter(mapInstance, {
  sourceId: 'live-poi-source',
  changeCursorOnHover: true,
  autoFitBounds: true,
  layers: [
    {
      id: 'poi-circles',
      type: 'circle',
      paint: {
        'circle-radius': MapLibreExpressions.hoverState(10, 6),
        'circle-color': MapLibreExpressions.get('markerColor'),
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    },
  ],
});

// Rejestracja kliknięcia
poiAdapter.onFeatureClick('poi-circles', (feature, event) => {
  console.log('Kliknięto punkt:', feature.properties.name);
});

// Strumieniowe ładowanie danych
poiAdapter.setData(poiFeatureCollection);
```

### 2. Generowanie Zapytań Przestrzennych dla PostGIS, MongoDB i HTTP API

```typescript
import { SpatialQueryGenerator } from 'tracker';

// Generowanie zapytania kołowego (promień 25 km wokół Warszawy)
const radiusQuery = SpatialQueryGenerator.fromRadius([21.0122, 52.2297], 25000, {
  categoryIds: ['fuel_station'],
  limit: 50,
});

console.log('PostGIS SQL:', radiusQuery.postGis.sql);
// -> ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
```

### 3. Sterowanie Taktycznym Panelem Dolnym (Tactical Bottom Sheet)

```typescript
import { TacticalBottomSheetController } from 'tracker';
// lub import { TacticalBottomSheetController } from './components/TacticalBottomSheet.js';

const sheetController = new TacticalBottomSheetController({
  initialSnapPoint: 'PEEK',
  neonThemeAccent: '#00F0FF',
  onSnapChange: (snap) => console.log('Zmiana wysokości:', snap),
});

// Wybór punktu ze skanera POI
sheetController.selectPoi(selectedPoi, poiCategory);

// Zmiana wysokości (PEEK -> HALF -> EXPANDED)
sheetController.setSnapPoint('HALF');
```

---

## Budowanie i Testy

```bash
# Uruchomienie pełnego zestawu 114 testów jednostkowych i integracyjnych
npm test

# Kompilacja TypeScript (strict mode, zero błędów)
npm run build
```
