import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PUBLIC_GLOBE_DIR = path.resolve(ROOT_DIR, 'frontend/public/globe');
const ADMIN1_DIR = path.resolve(PUBLIC_GLOBE_DIR, 'admin1');

if (!fs.existsSync(ADMIN1_DIR)) {
  fs.mkdirSync(ADMIN1_DIR, { recursive: true });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function isPointInRing(point, ring) {
  const [lon, lat] = point;
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygon(coords, geometry) {
  if (!geometry || !geometry.coordinates) return false;
  const point = [coords.lon, coords.lat];
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates;
    if (!rings || rings.length === 0) return false;
    if (!isPointInRing(point, rings[0])) return false;
    for (let h = 1; h < rings.length; h++) {
      if (isPointInRing(point, rings[h])) return false;
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      if (poly && poly.length > 0 && isPointInRing(point, poly[0])) {
        let inHole = false;
        for (let h = 1; h < poly.length; h++) {
          if (isPointInRing(point, poly[h])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
  }
  return false;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

function computePointOnPolygon(geometry) {
  if (!geometry || !geometry.coordinates) return { lat: 0, lon: 0 };
  let targetRings;
  if (geometry.type === 'Polygon') {
    targetRings = geometry.coordinates;
  } else if (geometry.type === 'MultiPolygon') {
    let maxArea = -1;
    let bestPoly = geometry.coordinates[0];
    for (const p of geometry.coordinates) {
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

  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  let sumLon = 0, sumLat = 0;
  for (const pt of exterior) {
    const [lon, lat] = pt;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    sumLon += lon;
    sumLat += lat;
  }

  const centroid = { lat: sumLat / exterior.length, lon: sumLon / exterior.length };
  if (isPointInPolygon(centroid, { type: 'Polygon', coordinates: targetRings })) {
    return centroid;
  }

  const tSteps = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
  let bestCandidate = null;
  let maxSegLen = -1;
  for (const t of tSteps) {
    const scanLat = minLat + (maxLat - minLat) * t;
    const intersections = [];
    for (let i = 0, j = exterior.length - 1; i < exterior.length; j = i++) {
      const [x1, y1] = exterior[j];
      const [x2, y2] = exterior[i];
      if ((y1 <= scanLat && y2 > scanLat) || (y2 <= scanLat && y1 > scanLat)) {
        intersections.push(x1 + ((scanLat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const segLen = intersections[i + 1] - intersections[i];
      const midLon = (intersections[i] + intersections[i + 1]) / 2;
      if (isPointInPolygon({ lat: scanLat, lon: midLon }, { type: 'Polygon', coordinates: targetRings })) {
        if (segLen > maxSegLen) {
          maxSegLen = segLen;
          bestCandidate = { lat: scanLat, lon: midLon };
        }
      }
    }
  }

  return bestCandidate || { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

async function main() {
  console.log('1. Building Country Labels from countries-110m.geojson...');
  const countriesFile = path.resolve(PUBLIC_GLOBE_DIR, 'countries-110m.geojson');
  if (fs.existsSync(countriesFile)) {
    const countryGeo = JSON.parse(fs.readFileSync(countriesFile, 'utf8'));
    const countryLabels = countryGeo.features.map((feat) => {
      const p = feat.properties || {};
      const interior = computePointOnPolygon(feat.geometry);
      return {
        id: p.ISO_A2 || p.ADM0_A3 || p.NAME,
        name: p.NAME || p.ADMIN || '',
        iso_a2: p.ISO_A2 || '',
        adm0_a3: p.ADM0_A3 || '',
        lat: interior.lat,
        lng: interior.lon,
        labelrank: p.LABELRANK != null ? p.LABELRANK : 3,
        min_label: p.MIN_LABEL != null ? p.MIN_LABEL : 3,
        scalerank: p.scalerank != null ? p.scalerank : 1,
      };
    });

    const labelsPath = path.resolve(PUBLIC_GLOBE_DIR, 'country-labels.json');
    fs.writeFileSync(labelsPath, JSON.stringify(countryLabels, null, 2), 'utf8');
    console.log(`Generated ${countryLabels.length} country labels -> ${labelsPath} (${(fs.statSync(labelsPath).size / 1024).toFixed(1)} KB)`);
  }

  console.log('2. Fetching Natural Earth Admin 1 (States / Provinces 50m)...');
  const sourceUrl = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';
  const admin1Data = await fetchJson(sourceUrl);
  console.log(`Fetched ${admin1Data.features.length} total features from Natural Earth.`);

  const countriesConfig = [
    { code: 'IND', filter: (f) => f.properties.iso_a2 === 'IN' || f.properties.adm0_a3 === 'IND' },
    { code: 'USA', filter: (f) => f.properties.iso_a2 === 'US' || f.properties.adm0_a3 === 'USA' },
  ];

  for (const cfg of countriesConfig) {
    const matched = admin1Data.features.filter(cfg.filter);
    const cleanedFeatures = matched.map((feat) => {
      const p = feat.properties || {};
      let lat = p.latitude;
      let lon = p.longitude;
      if (lat == null || lon == null) {
        const interior = computePointOnPolygon(feat.geometry);
        lat = interior.lat;
        lon = interior.lon;
      }

      return {
        type: 'Feature',
        properties: {
          name: p.name || '',
          name_en: p.name_en || p.name || '',
          iso_a2: p.iso_a2 || '',
          adm0_a3: p.adm0_a3 || cfg.code,
          latitude: lat,
          longitude: lon,
          min_label: p.min_label != null ? p.min_label : 4,
          labelrank: p.labelrank != null ? p.labelrank : 4,
          scalerank: p.scalerank != null ? p.scalerank : 2,
        },
        geometry: feat.geometry,
      };
    });

    const outGeoJson = {
      type: 'FeatureCollection',
      features: cleanedFeatures,
    };

    const outPath = path.resolve(ADMIN1_DIR, `${cfg.code}.geojson`);
    fs.writeFileSync(outPath, JSON.stringify(outGeoJson), 'utf8');
    const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`Saved ${cfg.code} admin-1 with ${cleanedFeatures.length} states -> ${outPath} (${sizeKb} KB)`);
  }

  console.log('Geo data build completed successfully.');
}

main().catch((err) => {
  console.error('Build geo data error:', err);
  process.exit(1);
});
