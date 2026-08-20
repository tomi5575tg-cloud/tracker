# Tracker — od żelaznej bazy sprzętowej po ostatni piksel w kabinie

Jedna rama, bez magii i bez cichego połykania błędów: GNSS/IMU → **Śluza (Zasada Jednej Kabiny)** → siatka degradacji → RFC 7946 GeoJSON → piksele MapLibre albo awaryjny Canvas 2D. Każda spoina ma audyt (`WeldAudit`); utrata WebGL nie zostawia czarnego ekranu.

```bash
npm ci
npm test
npm run cockpit
```

Kabina deweloperska: `http://localhost:5173`. W VM bez odbiornika GNSS szyna jawnie przełącza się na `SIMULATED` — HUD nie udaje żywego fixa.

---

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

### 3. Generator Zapytań Przestrzennych (`SpatialQueryGenerator` & `GeoSpatialUtils`)
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

### 4. Indeks Przestrzenny i Wyszukiwanie POI (`SpatialPoiIndex` & `PoiManager`)
- Wbudowany in-memory indeks przestrzenny zintegrowany z silnikiem kontroli dostępu RBAC/ABAC:
  - `searchBBox(bbox, options)`
  - `searchRadius(center, radiusMeters, options)`
  - `searchCorridor(coordinates, bufferMeters, options)`
  - Sortowanie wyników według odległości od środka lub początku trasy.
  - Paginacja (`limit`, `offset`), filtry kategorii, statusu, tenantów i tagów.
  - Automatyczna sanityzacja pól poufnych (`[CONFIDENTIAL / MASKED]`) w wynikach wyszukiwania dla ról bez uprawnienia `POI_READ_SENSITIVE`.

---

### 5. Kontrakt Kategorii POI (`src/poi/`)
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

### 6. Szufladowy Kokpit z Poświatą HUD — Tailwind CSS (`components/TacticalBottomSheet.tsx` & `.ts`)
Wysokowydajny szufladowy panel dolny (Bottom Sheet) w estetyce Cyberpunk HUD / Dark Obsidian z poświatą neonową:
- **Mapowanie Klas Tailwind CSS (`TACTICAL_HUD_TAILWIND_CLASSES`)**:
  - `container`: `fixed inset-x-0 bottom-0 z-50 flex flex-col bg-slate-950/95 text-slate-100 backdrop-blur-xl border-t border-cyan-500/30 shadow-[0_-10px_35px_rgba(0,0,0,0.8),0_-2px_15px_rgba(0,240,255,0.2)] rounded-t-3xl`
  - `grabberBar`: `w-12 h-1.5 rounded-full bg-slate-600/60 shadow-[0_0_8px_rgba(0,240,255,0.4)]`
  - `tabItemActive`: `text-cyan-400 border-b-2 border-cyan-400 shadow-[0_2px_8px_rgba(0,240,255,0.3)]`
  - `card`: `bg-slate-900/80 border border-cyan-500/20 hover:border-cyan-400/40`
  - `actionButtonPrimary`: `bg-gradient-to-r from-cyan-500 to-blue-600 shadow-[0_0_20px_rgba(0,240,255,0.4)]`
- **Snap Points (`TacticalSnapPoint`)**: `HIDDEN` (0 px), `PEEK` (84 px), `HALF` (45% wysokości ekranu), `EXPANDED` (88% wysokości ekranu).
- **Gestury i Magnetyzm**: Płynne przeciąganie (`handleDragStart`, `handleDragMove`, `handleDragEnd`) z asystą prędkości (velocity fling) i zatrzaskiwaniem do najbliższego punktu.
- **Zakładki Taktyczne (`TacticalSheetTab`)**: `RADAR_POI` (inspektor wybranego punktu), `TELEMETRY_ROUTE` (telemetria trasy), `ACTIONS` (operacje taktyczne).
- **Generator Widoku HTML i Komponent JSX**: Metoda `renderHtml()` oraz fabryka funkcyjna `TacticalBottomSheet(props)` do natychmiastowej integracji w React / Next.js / PWA / React Native Web.
- **Pancerny Drenaż Sesji (`SessionDrainHook`)**: Przy wylogowaniu lub zmianie użytkownika w śluzie stan jest bezwzględnie czyszczony, wybrane punkty/trasy usuwane, a panel chowany do stanu `HIDDEN`.

---

### 7. Moduł Dynamicznego Światła Mapy — Księżyc vs Słońce (`src/lighting/`)
Zaawansowany silnik symulacji astronomicznej i dynamicznego oświetlenia 3D dla MapLibre GL JS:
- **Kalkulator Ciał Niebieskich (`CelestialCalculator`)**:
  - Obliczenia Julian Date, wektorów deklinacji i rektascensji słońca i księżyca.
  - Wyznaczanie kąta azymutu (0–360°), elewacji/wysokości nad horyzontem i kąta zenitu.
  - Fazy dnia i nocy (`DayNightPhase`): `DAY`, `GOLDEN_HOUR_MORNING`, `CIVIL_DUSK`, `NAUTICAL_DUSK`, `ASTRONOMICAL_DUSK`, `NIGHT`.
  - Faza i oświetlenie księżyca (`LunarEphemeris`): frakcja oświetlenia (0.0–1.0), wiek księżyca (0–29.53 dni) i nazwa fazy (`NEW_MOON`, `FULL_MOON`, itd.).
- **Menedżer Dynamicznego Oświetlenia (`DynamicLightingManager`)**:
  - Płynne przełączanie dominującego źródła światła (`SUN` vs `MOON`) z dynamiczną paletą barw (Złota Godzina, Południe, Srebrzysta Pełnia, Granatowy Nów).
  - Automatyczna aktualizacja właściwości `setLight` na mapie MapLibre (kąty radialne, azymutalne i polarne).
  - Synchronizacja cieniowania 3D terenu (`hillshade-illumination-direction`, `hillshade-shadow-color`) i budynków 3D (`fill-extrusion`).
  - Pętla synchronizacji czasu rzeczywistego z opcjonalnym mnożnikiem przyspieszenia symulacji (`simulatedTimeMultiplier`).
  - Pancerny drenaż sesji (`SessionDrainHook`): zatrzymanie timerów i reset przesunięcia czasu.

---

### 8. Autonomiczny Moduł Solarny & Re-iniekcja Złotej Nitki (`src/lighting/solarStyleManager.ts`)
Autonomiczny zarządca stylów solarnych z płynną podmianą stylów MapLibre:
- **Autonomiczna Ewaluacja Solarna (`AutonomousSolarStyleManager`)**:
  - `DAYLIGHT`: Pełne słońce i wysoki kontrast (wysokość słońca > 12°).
  - `GOLDEN_HOUR`: Złota godzina / bursztynowy wschód i zachód (0° do 12°).
  - `DUSK`: Zmierzch żeglarski i cywilny / fioletowo-indygo (-6° do 0°).
  - `NIGHT_OBSIDIAN`: Pełnia księżyca i głęboka czerń nocy (< -6°).
- **Histereza Kątowa (`hysteresisDeg`)**:
  - Eliminuje migotanie (style flickering) na granicach faz solarnych przy powolnym zachodzie/wschodzie słońca.
- **Pancerna Re-iniekcja Warstw po `style.load`**:
  - Automatyczny nasłuch zdarzenia przeładowania stylu MapLibre.
  - Bezstratna re-iniekcja Złotej Nitki (Outer Amber Glow, Mid Gold Radiant, Core White-Gold Line).
  - Bezstratna re-iniekcja warstw radaru POI (fale radaru, pierścienie halo, piny kategorii i neonowe etykiety).
  - Ponowna rejestracja źródeł GeoJSON i warstw telemetrycznych.
- **Drenaż sesji (`SessionDrainHook`)**:
  - Natychmiastowe zdemontowanie warstw świetlnych i wyłączenie pętli przełączania stylów.

---

### 9. Automatyczna Optyka Kamery pod Taktyczny HUD (`src/maplibre/cameraOptics.ts`)
Zaawansowany silnik optyczny eliminujący problem zasłaniania widoku mapy (HUD Occlusion):
- **Dynamiczne Insety Viewportu (`computeViewportInsets`)**:
  - Górny pasek Top Bar HUD (64px + 24px safety margin).
  - Pływający pasek akcji Floating Toolbar (68px + 24px safety margin).
  - Dynamiczny dolny panel Taktyczny Bottom Sheet (PEEK: 84px, HALF: 45% vh, EXPANDED: 88% vh, HIDDEN: 0px).
- **Kompensacja Środka Optycznego (`computeOpticalCenterOffset`)**:
  - Matematyczne przesunięcie punktu skupienia kamery w "Sweet Spot" (niezasłonięte okno apertury mapy).
- **Adaptacyjne Kadrowanie**:
  - `framePoi(poi)`: Precyzyjne skupienie na punkcie zainteresowania z zachowaniem strefy buforowej i zbliżenia.
  - `frameRoute(route)`: Obliczenie otaczającego BBox i wywołanie `fitBounds` ze zbalansowanym paddingiem.
  - `frameBoundingBox(bbox)` & `frameCoordinates(coordinates)`: Dynamiczne dopasowanie klastrów punktów.
- **Pancerny Drenaż Optyki (`SessionDrainHook`)**:
  - Natychmiastowe zatrzymanie trwających animacji kamery (`map.stop()`) i powrót do domyślnego widoku przy wylogowaniu.

---

### 9. Ochrona przed Wyścigami Zapytań (`src/auth/queryRaceGuard.ts`)
Pancerny mechanizm ochrony przed wyścigami danych (Race Conditions / In-flight Query Superseding):
- **Monotoniczne Identyfikatory Sekwencji (`queryId`)**:
  - Każde nowe zapytanie (np. skan radaru, filtr telemetryczny, wyszukiwanie POI) otrzymuje rosnący identyfikator.
- **Natychmiastowe Anulowanie In-Flight (`AbortController`)**:
  - Wysłanie nowego zapytania w tym samym kanale automatycznie przerywa wcześniejsze żądania sieciowe/obliczeniowe.
- **Bariera Zatwierdzania (`Commit Barrier`)**:
  - Wyniki spóźnionych, nieaktualnych odpowiedzi są bezwzględnie odrzucane, zapobiegając nadpisaniu nowszego stanu.
- **Pancerny Drenaż Zapytań (`SessionDrainHook`)**:
  - Błyskawiczny abort wszystkich aktywnych zadań asynchronicznych i wyczyszczenie timerów podczas drenażu śluzy.

---

### 10. Pancerny Service Worker & Bufor Kafelków Offline (`src/offline/`)
Wysokowydajny podsystem buforowania kafelków rastrowych/wektorowych oraz dynamicznego fallbacku dla Złotej Nitki:
- **Menedżer Bufora Kafelków (`TacticalTileCacheManager`)**:
  - Pamięć podręczna LRU z ograniczeniem wagowym (`maxCacheBytes`) oraz liczbowym (`maxEntries`).
  - Precyzyjne parsowanie kluczy kafelków (`{z}/{x}/{y}`) oraz standardowych adresów URL kafelków slippy map.
  - Formuły geodezyjne przeliczające `lonLatToTile` oraz `tileToLonLatBounds`.
  - Pełna integracja z `SessionDrainHook` (natychmiastowe czyszczenie pamięci kafelków przy wylogowaniu).
- **Dynamiczny Fallback Złotej Nitki (`GoldenThreadOfflineFallback`)**:
  - Matematyczne wyliczanie przecięcia odcinków trajektorii trasy z granicami kafelków.
  - Dynamiczny generator syntetycznych kafelków SVG z zachowaniem neonowego blasku Złotej Nitki (Outer Glow, Mid Radiant, Core White-Gold Thread).
  - Generowanie taktycznej siatki Cyberpunk Grid z koordynatami kafelków w warunkach braku połączenia sieciowego (radio silence).
  - Metoda `pregenerateRouteTiles` buforująca kafelki wzdłuż całej trasy dla poziomów zoomu 10–14.
- **Interception Service Workera (`TacticalServiceWorkerHandler`)**:
  - Strategia Cache-First z transparentnym fallbackiem sieciowym.
  - Automatyczna generacja i buforowanie syntetycznego kafelka w przypadku błędów sieciowych / trybu offline.

---

### 11. Adaptacyjny Most Telemetryczny dla Supabase Edge Functions (`src/edge/`)
Wysokowydajny most telemetryczny łączący sprzętowy Turbo Boost z chmurowym skalowaniem analityki AI:
- **Silnik Adaptacyjnego Próbkowania i Dawkowania Mocy (`AdaptiveSampler`)**:
  - Tłumaczy prędkość pojazdu, wychylenie przepustnicy i przeciążenia (g-force) na poziomy mocy: `IDLE`, `ECO`, `CRUISE`, `SPORT`, `TURBO_MAX`.
  - Płynnie moduluje interwał próbkowania (od 5000 ms przy postoju do 200 ms przy Turbo Max).
  - Chroni przepustowość pod dużym obciążeniem jednostki (`CRITICAL` load throttling).
  - Inteligentnie filtruje strumień punktów z zachowaniem ostrych skrętów (>15°) i pików przeciążeń.
- **Skalowanie Głębokości Analizy AI (`AiAnalysisTierEngine`)**:
  - `TIER_0_RAW_INGEST`: Podstawowa walidacja koordynatów WGS84 i integralności ramki.
  - `TIER_1_KINEMATICS`: Monitoring prędkości, wektorów i przeciążeń bocznych/wzdłużnych.
  - `TIER_2_SAFETY_CORRIDOR`: Geofencing korytarza trasy, alerty przekroczenia prędkości i przeciążenia termicznego.
  - `TIER_3_DEEP_ANOMALY`: Zaawansowana fuzja czujników, szacowanie przepływu paliwa i odzysku energii z hamowania.
  - `TIER_4_FULL_COCKPIT_AI`: Pełna taktyczna rekomendacja manewru, alerty stabilności i wektorowanie 3D.
- **Kontroler Edge Function (`SupabaseTelemetryBridgeHandler`)**:
  - Deno / Edge Runtime kompatybilny handler HTTP z nagłówkami CORS i metrykami nagłówkowymi (`x-tracker-turbo-level`, `x-tracker-ai-tier`, `x-tracker-power-dosing`).
  - Automatyczna konwersja do RFC 7946 GeoJSON (`routeCollection`, `waypointCollection`).
  - Weryfikacja tożsamości przez Śluzę Logowania (`AuthLockBooth`) i drenaż sesji (`SessionDrainHook`).

---

### 12. Architektura Odporna na Awarie (Fault-Tolerant Mesh & Graceful Degradation — `src/resilience/`)
Pancerny system eliminacji pojedynczych punktów awarii (SPOF Screen & Navigation Protection):
- **Główny Nadzorca Siatki (`FaultTolerantMeshSupervisor`)**:
  - `LEVEL_0_NOMINAL`: Wszystkie podsystemy w normie (WebGL 3D, live GPS, chmura AI, aktywne kafelki).
  - `LEVEL_1_NETWORK_DEGRADED`: Awaria sieci chmurowej $\rightarrow$ przełączenie na lokalny bufor telemetryczny i pokładowe reguły.
  - `LEVEL_2_GPS_LOST`: Utrata sygnału GNSS / wjazd do tunelu $\rightarrow$ natychmiastowa aktywacja nawigacji zliczeniowej (Dead Reckoning).
  - `LEVEL_3_MAP_RENDER_LOST`: Awaria WebGL / utrata kontekstu GPU $\rightarrow$ natychmiastowy fallback na 2D Emergency Vector HUD Canvas / SVG (ekran nigdy nie gaśnie).
  - `LEVEL_4_TOTAL_BLACKOUT`: Całkowita izolacja sensoryczna $\rightarrow$ autonomiczna macierz taktyczna Dead Reckoning.
- **Silnik Nawigacji Zliczeniowej (`DeadReckoningEngine`)**:
  - Kinematyczna ekstrapolacja współrzędnych geograficznych wzdłuż azymutu z uwzględnieniem formuł ortodromicznych WGS84 (`destinationPoint`).
  - Fuzja sensorów IMU (żyroskopowy yaw rate, akcelerometr) oraz modelowanie spadku pewności (confidence decay).
  - Płynne pojednanie i zerowanie błędu ekstrapolacji po odzyskaniu sygnału GPS.
- **Awaryjny Renderer Wektorowy (`EmergencyRenderer`)**:
  - Samodzielne renderowanie widoku taktycznego na Canvas 2D lub w postaci wektorowego SVG.
  - Rysowanie Złotej Nitki, retikulum pozycji pojazdu (z pulsem Dead Reckoning), punktów POI i banera diagnostycznego degradacji.

---

### 13. Integracja z Koordynatorem Sesji (`src/integration/`)
- `SecureTrackingSessionCoordinator`: Łączy `AuthLockBooth`, `MapLibreRouteManager`, `MapLibrePoiLayerManager`, `PoiManager`, `DynamicLightingManager`, `AutonomousSolarStyleManager`, `TacticalCameraOpticsEngine`, `TacticalQueryRaceGuard`, `TacticalTileCacheManager`, `TacticalServiceWorkerHandler`, `SupabaseTelemetryBridgeHandler`, `FaultTolerantMeshSupervisor` oraz `TacticalBottomSheetController` w spójny ekosystem bezpieczeństwa:
  - Zmiana użytkownika w śluzie (`enterBooth`) bezwarunkowo drenuje trasę (`clearRoute`), punkty POI (`clearPoi`), oświetlenie (`drain`), optykę kamery (`drain`), zapytania (`drain`), bufor kafelków (`drain`), most telemetryczny (`drain`), nadzorcę siatki (`drain`) oraz panel taktyczny (`drain`).
  - Wyświetlanie POI (`displayPois`) automatycznie respektuje uprawnienia aktywnej sesji.
  - Wybór punktu `selectPoi` / `onItemSelect` automatycznie kadruje kamerę w sweet spocie HUD.

---

## Architektura Modułów

```
components/
├── TacticalMapCockpit.tsx    # Główny Widok Kokpitu (React + MapLibre, Top Bar, Floating Actions)
├── TacticalMapCockpit.ts     # Kontroler Kokpitu (Orkiestracja Mapy, Śluzy, Oświetlenia i UI)
├── TacticalBottomSheet.tsx   # Szufladowy Kokpit HUD (Komponent JSX, Tailwind CSS, Poświata)
└── TacticalBottomSheet.ts    # Kontroler Taktycznego Panelu (Snap Points, Gestury, Drenaż)
lib/
└── mapGlowLayers.ts          # Neonowa Poświata na Mapie (Złota Nitka + Punkty Radaru POI)
src/
├── components/
│   ├── TacticalMapCockpit.ts # Eksport komponentu TacticalMapCockpit
│   └── TacticalBottomSheet.ts# Eksport komponentu TacticalBottomSheet
├── lighting/
│   ├── types.ts              # Typy oświetlenia dynamicznego (Solar/Lunar Ephemeris, Fazy, Paleta)
│   ├── celestialCalculator.ts# Algorytmy pozycji Słońca i Księżyca (Julian Date, Azimuth, Altitude)
│   ├── dynamicLightingManager.ts # Menedżer światła MapLibre (Księżyc vs Słońce, Hillshade 3D, Cienie)
│   └── solarStyleManager.ts  # Autonomiczny Menedżer Stylów Solarnych i Re-iniekcja Złotej Nitki
├── maplibre/
│   ├── types.ts              # Abstrakcja interfejsów MapLibre GL JS, oświetlenia 3D i zdarzeń
│   ├── expressions.ts        # Helper wyrażeń stylów (feature-state, match, interpolate)
│   ├── glowLayers.ts         # Warstwy neonowej poświaty (Złota Nitka + Punkty Radaru POI)
│   ├── cameraOptics.ts       # Automatyczna Optyka Kamery pod HUD (Insets, Sweet Spot)
│   ├── geoJsonAdapter.ts     # Lekki Adapter GeoJSON z cyklem życia i drenażem
│   ├── routeManager.ts       # Zarządzanie trasami i procedura clearRoute
│   └── poiLayerManager.ts    # Zarządzanie warstwami POI i procedura clearPoi
├── offline/
│   ├── tileCacheManager.ts   # Menedżer bufora kafelków LRU i obliczeń geodezyjnych slippy map
│   ├── goldenThreadFallback.ts # Dynamiczny generator syntetycznych kafelków SVG dla Złotej Nitki
│   └── serviceWorkerHandler.ts # Interceptor żądań kafelkowych Cache-First / Offline Fallback
├── edge/
│   ├── types.ts              # Typy telemetrii, poziomów Turbo Boost i głębokości analizy AI
│   ├── adaptiveSampler.ts    # Adaptacyjne próbkowanie i dawkowanie mocy (Power Throttling)
│   ├── aiTierEngine.ts       # Silnik skalowania analizy AI (Tier 0 - Tier 4)
│   └── supabaseBridge.ts     # Most telemetryczny dla Supabase Edge Functions (RFC 7946 GeoJSON)
├── resilience/
│   ├── types.ts              # Typy siatki odpornej na awarie (Fault-Tolerant Mesh & Graceful Degradation)
│   ├── deadReckoningEngine.ts# Nawigacja zliczeniowa (Dead Reckoning & Inertial Extrapolation)
│   ├── emergencyRenderer.ts  # Awaryjny renderer Canvas 2D / SVG chroniący przed zgaśnięciem ekranu
│   └── faultTolerantMesh.ts  # Główny nadzorca siatki odpornej na awarie (Supervisor & Health Matrix)
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
│   └── coordinator.ts        # Koordynator sesji, tras, POI, oświetlenia i UI
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

### 3. Sterowanie Taktycznym Panelem Dolnym z Poświatą HUD (Tailwind CSS)

```typescript
import {
  TacticalBottomSheetController,
  TacticalBottomSheet,
  TACTICAL_HUD_TAILWIND_CLASSES,
} from 'tracker';

// 1. Inicjalizacja kontrolera
const sheetController = new TacticalBottomSheetController({
  initialSnapPoint: 'PEEK',
  neonThemeAccent: '#00F0FF',
  onSnapChange: (snap) => console.log('Zmiana wysokości:', snap),
});

// Wybór punktu ze skanera POI
sheetController.selectPoi(selectedPoi, poiCategory);

// Zmiana wysokości (PEEK -> HALF -> EXPANDED)
sheetController.setSnapPoint('HALF');

// 2. Wygenerowanie gotowego szablonu HTML HUD lub użycie komponentu React/JSX
const hudHtml = sheetController.renderHtml();
const component = TacticalBottomSheet({ controller: sheetController });
```

### 4. Dynamiczne Oświetlenie Mapy (Słońce vs Księżyc, Fazy, 3D Hillshade)

```typescript
import { DynamicLightingManager, CelestialCalculator } from 'tracker';

// Inicjalizacja menedżera światła powiązanego z mapą MapLibre
const lightingManager = new DynamicLightingManager(mapInstance, {
  observerCoordinate: [21.0122, 52.2297], // Warszawa
  updateIntervalMs: 5000,                // Aktualizacja w czasie rzeczywistym
  simulatedTimeMultiplier: 1.0,          // 1.0 = czas rzeczywisty (lub np. 3600 = 1h / sek)
  onLightingChange: (state) => {
    console.log(`Dominujące ciało: ${state.dominantBody} (${state.sun.phase})`);
    console.log(`Księżyc: ${state.moon.phaseName}, oświetlenie: ${(state.moon.illuminatedFraction * 100).toFixed(1)}%`);
  },
});

// Ręczne ustawienie godziny (np. pełnia nocy)
lightingManager.advanceHours(12);
```

### 5. Dwukierunkowe Spięcie Zdarzenia `onItemSelect` z MapLibre GL JS

```typescript
import {
  SecureTrackingSessionCoordinator,
  MapLibrePoiLayerManager,
  TacticalBottomSheetController,
} from 'tracker';

// Kliknięcie w punkt na mapie lub wybór z panelu synchronizuje stan i widok:
coordinator.onItemSelect('poi-radar-station', {
  centerCamera: true, // Automatyczne przesunięcie kamery (easeTo/flyTo)
  zoom: 15,           // Zbliżenie na wybrany obiekt
});
```

### 6. Główny Widok Kokpitu (React + MapLibre + Tactical HUD + Camera Optics)

```typescript
import {
  TacticalMapCockpit,
  TacticalMapCockpitController,
  TACTICAL_COCKPIT_TAILWIND_CLASSES,
} from 'tracker';

// Inicjalizacja głównego widoku kokpitu
const cockpit = TacticalMapCockpit({
  map: mapInstance,
  authBooth: authLockBooth,
  initialCenter: [21.0122, 52.2297], // Warszawa
  enableNeonGlow: true,
  onItemSelect: (poi) => console.log('Wybrano punkt:', poi?.name),
});

// Bezpieczny skan radarowy w promieniu 15 km chroniony przed wyścigami zapytań
await cockpit.controller.performRadarScanSafe(15000);

// Przełączanie oświetlenia noc / dzień
cockpit.controller.toggleDayNight(12);
```

---

## Budowanie i Testy

```bash
# Uruchomienie pełnego zestawu 180 testów jednostkowych i integracyjnych
npm test

# Kompilacja TypeScript (strict mode, zero błędów)
npm run build
```
