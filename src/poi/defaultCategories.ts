import type { PoiCategory, PoiFieldDefinition } from './types.js';

const NOW = 1755500000000;

const FUEL_STATION_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'brand',
    label: 'Marka / Sieć',
    type: 'STRING',
    required: true,
    validation: { min: 1, max: 50 },
  },
  {
    key: 'fuel_types',
    label: 'Dostępne paliwa',
    type: 'MULTISELECT',
    required: true,
    validation: {
      options: ['DIESEL', 'PB95', 'PB98', 'LPG', 'ADBLUE', 'EV_FAST', 'EV_STANDARD', 'H2', 'LNG', 'CNG'],
    },
  },
  {
    key: 'is_24h',
    label: 'Czynna 24h/7',
    type: 'BOOLEAN',
    defaultValue: true,
  },
  {
    key: 'truck_friendly',
    label: 'Dostęp dla TIR / Ciężarówek',
    type: 'BOOLEAN',
    defaultValue: true,
  },
  {
    key: 'has_adblue_pump',
    label: 'Dystrybutor AdBlue',
    type: 'BOOLEAN',
  },
  {
    key: 'payment_cards',
    label: 'Akceptowane karty flotowe',
    type: 'MULTISELECT',
    validation: {
      options: ['DKV', 'UTA', 'SHELL', 'ORLEN', 'BP', 'VISA', 'MASTERCARD', 'CASH'],
    },
  },
  {
    key: 'contact_phone',
    label: 'Telefon kontaktowy',
    type: 'PHONE',
  },
  {
    key: 'gate_code',
    label: 'Kod dostępu / PIN bramki',
    type: 'STRING',
    sensitive: true,
  },
];

export const FUEL_STATION_CATEGORY: PoiCategory = Object.freeze({
  id: 'fuel_station',
  code: 'FUEL',
  name: 'Stacja Paliw (Fuel Station)',
  description: 'Stacja benzynowa, punkt tankowania paliwa, LPG, AdBlue lub ładowania EV',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#0288D1',
    iconName: 'fuel-station',
    iconSize: 1.2,
    minZoom: 6,
    maxZoom: 24,
    zIndex: 10,
    clusterable: true,
  },
  attributesSchema: FUEL_STATION_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

const WAREHOUSE_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'facility_name',
    label: 'Nazwa obiektu',
    type: 'STRING',
    required: true,
    validation: { min: 2, max: 100 },
  },
  {
    key: 'ramp_count',
    label: 'Liczba ramp załadunkowych',
    type: 'NUMBER',
    validation: { min: 0, max: 200 },
  },
  {
    key: 'requires_booking',
    label: 'Wymagana awizacja (Time Slot)',
    type: 'BOOLEAN',
    defaultValue: false,
  },
  {
    key: 'operating_hours',
    label: 'Godziny pracy magazynu',
    type: 'STRING',
  },
  {
    key: 'contact_email',
    label: 'Email dyspozytorni magazynu',
    type: 'EMAIL',
  },
  {
    key: 'contact_phone',
    label: 'Telefon do dyspozytora rampy',
    type: 'PHONE',
  },
  {
    key: 'security_gate_code',
    label: 'Kod do szlabanu / bramy wjazdowej',
    type: 'STRING',
    sensitive: true,
  },
];

export const WAREHOUSE_LOGISTICS_CATEGORY: PoiCategory = Object.freeze({
  id: 'warehouse_logistics',
  code: 'WH',
  name: 'Centrum Logistyczne / Magazyn (Warehouse)',
  description: 'Centrum dystrybucyjne, magazyn wysokiego składowania, rampa załadunkowa',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#7B1FA2',
    iconName: 'warehouse',
    iconSize: 1.2,
    minZoom: 5,
    maxZoom: 24,
    zIndex: 15,
    clusterable: true,
  },
  attributesSchema: WAREHOUSE_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

const CUSTOMER_SITE_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'client_code',
    label: 'Kod kontrahenta / ERP ID',
    type: 'STRING',
    required: true,
    validation: { min: 1, max: 50 },
  },
  {
    key: 'contact_person',
    label: 'Osoba kontaktowa na miejscu',
    type: 'STRING',
  },
  {
    key: 'contact_phone',
    label: 'Telefon kontaktowy do odbioru',
    type: 'PHONE',
    required: true,
  },
  {
    key: 'unloading_type',
    label: 'Typ rozładunku',
    type: 'SELECT',
    validation: {
      options: ['RAMP', 'FORKLIFT', 'TAIL_LIFT', 'MANUAL', 'CRANE'],
    },
  },
  {
    key: 'delivery_instructions',
    label: 'Instrukcje dojazdu i rozładunku',
    type: 'STRING',
  },
  {
    key: 'vip_access_code',
    label: 'Kod wejścia / PIN alarmu',
    type: 'STRING',
    sensitive: true,
  },
];

export const CUSTOMER_SITE_CATEGORY: PoiCategory = Object.freeze({
  id: 'customer_site',
  code: 'CUST',
  name: 'Punkt Klienta / Dostawy (Customer Site)',
  description: 'Docelowe miejsce dostawy towaru, odbiorca lub dostawca',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#2E7D32',
    iconName: 'customer-site',
    minZoom: 6,
    maxZoom: 24,
    zIndex: 20,
    clusterable: true,
  },
  attributesSchema: CUSTOMER_SITE_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

const REST_AREA_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'truck_capacity',
    label: 'Liczba miejsc TIR',
    type: 'NUMBER',
    validation: { min: 0, max: 1000 },
  },
  {
    key: 'is_guarded',
    label: 'Parking strzeżony / monitorowany',
    type: 'BOOLEAN',
  },
  {
    key: 'has_showers',
    label: 'Prysznice dla kierowców',
    type: 'BOOLEAN',
  },
  {
    key: 'has_restaurant',
    label: 'Gastronomia / Restauracja',
    type: 'BOOLEAN',
  },
  {
    key: 'cost_per_hour_pln',
    label: 'Koszt postoju (PLN/h)',
    type: 'NUMBER',
    validation: { min: 0 },
  },
];

export const REST_AREA_TRUCK_STOP_CATEGORY: PoiCategory = Object.freeze({
  id: 'rest_area_truck_stop',
  code: 'REST',
  name: 'Parking TIR / MOP (Truck Rest Area)',
  description: 'Miejsce Obsługi Podróżnych (MOP), parking dla samochodów ciężarowych, strefa odpoczynku kierowcy',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#E65100',
    iconName: 'parking-rest',
    minZoom: 7,
    maxZoom: 24,
    zIndex: 8,
    clusterable: true,
  },
  attributesSchema: REST_AREA_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

const SERVICE_WORKSHOP_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'services_offered',
    label: 'Zakres usług',
    type: 'MULTISELECT',
    required: true,
    validation: {
      options: ['MECHANICAL', 'TIRE_SERVICE', 'ELECTRIC', 'TACHO_CALIBRATION', 'TOWING', 'BODY_WORK'],
    },
  },
  {
    key: 'authorized_brands',
    label: 'Obsługiwane marki',
    type: 'MULTISELECT',
    validation: {
      options: ['MAN', 'SCANIA', 'VOLVO', 'DAF', 'MERCEDES', 'IVECO', 'RENAULT', 'TRAILER_ALL', 'UNIVERSAL'],
    },
  },
  {
    key: 'emergency_24h_phone',
    label: 'Telefon alarmowy 24h Serwis',
    type: 'PHONE',
    required: true,
  },
];

export const SERVICE_WORKSHOP_CATEGORY: PoiCategory = Object.freeze({
  id: 'service_workshop',
  code: 'SRV',
  name: 'Punkt Serwisowy / Warsztat (Service Workshop)',
  description: 'Autoryzowany serwis pojazdów, wulkanizacja, pomoc drogowa',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#455A64',
    iconName: 'wrench-service',
    minZoom: 7,
    maxZoom: 24,
    zIndex: 12,
    clusterable: true,
  },
  attributesSchema: SERVICE_WORKSHOP_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

const HAZARD_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'hazard_type',
    label: 'Typ zagrożenia',
    type: 'SELECT',
    required: true,
    validation: {
      options: ['HEIGHT_LIMIT', 'WEIGHT_LIMIT', 'ROAD_WORKS', 'BRIDGE_CLOSED', 'FLOOD', 'STEEP_SLOPE', 'CRIME_HOTSPOT'],
    },
  },
  {
    key: 'severity',
    label: 'Poziom istotności',
    type: 'SELECT',
    required: true,
    validation: {
      options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    },
  },
  {
    key: 'max_height_meters',
    label: 'Maksymalna wysokość (metry)',
    type: 'NUMBER',
    validation: { min: 1.5, max: 6.0 },
  },
  {
    key: 'max_weight_tons',
    label: 'Dopuszczalna masa całkowita (tony)',
    type: 'NUMBER',
    validation: { min: 1.0, max: 100.0 },
  },
  {
    key: 'valid_until',
    label: 'Ważność utrudnienia do',
    type: 'DATE',
  },
];

export const HAZARD_DANGER_ZONE_CATEGORY: PoiCategory = Object.freeze({
  id: 'hazard_danger_zone',
  code: 'HAZARD',
  name: 'Strefa Zagrożenia / Utrudnienia (Hazard Zone)',
  description: 'Ograniczenia tonażowe, niskie wiadukty, roboty drogowe, strefy niebezpieczne',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#D50000',
    iconName: 'hazard-warning',
    iconSize: 1.3,
    minZoom: 4,
    maxZoom: 24,
    zIndex: 30,
    pulseAnimation: true,
  },
  attributesSchema: HAZARD_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

const CHECKPOINT_FIELDS: readonly PoiFieldDefinition[] = [
  {
    key: 'toll_type',
    label: 'Typ punktu kontroli',
    type: 'SELECT',
    required: true,
    validation: {
      options: ['ELECTRONIC_BOX', 'MANUAL_BOOTH', 'BORDER_CONTROL', 'WEIGH_STATION', 'POLICE_INSPECTION'],
    },
  },
  {
    key: 'electronic_systems',
    label: 'Obsługiwane systemy elektroniczne',
    type: 'MULTISELECT',
    validation: {
      options: ['E-TOLL', 'VIATOLL', 'TELEPASS', 'GO_BOX', 'TOLL_COLLECT', 'ASFINAG', 'OTHER'],
    },
  },
  {
    key: 'accepted_currencies',
    label: 'Akceptowane waluty',
    type: 'MULTISELECT',
    validation: {
      options: ['PLN', 'EUR', 'USD', 'CZK', 'CARD_ONLY'],
    },
  },
];

export const CHECKPOINT_TOLL_CATEGORY: PoiCategory = Object.freeze({
  id: 'checkpoint_toll',
  code: 'TOLL',
  name: 'Bramka / Punkt Kontrolny (Checkpoint & Toll)',
  description: 'Punkt poboru opłat drogowych, przejście graniczne, punkt kontroli inspekcji transportu',
  classification: 'SYSTEM',
  status: 'ACTIVE',
  style: {
    markerColor: '#C2185B',
    iconName: 'checkpoint-toll',
    minZoom: 6,
    maxZoom: 24,
    zIndex: 14,
  },
  attributesSchema: CHECKPOINT_FIELDS,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
});

export const DEFAULT_SYSTEM_CATEGORIES: readonly PoiCategory[] = Object.freeze([
  FUEL_STATION_CATEGORY,
  WAREHOUSE_LOGISTICS_CATEGORY,
  CUSTOMER_SITE_CATEGORY,
  REST_AREA_TRUCK_STOP_CATEGORY,
  SERVICE_WORKSHOP_CATEGORY,
  HAZARD_DANGER_ZONE_CATEGORY,
  CHECKPOINT_TOLL_CATEGORY,
]);
