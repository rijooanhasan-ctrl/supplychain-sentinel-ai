/**
 * Geographic Geometry & Projection Utilities for SupplyChain Sentinel Globe.
 * Pure functions for point-in-polygon, interior point (point-on-polygon),
 * angular distance (far-side occlusion), and screen-space decluttering.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface ScreenBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DeclutterCandidate {
  id: string;
  lat: number;
  lng: number;
  rank: number; // lower number = higher importance (e.g. scalerank 0 > 1 > 2)
  name: string;
  minAltitude?: number; // camera altitude threshold
  maxAltitude?: number;
  fontSize?: number;
  [key: string]: any;
}

/**
 * Ray-casting algorithm to test if [lon, lat] is inside a polygon linear ring.
 */
export function isPointInRing(point: [number, number], ring: number[][]): boolean {
  const [lon, lat] = point;
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    // Check exact vertex match
    if (Math.abs(xi - lon) < 1e-7 && Math.abs(yi - lat) < 1e-7) {
      return true;
    }

    // Check segment crossing
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Determines whether a point [lat, lon] is inside a Polygon or MultiPolygon geometry.
 * Correctly respects interior holes (points inside holes are outside).
 */
export function isPointInPolygon(
  coords: { lat: number; lon: number },
  geometry: { type: string; coordinates: any }
): boolean {
  if (!geometry || !geometry.coordinates) return false;
  const point: [number, number] = [coords.lon, coords.lat];

  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as number[][][];
    if (!rings || rings.length === 0) return false;

    // Must be inside exterior ring (rings[0])
    if (!isPointInRing(point, rings[0])) return false;

    // Must NOT be inside any interior hole ring (rings[1...n])
    for (let h = 1; h < rings.length; h++) {
      if (isPointInRing(point, rings[h])) {
        return false;
      }
    }
    return true;
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates as number[][][][];
    if (!polygons) return false;

    for (const polyRings of polygons) {
      if (!polyRings || polyRings.length === 0) continue;
      if (isPointInRing(point, polyRings[0])) {
        // Check holes
        let inHole = false;
        for (let h = 1; h < polyRings.length; h++) {
          if (isPointInRing(point, polyRings[h])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Computes approximate area of a linear ring (polygon exterior).
 */
function ringArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

/**
 * Computes a robust point strictly inside a polygon or multipolygon (interior point, NOT bounding box center).
 * Handles:
 * - Holes (excludes interior holes)
 * - MultiPolygons (selects the largest polygon ring)
 * - Antimeridian-adjacent shapes
 * - C-shaped / horseshoe polygons where the centroid is outside.
 */
export function computePointOnPolygon(geometry: { type: string; coordinates: any }): {
  lat: number;
  lon: number;
} {
  if (!geometry || !geometry.coordinates) {
    return { lat: 0, lon: 0 };
  }

  // Pick target rings
  let targetRings: number[][][];
  if (geometry.type === 'Polygon') {
    targetRings = geometry.coordinates as number[][][];
  } else if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as number[][][][];
    if (!polys || polys.length === 0) return { lat: 0, lon: 0 };
    // Find polygon with largest exterior area
    let maxArea = -1;
    let bestPoly = polys[0];
    for (const p of polys) {
      if (p && p.length > 0) {
        const a = ringArea(p[0]);
        if (a > maxArea) {
          maxArea = a;
          bestPoly = p;
        }
      }
    }
    targetRings = bestPoly;
  } else {
    return { lat: 0, lon: 0 };
  }

  const exterior = targetRings[0];
  if (!exterior || exterior.length < 3) return { lat: 0, lon: 0 };

  // Calculate polygon bounding box
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  let sumLon = 0;
  let sumLat = 0;

  for (const pt of exterior) {
    const [lon, lat] = pt;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    sumLon += lon;
    sumLat += lat;
  }

  // 1. Try centroid first
  const centroidLat = sumLat / exterior.length;
  const centroidLon = sumLon / exterior.length;
  if (isPointInPolygon({ lat: centroidLat, lon: centroidLon }, { type: 'Polygon', coordinates: targetRings })) {
    return { lat: centroidLat, lon: centroidLon };
  }

  // 2. If centroid is outside (e.g. C-shape, crescent, or in a hole), shoot horizontal scanlines
  const tSteps = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
  let bestCandidate: { lat: number; lon: number } | null = null;
  let maxSegmentLength = -1;

  for (const t of tSteps) {
    const scanLat = minLat + (maxLat - minLat) * t;

    // Find all intersections of y = scanLat with exterior edges
    const intersections: number[] = [];
    for (let i = 0, j = exterior.length - 1; i < exterior.length; j = i++) {
      const [x1, y1] = exterior[j];
      const [x2, y2] = exterior[i];
      if ((y1 <= scanLat && y2 > scanLat) || (y2 <= scanLat && y1 > scanLat)) {
        const xInt = x1 + ((scanLat - y1) / (y2 - y1)) * (x2 - x1);
        intersections.push(xInt);
      }
    }

    intersections.sort((a, b) => a - b);

    // Pairs of intersections represent interior segments [i0, i1], [i2, i3]...
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const segStart = intersections[i];
      const segEnd = intersections[i + 1];
      const segLen = segEnd - segStart;
      const midLon = (segStart + segEnd) / 2;

      // Verify that midpoint is inside and outside all holes
      if (isPointInPolygon({ lat: scanLat, lon: midLon }, { type: 'Polygon', coordinates: targetRings })) {
        if (segLen > maxSegmentLength) {
          maxSegmentLength = segLen;
          bestCandidate = { lat: scanLat, lon: midLon };
        }
      }
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  // Fallback to bounding box center
  return {
    lat: (minLat + maxLat) / 2,
    lon: (minLon + maxLon) / 2,
  };
}

/**
 * Calculates angular distance (in degrees) on a sphere between camera center POV and a target coordinate.
 * Returns true if target is on the far side (angular distance > maxAngularDistanceDeg).
 * Useful to hide far-side labels so they do not show through the globe.
 */
export function isFarSide(
  cameraCenter: { lat: number; lng: number },
  target: { lat: number; lng: number },
  maxAngularDistanceDeg = 80
): boolean {
  const toRad = Math.PI / 180;
  const phi1 = cameraCenter.lat * toRad;
  const phi2 = target.lat * toRad;
  const deltaLambda = (target.lng - cameraCenter.lng) * toRad;

  // Spherical law of cosines
  let cosD = Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  // Clamp to [-1, 1] for numeric safety
  if (cosD > 1) cosD = 1;
  if (cosD < -1) cosD = -1;

  const angularDistDeg = Math.acos(cosD) * (180 / Math.PI);
  return angularDistDeg > maxAngularDistanceDeg;
}

/**
 * Greedy screen-space decluttering.
 * - Sorts candidates by rank/importance (lower rank number first).
 * - Projects to 2D screen box.
 * - Discards candidates whose bounding boxes overlap already-placed labels.
 */
export function declutterLabels<T extends DeclutterCandidate>(
  candidates: T[],
  project: (lat: number, lng: number) => { x: number; y: number } | null,
  viewport: { width: number; height: number },
  padding = 4
): T[] {
  // Sort: higher importance first (lowest rank)
  const sorted = [...candidates].sort((a, b) => (a.rank ?? 5) - (b.rank ?? 5));
  const acceptedBoxes: ScreenBox[] = [];
  const acceptedItems: T[] = [];

  for (const item of sorted) {
    const pt = project(item.lat, item.lng);
    if (!pt) continue;

    // Reject if outside viewport boundaries
    if (pt.x < 0 || pt.x > viewport.width || pt.y < 0 || pt.y > viewport.height) {
      continue;
    }

    // Estimate label text bounding box
    const fontSize = item.fontSize || 11;
    const estWidth = item.name.length * (fontSize * 0.55) + padding * 2;
    const estHeight = fontSize + padding * 2;

    const box: ScreenBox = {
      x1: pt.x - estWidth / 2,
      y1: pt.y - estHeight / 2,
      x2: pt.x + estWidth / 2,
      y2: pt.y + estHeight / 2,
    };

    // Check collision against previously accepted boxes
    let collides = false;
    for (const existing of acceptedBoxes) {
      if (
        box.x1 < existing.x2 &&
        box.x2 > existing.x1 &&
        box.y1 < existing.y2 &&
        box.y2 > existing.y1
      ) {
        collides = true;
        break;
      }
    }

    if (!collides) {
      acceptedBoxes.push(box);
      acceptedItems.push(item);
    }
  }

  return acceptedItems;
}
