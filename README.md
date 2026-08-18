# Tracker — Śluza Logowania, Drenaż Sesji, Kontrakt Kategorii POI i Matryca Uprawnień

Pancerna, modularna implementacja architektury bezpieczeństwa sesji, wizualizacji telemetrycznej, punktów zainteresowania (POI) i kontroli dostępu w oparciu o:
- **TypeScript** (Strict Mode, 100% type-safe)
- **Kontrakt Kategorii POI** (Schematy atrybutów, typowanie, reguły walidacji i stylizacja mapowa)
- **Matryca Uprawnień RBAC / ABAC** (Role, granularne uprawnienia, ochrona kategorii systemowych i maskowanie pól poufnych)
- **MapLibre GL JS** (Dynamiczne źródła GeoJSON, warstwy POI i tras, zarządzanie markerami i popupami, drenaż pamięci)
- **RFC 7946 GeoJSON** (Ścisła walidacja geometrii `[longitude, latitude]` WGS84 oraz `FeatureCollection`)
- **Śluza Logowania (Zasada Jednej Kabiny)** i **Pancerny Drenaż Sesji (`clearRoute`, `clearPoi`)**

---

## Główne Moduły i Koncepcje

### 1. Kontrakt Kategorii POI (`src/poi/`)
Zapewnia ustrukturyzowany, zwalidowany schemat danych dla punktów zainteresowania (POI) w systemie:
- **Hierarchia i Klasyfikacja**:
  - `classification`: `'SYSTEM'` (wbudowane kategorie bazowe) vs `'CUSTOM'` (tworzone przez organizację/użytkownika).
  - `status`: `'ACTIVE' | 'INACTIVE' | 'ARCHIVED'`.
- **Kontrakt Stylu Mapowego (`PoiCategoryStyle`)**:
  - `markerColor`: Kolor pinu/markera (np. `#0288D1`, `#7B1FA2`).
  - `iconName`: Identyfikator ikony (np. `fuel-station`, `warehouse`, `hazard-warning`).
  - `iconSize`, `minZoom`, `maxZoom`, `zIndex`, `clusterable`, `pulseAnimation`.
- **Kontrakt Atrybutów (`PoiFieldDefinition[]`)**:
  - Obsługiwane typy danych (`PoiAttributeType`): `STRING`, `NUMBER`, `BOOLEAN`, `DATE`, `DATETIME`, `SELECT`, `MULTISELECT`, `EMAIL`, `PHONE`, `URL`, `JSON`, `COLOR`.
  - Reguły walidacyjne (`validation`): `min`, `max`, `pattern` (Regex), `options` (dozwolone wartości dla selectów), `customValidator`.
  - Flaga poufności (`sensitive: true`): Pola wrażliwe (np. kody PIN, kody do szlabanów, telefony VIP), które podlegają automatycznemu maskowaniu dla ról bez uprawnienia `POI_READ_SENSITIVE`.
- **7 Standardowych Kategorii Systemowych (`src/poi/defaultCategories.ts`)**:
  1. `fuel_station` (`FUEL`): Stacja paliw, LPG, AdBlue, EV, karty flotowe, godziny otwarcia.
  2. `warehouse_logistics` (`WH`): Magazyny, centra logistyczne, liczba ramp, awizacja time-slot.
  3. `customer_site` (`CUST`): Punkty dostaw klientów, dane kontaktowe, instrukcje rozładunku.
  4. `rest_area_truck_stop` (`REST`): Parkingi TIR / MOP, prysznice, ochrona, pojemność.
  5. `service_workshop` (`SRV`): Autoryzowane warsztaty, wulkanizacja, telefon 24h.
  6. `hazard_danger_zone` (`HAZARD`): Ograniczenia tonażowe/wysokościowe, utrudnienia, alerty.
  7. `checkpoint_toll` (`TOLL`): Punkty poboru opłat, bramki viaTOLL/e-TOLL, kontrole.

---

### 2. Matryca Uprawnień (Permissions Matrix — `src/poi/permissionsMatrix.ts`)
Zaawansowany silnik kontroli dostępu (RBAC z elementami ABAC) integrujący się z tożsamością sesji (`UserSession`):

- **Role Systemowe (`StandardUserRole`)**:
  - `ADMIN`: Pełny dostęp administracyjny (zarządzanie schematem, kategoriami systemowymi i customowymi, odczyt/edycja wszystkich POI wraz z polami poufnymi, audyt).
  - `MANAGER` / `DISPATCHER`: Pełne zarządzanie operacyjne POI, tworzenie kategorii customowych, odczyt pól poufnych, import/eksport.
  - `OPERATOR`: Tworzenie, odczyt i edycja POI operacyjnych, eksport danych.
  - `DRIVER`: Odczyt POI nawigacyjnych/operacyjnych, raportowanie zdarzeń/tworzenie POI z trasy; brak dostępu do danych poufnych (`sensitive`) i brak usuwania.
  - `AUDITOR`: Dostęp tylko do odczytu (read-only) do wszystkich kategorii, punktów POI (w tym poufnych) oraz logów audytowych.
  - `VIEWER` / `GUEST`: Tylko odczyt publicznych i aktywnych POI (automatyczne maskowanie pól wrażliwych).
- **Granularne Akcje Uprawnień**:
  - Kategorie: `CATEGORY_CREATE`, `CATEGORY_READ`, `CATEGORY_UPDATE`, `CATEGORY_DELETE`, `CATEGORY_TOGGLE_ACTIVE`, `CATEGORY_MANAGE_SCHEMA`, `CATEGORY_MANAGE_SYSTEM`.
  - Obiekty POI: `POI_CREATE`, `POI_READ`, `POI_READ_SENSITIVE`, `POI_UPDATE`, `POI_DELETE`, `POI_EXPORT`, `POI_IMPORT`, `POI_AUDIT`, `POI_SHARE`.
- **Zabezpieczenia Biznesowe**:
  - **Ochrona Kategorii Systemowych**: Modyfikacja lub usunięcie kategorii `SYSTEM` wymaga uprawnienia `CATEGORY_MANAGE_SYSTEM`.
  - **Izolacja Wielotenantowa (`tenantId`)**: Użytkownicy z danego tenanta mają dostęp wyłącznie do zasobów swojego tenanta (poza administratorem globalnym).
  - **Sanityzacja i Maskowanie Danych (`sanitizePoi`)**: Użytkownicy bez uprawnienia `POI_READ_SENSITIVE` otrzymują wartości pól poufnych zamienione na `[CONFIDENTIAL / MASKED]`.

---

### 3. Walidator i Konwerter GeoJSON RFC 7946
- `PoiSchemaValidator`: Sprawdza zgodność definicji kategorii oraz instancji POI (współrzędne WGS84, typy pól, ograniczenia długości, formaty email/telefon/data/url/select).
- `PoiGeoJsonConverter`: Konwertuje obiekty POI do standardu RFC 7946 GeoJSON `FeatureCollection` z uwzględnieniem stylistyki mapowej kategorii i uprawnień sesji użytkownika.

---

### 4. Rejestr Kategorii i Menedżer POI (`src/poi/categoryRegistry.ts`, `src/poi/poiManager.ts`)
- `PoiCategoryRegistry`: Rejestr kategorii z obsługą schematów, wersjonowania i kontroli uprawnień.
- `PoiManager`: Menedżer cyklu życia POI (CRUD) ze zintegrowanym mechanizmem drenażu `SessionDrainHook`. Przy wylogowaniu lub zmianie użytkownika w kabinie `AuthLockBooth` pamięć podręczna jest natychmiastowo czyszczona.

---

### 5. Integracja z MapLibre GL JS i Koordynatorem Sesji (`src/maplibre/`, `src/integration/`)
- `MapLibrePoiLayerManager`: Zarządza źródłami GeoJSON i warstwami POI na mapie (`circle`, `symbol`, `cluster`). Metoda `clearPoi()` natychmiast resetuje źródło do pustej `FeatureCollection` oraz usuwa markery i popupy HTML.
- `SecureTrackingSessionCoordinator`: Łączy `AuthLockBooth`, `MapLibreRouteManager`, `MapLibrePoiLayerManager` oraz `PoiManager` w spójny ekosystem bezpieczeństwa:
  - Zmiana użytkownika w śluzie (`enterBooth`) bezwarunkowo drenuje zarówno trasę (`clearRoute`), jak i punkty POI (`clearPoi`).
  - Wyświetlanie POI (`displayPois`) automatycznie respektuje uprawnienia aktywnej sesji.

---

## Architektura Modułów

```
src/
├── geojson/
│   ├── types.ts          # Definicje typów RFC 7946 GeoJSON
│   ├── converter.ts      # Konwerter RouteData -> FeatureCollection (LineString + Point)
│   └── validator.ts      # Walidacja zgodności RFC 7946
├── auth/
│   ├── mutex.ts          # Asynchroniczny Mutex dla śluzy
│   ├── storage.ts        # Bezpieczne providery storage (InMemory, SafeBrowser)
│   ├── drainManager.ts   # Menedżer drenażu sesji z AbortController & Hookami
│   ├── authBooth.ts      # Śluza Logowania (Zasada Jednej Kabiny)
│   ├── mobileTypes.ts    # Typy autoryzacji mobilnej i bootstrapu
│   └── mobileGate.ts     # Śluza startowa mobilki (MobileAuthGate)
├── poi/
│   ├── types.ts              # Typy POI, Kategorii, Schematów, Ról i Matrycy Uprawnień
│   ├── schemaValidator.ts    # Walidator schematów atrybutów i integralności POI
│   ├── permissionsMatrix.ts  # Matryca Uprawnień RBAC/ABAC i silnik ewaluacji
│   ├── defaultCategories.ts  # 7 Wbudowanych Kategorii Systemowych
│   ├── converter.ts          # Konwerter POI -> RFC 7946 GeoJSON FeatureCollection
│   ├── categoryRegistry.ts   # Rejestr Kategorii POI
│   └── poiManager.ts         # Menedżer POI zintegrowany ze Śluzą Sesji i Drenażem
├── maplibre/
│   ├── types.ts              # Abstrakcja interfejsów MapLibre GL JS
│   ├── routeManager.ts       # Zarządzanie trasami i procedura clearRoute
│   └── poiLayerManager.ts    # Zarządzanie warstwami POI i procedura clearPoi
├── integration/
│   └── coordinator.ts    # Koordynator sesji, tras i POI (SecureTrackingSessionCoordinator)
└── index.ts              # Główny punkt eksportu biblioteki
```

---

## Przykładowe Użycie

### Tworzenie POI, Walidacja i Wyświetlanie z Matrycą Uprawnień

```typescript
import {
  AuthLockBooth,
  PoiManager,
  PoiCategoryRegistry,
  MapLibrePoiLayerManager,
  SecureTrackingSessionCoordinator,
  MapLibreRouteManager,
  SafeBrowserStorageProvider,
} from 'tracker';

// 1. Inicjalizacja Śluzy Logowania i Rejestrów
const authBooth = new AuthLockBooth({
  storage: new SafeBrowserStorageProvider('localStorage'),
});

const categoryRegistry = new PoiCategoryRegistry();
const poiManager = new PoiManager({ authBooth, categoryRegistry });
const poiLayerManager = new MapLibrePoiLayerManager(mapInstance);
const routeManager = new MapLibreRouteManager(mapInstance);

const coordinator = new SecureTrackingSessionCoordinator(authBooth, routeManager, {
  poiLayerManager,
  poiManager,
});

// 2. Logowanie Dyspozytora
await authBooth.enterBooth({
  sessionId: 'sess-100',
  userId: 'user-dispatcher-1',
  username: 'dispatcher_pl',
  token: 'jwt-disp-token',
  role: 'DISPATCHER',
});

// 3. Dodanie punktu POI (Stacja Paliw)
const poi = poiManager.createPoi({
  id: 'poi-orlen-a2',
  categoryId: 'fuel_station',
  name: 'Orlen Stacja Paliw MOP Brwinów',
  coordinate: [20.7100, 52.1800], // [lon, lat] RFC 7946
  status: 'ACTIVE',
  attributes: {
    brand: 'Orlen',
    fuel_types: ['DIESEL', 'PB95', 'ADBLUE'],
    is_24h: true,
    gate_code: 'PIN-9988', // Pole poufne (sensitive: true)
  },
  createdBy: 'user-dispatcher-1',
});

// 4. Bezpieczne wyświetlenie na mapie
coordinator.displayPois([poi]);

// 5. Zmiana użytkownika na Kierowcę (Zasada Jednej Kabiny)
await authBooth.enterBooth({
  sessionId: 'sess-200',
  userId: 'user-driver-2',
  username: 'driver_adam',
  token: 'jwt-driver-token',
  role: 'DRIVER', // Kierowca nie ma POI_READ_SENSITIVE
});

// Dane poprzedniej sesji zostały automatycznie zdrenowane z mapy i pamięci
```

---

## Budowanie i Testy

```bash
# Uruchomienie pełnego zestawu 66 testów jednostkowych i integracyjnych
npm test

# Kompilacja TypeScript (strict mode, zero błędów)
npm run build
```
