# Tracker — Śluza Logowania (Zasada Jednej Kabiny) & Drenaż Sesji (clearRoute)

Pancerna, modularna implementacja architektury bezpieczeństwa sesji i wizualizacji mapowej w oparciu o:
- **TypeScript** (Strict Mode, 100% type-safe)
- **MapLibre GL JS** (Dynamic GeoJSON sources & layers, memory cleanup)
- **RFC 7946 GeoJSON** (Ścisła walidacja geometrii `[longitude, latitude]` oraz `FeatureCollection`)

---

## Główne Koncepcje

### 1. Śluza Logowania (Zasada Jednej Kabiny / Single Booth Invariant)
W jednym momencie w "kabinie" (`AuthLockBooth`) może przebywać **tylko jedna sesja / jeden użytkownik**:
- Wszelkie przejścia przez śluzę są synchronizowane asynchronicznym muteksem (`AsyncMutex`).
- Wejście nowego użytkownika do kabiny natychmiast wyzwala automatyczny, bezwarunkowy **Drenaż Poprzedniej Sesji (Session Drain)** zanim nowy użytkownik zostanie zainstalowany w kabinie.
- Odporność na wyścigi (race conditions) przy współbieżnych logowaniach/wylogowaniach.

### 2. Drenaż Sesji (clearRoute)
Zapewnia całkowity brak wycieków danych telemetrycznych oraz wizualnych między użytkownikami:
- Resetuje źródła GeoJSON w MapLibre do pustych `FeatureCollection` zgodnych z RFC 7946 (`setData`).
- Usuwa i niszczy aktywne markery HTML (`MapLibreMarker`) i popupy (`MapLibrePopup`).
- Anuluje wszystkie aktywne zapytania i operacje poprzedniej sesji za pomocą `AbortController` (`getSessionAbortSignal()`).
- Czyści magazyn stanu (`StorageProvider`) i pamięć podręczną.

### 3. Zgodność z RFC 7946 GeoJSON
- Geometrie `LineString` i `Point` generowane zgodnie ze standardem RFC 7946 (kolejność współrzędnych `[długość_geograficzna, szerokość_geograficzna]`, tj. `[lon, lat]`).
- Walidator współrzędnych WGS84 (`[-180 <= lon <= 180]`, `[-90 <= lat <= 90]`).
- Puste kolekcje zwracają poprawny obiekt `{ type: "FeatureCollection", features: [] }`.

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
│   └── authBooth.ts      # Śluza Logowania (Zasada Jednej Kabiny)
├── maplibre/
│   ├── types.ts          # Abstrakcja interfejsów MapLibre GL JS
│   └── routeManager.ts   # Zarządzanie warstwami trasy i procedura clearRoute
├── integration/
│   └── coordinator.ts    # Koordynator sesji i mapy (SecureTrackingSessionCoordinator)
└── index.ts              # Główny punkt eksportu biblioteki
```

---

## Przykładowe Użycie

```typescript
import {
  AuthLockBooth,
  MapLibreRouteManager,
  SecureTrackingSessionCoordinator,
  SafeBrowserStorageProvider,
} from 'tracker';

// 1. Inicjalizacja Śluzy i Mapy
const authBooth = new AuthLockBooth({
  storage: new SafeBrowserStorageProvider('localStorage'),
});

const routeManager = new MapLibreRouteManager(mapInstance);

// 2. Utworzenie koordynatora sesji i mapy
const coordinator = new SecureTrackingSessionCoordinator(authBooth, routeManager);

// 3. Logowanie użytkownika do Śluzy
await authBooth.enterBooth({
  sessionId: 'sess-abc-123',
  userId: 'usr-42',
  username: 'jan_kowalski',
  token: 'jwt-bearer-token',
});

// 4. Bezpieczne wyświetlenie trasy
coordinator.displayRoute({
  routeId: 'route-99',
  userId: 'usr-42',
  distanceMeters: 15400,
  durationSeconds: 1800,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  waypoints: [
    { id: 'wp-1', coordinate: [21.0122, 52.2297], timestamp: Date.now() },
    { id: 'wp-2', coordinate: [21.0180, 52.2350], timestamp: Date.now() + 60000 },
  ],
});

// 5. Wylogowanie lub przełączenie użytkownika -> automatyczny drenaż clearRoute!
await authBooth.exitBooth();
```

---

## Budowanie i Testy

```bash
# Uruchomienie pełnego zestawu testów jednostkowych i integracyjnych
npm test

# Kompilacja TypeScript (strict mode)
npm run build
```
