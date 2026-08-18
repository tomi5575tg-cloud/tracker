# Tracker — Śluza Logowania (Zasada Jednej Kabiny), Drenaż Sesji (clearRoute) i Autoryzacja Startowa Mobilka

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

### 2. Pancerny Drenaż: Funkcja `clearRoute` i Reset Mapy
Zapewnia całkowity brak wycieków danych telemetrycznych oraz wizualnych między użytkownikami:
- Zatrzymuje wszelkie aktywne animacje kamery (`map.stop()`).
- Resetuje źródła GeoJSON w MapLibre do pustych `FeatureCollection` zgodnych z RFC 7946 (`setData`).
- Usuwa i niszczy aktywne markery HTML (`MapLibreMarker`) i popupy (`MapLibrePopup`).
- Opcjonalnie resetuje kamerę mapy (`jumpTo`) do domyślnego widoku.
- Anuluje wszystkie aktywne zapytania i operacje poprzedniej sesji za pomocą `AbortController` (`getSessionAbortSignal()`).
- Czyści magazyn stanu (`StorageProvider`) i pamięć podręczną.

### 3. Autoryzacja Startowa Mobilka (`MobileAuthGate`)
Zabezpiecza start i przywracanie sesji aplikacji mobilnej (React Native / Capacitor / PWA):
- **Bootstraping sesji**: Odczyt z bezpiecznego magazynu (`SecureStorage`).
- **Zdalna weryfikacja tokena (`MobileTokenValidator`)**: Weryfikacja tożsamości i powiązania z urządzeniem (`deviceId`).
- **Obsługa utraty ważności (`EXPIRED_DRAINED`)**: W przypadku cofnięcia/wygaśnięcia uprawnień aplikacja natychmiast uruchamia procedurę drenażu i wylogowuje do stanu czystego.
- **Tryb Offline (`OFFLINE_RESTORED`)**: Kontynuacja pracy w przypadku chwilowego braku łączności bez kompromitacji bezpieczeństwa.

### 4. Zgodność z RFC 7946 GeoJSON
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
│   ├── authBooth.ts      # Śluza Logowania (Zasada Jednej Kabiny)
│   ├── mobileTypes.ts    # Typy autoryzacji mobilnej i bootstrapu
│   └── mobileGate.ts     # Śluza startowa mobilki (MobileAuthGate)
├── maplibre/
│   ├── types.ts          # Abstrakcja interfejsów MapLibre GL JS
│   └── routeManager.ts   # Zarządzanie warstwami trasy i procedura clearRoute
├── integration/
│   └── coordinator.ts    # Koordynator sesji i mapy (SecureTrackingSessionCoordinator)
└── index.ts              # Główny punkt eksportu biblioteki
```

---

## Przykładowe Użycie

### Inicjalizacja Mobilna ze Śluzą i Mapą

```typescript
import {
  AuthLockBooth,
  MobileAuthGate,
  MapLibreRouteManager,
  SecureTrackingSessionCoordinator,
  SafeBrowserStorageProvider,
} from 'tracker';

// 1. Inicjalizacja Śluzy i Mapy
const authBooth = new AuthLockBooth({
  storage: new SafeBrowserStorageProvider('localStorage'),
});

const routeManager = new MapLibreRouteManager(mapInstance, {}, { center: [19.0, 52.0], zoom: 6 });

// 2. Utworzenie koordynatora sesji i mapy
const coordinator = new SecureTrackingSessionCoordinator(authBooth, routeManager, {
  clearRouteOptions: { resetCamera: true, stopAnimations: true },
});

// 3. Autoryzacja Startowa Mobilka
const mobileGate = new MobileAuthGate({
  booth: authBooth,
  deviceContext: {
    deviceId: 'device-uuid-1234',
    platform: 'android',
    appVersion: '2.5.0',
  },
  tokenValidator: {
    validateToken: async (token, deviceId) => {
      const res = await fetch('/api/v1/auth/verify', {
        headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId ?? '' },
      });
      return { isValid: res.ok };
    },
  },
});

// Start aplikacji mobilnej:
const bootstrapResult = await mobileGate.bootstrap();
if (bootstrapResult.status === 'RESTORED') {
  console.log('Sesja wznowiona dla:', bootstrapResult.session.username);
}
```

---

## Budowanie i Testy

```bash
# Uruchomienie pełnego zestawu 24 testów jednostkowych i integracyjnych
npm test

# Kompilacja TypeScript (strict mode)
npm run build
```
