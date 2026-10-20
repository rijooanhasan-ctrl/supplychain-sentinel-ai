import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isPointInRing,
  isPointInPolygon,
  computePointOnPolygon,
  isFarSide,
  declutterLabels,
} from './geo';
import {
  ADMIN1_REGISTRY,
  isCameraOverCountry,
  loadAdmin1Data,
  clearAdmin1Cache,
  selectCountryLabels,
} from './geoLabels';

// Real fixture excerpts from IND.geojson and USA.geojson
const maharashtraFixture = {
  type: 'Feature',
  properties: { name: 'Maharashtra', iso_a2: 'IN' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [72.82, 18.97],
        [73.5, 21.5],
        [80.0, 21.0],
        [80.3, 19.0],
        [74.5, 15.8],
        [73.3, 16.0],
        [72.82, 18.97],
      ],
    ],
  },
};

const karnatakaFixture = {
  type: 'Feature',
  properties: { name: 'Karnataka', iso_a2: 'IN' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [74.1, 14.8],
        [75.0, 17.5],
        [77.6, 18.3],
        [78.5, 13.5],
        [76.8, 11.6],
        [74.8, 12.8],
        [74.1, 14.8],
      ],
    ],
  },
};

const californiaFixture = {
  type: 'Feature',
  properties: { name: 'California', iso_a2: 'US' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-124.4, 40.0],
          [-124.0, 42.0],
          [-120.0, 42.0],
          [-120.0, 39.0],
          [-114.6, 35.0],
          [-114.7, 32.7],
          [-117.1, 32.5],
          [-120.5, 34.5],
          [-124.4, 40.0],
        ],
      ],
    ],
  },
};

const texasFixture = {
  type: 'Feature',
  properties: { name: 'Texas', iso_a2: 'US' },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-103.0, 32.0],
          [-103.0, 36.5],
          [-100.0, 36.5],
          [-100.0, 34.5],
          [-94.0, 33.5],
          [-93.8, 29.8],
          [-97.2, 26.0],
          [-99.5, 27.5],
          [-106.5, 31.8],
          [-103.0, 32.0],
        ],
      ],
    ],
  },
};

describe('Geographic Geometry Pure Utilities', () => {
  describe('isPointInRing and isPointInPolygon', () => {
    it('correctly classifies points inside and outside a simple polygon ring', () => {
      const squareRing = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ];
      expect(isPointInRing([5, 5], squareRing)).toBe(true);
      expect(isPointInRing([15, 5], squareRing)).toBe(false);
      expect(isPointInRing([-1, 5], squareRing)).toBe(false);
    });

    it('correctly handles polygon with interior holes (donut)', () => {
      const donutGeometry = {
        type: 'Polygon',
        coordinates: [
          // Exterior ring: 0,0 to 20,20
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
            [0, 0],
          ],
          // Hole ring: 5,5 to 15,15
          [
            [5, 5],
            [15, 5],
            [15, 15],
            [5, 15],
            [5, 5],
          ],
        ],
      };

      // In meat of donut: lon=2, lat=2 -> inside
      expect(isPointInPolygon({ lat: 2, lon: 2 }, donutGeometry)).toBe(true);
      // Inside hole: lon=10, lat=10 -> outside!
      expect(isPointInPolygon({ lat: 10, lon: 10 }, donutGeometry)).toBe(false);
      // Completely outside exterior: lon=25, lat=25 -> outside
      expect(isPointInPolygon({ lat: 25, lon: 25 }, donutGeometry)).toBe(false);
    });

    it('handles vertex and boundary points gracefully', () => {
      const squareGeometry = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      };
      // Exact vertex match
      expect(isPointInPolygon({ lat: 0, lon: 0 }, squareGeometry)).toBe(true);
      expect(isPointInPolygon({ lat: 10, lon: 10 }, squareGeometry)).toBe(true);
    });

    it('assigns coordinates inside and outside real polygon fixtures for Maharashtra and Karnataka', () => {
      // Coordinates inside Maharashtra (e.g. Pune/Mumbai area: 18.5, 73.8)
      expect(isPointInPolygon({ lat: 19.0, lon: 75.0 }, maharashtraFixture.geometry)).toBe(true);
      // Coordinates outside Maharashtra (e.g. Delhi: 28.6, 77.2)
      expect(isPointInPolygon({ lat: 28.6, lon: 77.2 }, maharashtraFixture.geometry)).toBe(false);
      // Bengaluru is in Karnataka, NOT Maharashtra
      expect(isPointInPolygon({ lat: 13.0, lon: 77.6 }, maharashtraFixture.geometry)).toBe(false);

      // Coordinates inside Karnataka (e.g. central Karnataka: 14.5, 76.0)
      expect(isPointInPolygon({ lat: 14.5, lon: 76.0 }, karnatakaFixture.geometry)).toBe(true);
      // Coordinates outside Karnataka (e.g. Kolkata: 22.57, 88.36)
      expect(isPointInPolygon({ lat: 22.57, lon: 88.36 }, karnatakaFixture.geometry)).toBe(false);
    });

    it('assigns coordinates inside and outside real MultiPolygon fixtures for California and Texas', () => {
      // California inside (e.g. Fresno: 36.7, -119.8)
      expect(isPointInPolygon({ lat: 36.7, lon: -119.8 }, californiaFixture.geometry)).toBe(true);
      // California outside (e.g. New York: 40.7, -74.0)
      expect(isPointInPolygon({ lat: 40.7, lon: -74.0 }, californiaFixture.geometry)).toBe(false);

      // Texas inside (e.g. Austin: 30.3, -97.7)
      expect(isPointInPolygon({ lat: 30.3, lon: -97.7 }, texasFixture.geometry)).toBe(true);
      // Texas outside (e.g. Seattle: 47.6, -122.3)
      expect(isPointInPolygon({ lat: 47.6, lon: -122.3 }, texasFixture.geometry)).toBe(false);
    });
  });

  describe('computePointOnPolygon (Interior Point, NOT Bounding Box Center)', () => {
    it('computes point strictly inside a C-shaped horseshoe polygon where centroid is in empty space', () => {
      // Horseshoe polygon around (0,0)
      // Top bar, left spine, bottom bar. Centroid will fall around x=0.5, y=0 (which is in the open mouth)
      const horseshoeGeometry = {
        type: 'Polygon',
        coordinates: [
          [
            [-5, 5],
            [5, 5],
            [5, 2],
            [-2, 2],
            [-2, -2],
            [5, -2],
            [5, -5],
            [-5, -5],
            [-5, 5],
          ],
        ],
      };

      const pt = computePointOnPolygon(horseshoeGeometry);
      expect(isPointInPolygon(pt, horseshoeGeometry)).toBe(true);
    });

    it('computes point inside a MultiPolygon by selecting the dominant polygon', () => {
      const multi = {
        type: 'MultiPolygon',
        coordinates: [
          // Tiny island
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
          // Major landmass
          [
            [
              [10, 10],
              [30, 10],
              [30, 30],
              [10, 30],
              [10, 10],
            ],
          ],
        ],
      };

      const pt = computePointOnPolygon(multi);
      expect(pt.lat).toBeGreaterThanOrEqual(10);
      expect(pt.lat).toBeLessThanOrEqual(30);
      expect(pt.lon).toBeGreaterThanOrEqual(10);
      expect(pt.lon).toBeLessThanOrEqual(30);
      expect(isPointInPolygon(pt, multi)).toBe(true);
    });
  });

  describe('isFarSide (Spherical Angular Distance Occlusion)', () => {
    it('returns false when target is facing the camera', () => {
      const camera = { lat: 20, lng: 0 };
      // Target at lat 25, lng 5 is very close
      expect(isFarSide(camera, { lat: 25, lng: 5 }, 80)).toBe(false);
    });

    it('returns true when target is on the opposite side of the globe (> 80 degrees away)', () => {
      const camera = { lat: 20, lng: 0 };
      // Target at antipodal position: lat -20, lng 180 (180 degrees away)
      expect(isFarSide(camera, { lat: -20, lng: 180 }, 80)).toBe(true);
      // Target at lng 95 (more than 80 degrees away)
      expect(isFarSide(camera, { lat: 20, lng: 95 }, 80)).toBe(true);
    });
  });

  describe('declutterLabels (Greedy Screen-Space Collision Detection)', () => {
    it('keeps higher-ranked labels and drops overlapping lower-ranked labels', () => {
      const candidates = [
        { id: '1', lat: 20, lng: 10, rank: 5, name: 'Small Town' },
        { id: '2', lat: 20, lng: 10, rank: 1, name: 'Capital City' },
      ];

      // Simple mock projection returning identical screen coordinates
      const mockProject = () => ({ x: 200, y: 200 });
      const viewport = { width: 800, height: 600 };

      const decluttered = declutterLabels(candidates, mockProject, viewport);
      expect(decluttered.length).toBe(1);
      expect(decluttered[0].name).toBe('Capital City');
      expect(decluttered[0].rank).toBe(1);
    });

    it('preserves labels that do not collide', () => {
      const candidates = [
        { id: '1', lat: 20, lng: 10, rank: 1, name: 'City Alpha' },
        { id: '2', lat: 40, lng: 50, rank: 2, name: 'City Beta' },
      ];

      const mockProject = (lat: number) =>
        lat === 20 ? { x: 100, y: 100 } : { x: 500, y: 500 };
      const viewport = { width: 800, height: 600 };

      const decluttered = declutterLabels(candidates, mockProject, viewport);
      expect(decluttered.length).toBe(2);
    });
  });
});

describe('Geographic Labels Selection and Lazy Loading', () => {
  beforeEach(() => {
    clearAdmin1Cache();
  });

  it('selects fewer labels at high altitude and reveals more labels when zoomed in', () => {
    const mockCountries = [
      { id: 'US', name: 'United States', lat: 38, lng: -97, labelrank: 1, min_label: 1 },
      { id: 'DE', name: 'Germany', lat: 51, lng: 10, labelrank: 2, min_label: 2 },
      { id: 'IS', name: 'Iceland', lat: 64, lng: -18, labelrank: 4, min_label: 4 },
      { id: 'LU', name: 'Luxembourg', lat: 49.8, lng: 6.1, labelrank: 6, min_label: 6 },
    ];

    // High altitude (default view, altitude = 2.5)
    const highAltitudeLabels = selectCountryLabels(
      mockCountries,
      { lat: 50, lng: 0, altitude: 2.5 }
    );
    // Only major countries (rank <= 2)
    expect(highAltitudeLabels.map((l) => l.name)).toEqual(['United States', 'Germany']);

    // Close altitude (zoomed in, altitude = 1.0)
    const closeAltitudeLabels = selectCountryLabels(
      mockCountries,
      { lat: 50, lng: 0, altitude: 1.0 }
    );
    // All facing countries revealed
    expect(closeAltitudeLabels.map((l) => l.name)).toContain('Luxembourg');
    expect(closeAltitudeLabels.map((l) => l.name)).toContain('Iceland');
  });

  it('detects camera over India or USA only when altitude < 1.5 and within bounds', () => {
    const indConfig = ADMIN1_REGISTRY.find((c) => c.code === 'IND')!;
    const usaConfig = ADMIN1_REGISTRY.find((c) => c.code === 'USA')!;

    // Above threshold altitude (e.g. 2.0) -> false even if centered
    expect(isCameraOverCountry({ lat: 20, lng: 77, altitude: 2.0 }, indConfig)).toBe(false);

    // Below threshold altitude (e.g. 1.2) and centered over India -> true
    expect(isCameraOverCountry({ lat: 20, lng: 77, altitude: 1.2 }, indConfig)).toBe(true);

    // Below threshold altitude but centered over Europe -> false
    expect(isCameraOverCountry({ lat: 48, lng: 15, altitude: 1.2 }, indConfig)).toBe(false);

    // Centered over USA below threshold -> true
    expect(isCameraOverCountry({ lat: 39, lng: -98, altitude: 1.1 }, usaConfig)).toBe(true);
  });

  it('lazily loads Admin-1 data on need and caches it in memory (called once)', async () => {
    const mockGeoJson = { type: 'FeatureCollection', features: [{ properties: { name: 'Goa' } }] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockGeoJson,
    } as Response);

    // First call triggers fetch
    const data1 = await loadAdmin1Data('IND');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(data1).toEqual(mockGeoJson);

    // Second call returns from memory cache without new fetch
    const data2 = await loadAdmin1Data('IND');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(data2).toEqual(mockGeoJson);

    fetchSpy.mockRestore();
  });
});
