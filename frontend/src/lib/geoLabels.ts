/**
 * Geographic Labels & Admin-1 State Boundary Management
 * Handles country labels, lazy-loaded Admin-1 state boundaries,
 * altitude-based LOD, and camera viewpoint detection.
 */

import { isFarSide } from './geo';

export interface Admin1CountryConfig {
  code: string; // ISO 3166-1 alpha-3, e.g. 'IND', 'USA'
  iso2: string; // 'IN', 'US'
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  dataUrl: string;
}

/**
 * Data-driven registry of countries with Admin-1 state/province boundaries.
 * Adding a new country only requires adding a GeoJSON file and an entry here.
 */
export const ADMIN1_REGISTRY: Admin1CountryConfig[] = [
  {
    code: 'IND',
    iso2: 'IN',
    name: 'India',
    minLat: 6.0,
    maxLat: 37.5,
    minLon: 68.0,
    maxLon: 98.0,
    dataUrl: '/globe/admin1/IND.geojson',
  },
  {
    code: 'USA',
    iso2: 'US',
    name: 'United States',
    minLat: 18.0,
    maxLat: 72.0,
    minLon: -170.0,
    maxLon: -66.0,
    dataUrl: '/globe/admin1/USA.geojson',
  },
];

// In-memory cache for loaded Admin-1 GeoJSON datasets
const admin1Cache = new Map<string, any>();
const inFlightRequests = new Map<string, Promise<any>>();

/**
 * Lazily loads Admin-1 GeoJSON for a specified country on demand.
 * Caches in memory so each country is fetched at most once.
 */
export async function loadAdmin1Data(countryCode: string): Promise<any> {
  const norm = countryCode.toUpperCase();
  const cfg = ADMIN1_REGISTRY.find((c) => c.code === norm || c.iso2 === norm);
  if (!cfg) return null;

  if (admin1Cache.has(cfg.code)) {
    return admin1Cache.get(cfg.code);
  }

  if (inFlightRequests.has(cfg.code)) {
    return inFlightRequests.get(cfg.code);
  }

  const promise = fetch(cfg.dataUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      admin1Cache.set(cfg.code, data);
      inFlightRequests.delete(cfg.code);
      return data;
    })
    .catch((err) => {
      inFlightRequests.delete(cfg.code);
      throw err;
    });

  inFlightRequests.set(cfg.code, promise);
  return promise;
}

export function getCachedAdmin1Data(countryCode: string): any {
  const norm = countryCode.toUpperCase();
  const cfg = ADMIN1_REGISTRY.find((c) => c.code === norm || c.iso2 === norm);
  if (!cfg) return null;
  return admin1Cache.get(cfg.code) || null;
}

export function clearAdmin1Cache(): void {
  admin1Cache.clear();
  inFlightRequests.clear();
}

/**
 * Checks whether the camera POV is zoomed in enough and positioned over a country.
 */
export function isCameraOverCountry(
  cameraPov: { lat: number; lng: number; altitude: number },
  country: Admin1CountryConfig,
  altitudeThreshold = 1.5
): boolean {
  if (cameraPov.altitude >= altitudeThreshold) return false;

  let lng = cameraPov.lng % 360;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;

  return (
    cameraPov.lat >= country.minLat &&
    cameraPov.lat <= country.maxLat &&
    lng >= country.minLon &&
    lng <= country.maxLon
  );
}

export interface GlobeLabelItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rank: number;
  type: 'country' | 'state';
  countryCode?: string;
  countryName?: string;
  fontSize?: number;
  feature?: any;
}

/**
 * Selects candidate country labels based on camera altitude and hides far-side labels.
 * Altitude rules:
 * - Default view (> 2.0): major countries only (rank <= 2)
 * - Medium zoom (1.2 to 2.0): rank <= 4
 * - Close zoom (<= 1.2): all countries
 */
export function selectCountryLabels(
  countries: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    labelrank?: number;
    min_label?: number;
  }>,
  cameraPov: { lat: number; lng: number; altitude: number },
  maxFarSideAngle = 80
): GlobeLabelItem[] {
  const { altitude } = cameraPov;

  return countries
    .filter((c) => {
      // 1. Far-side occlusion test
      if (isFarSide(cameraPov, { lat: c.lat, lng: c.lng }, maxFarSideAngle)) {
        return false;
      }

      // 2. Altitude importance threshold
      const rank = c.labelrank ?? c.min_label ?? 3;
      if (altitude > 2.0) {
        return rank <= 2;
      } else if (altitude > 1.2) {
        return rank <= 4;
      }
      return true;
    })
    .map((c) => ({
      id: `country-${c.id}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      rank: c.labelrank ?? 3,
      type: 'country' as const,
      countryCode: c.id,
      countryName: c.name,
      fontSize: altitude > 2.0 ? 11 : altitude > 1.2 ? 12 : 13,
    }));
}
