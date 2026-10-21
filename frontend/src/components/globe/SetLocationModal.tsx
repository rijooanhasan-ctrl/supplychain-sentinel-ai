import React, { useState } from 'react';
import { overrideLocation } from '../../api/endpoints';
import type { GlobeLocation } from '../../api/types';

interface SetLocationModalProps {
  entityType: 'supplier' | 'warehouse';
  code: string;
  name: string;
  currentLocation?: GlobeLocation | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  isSavingEnabled: boolean;
  clickedCoords?: { lat: number; lon: number } | null;
  onEnableClickToPlace?: () => void;
  onDisableClickToPlace?: () => void;
  isClickToPlaceActive?: boolean;
}

// Top countries for quick selection
const COUNTRY_OPTIONS: { code: string; name: string; lat: number; lon: number }[] = [
  { code: 'IN', name: 'India', lat: 20.5937, lon: 78.9629 },
  { code: 'US', name: 'United States', lat: 37.0902, lon: -95.7129 },
  { code: 'TW', name: 'Taiwan', lat: 23.6978, lon: 120.9605 },
  { code: 'KR', name: 'South Korea', lat: 35.9078, lon: 127.7669 },
  { code: 'JP', name: 'Japan', lat: 36.2048, lon: 138.2529 },
  { code: 'DE', name: 'Germany', lat: 51.1657, lon: 10.4515 },
  { code: 'VN', name: 'Vietnam', lat: 14.0583, lon: 108.2772 },
  { code: 'SG', name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { code: 'CN', name: 'China', lat: 35.8617, lon: 104.1954 },
  { code: 'MX', name: 'Mexico', lat: 23.6345, lon: -102.5528 },
  { code: 'CA', name: 'Canada', lat: 56.1304, lon: -106.3468 },
  { code: 'GB', name: 'United Kingdom', lat: 55.3781, lon: -3.436 },
  { code: 'FR', name: 'France', lat: 46.2276, lon: 2.2137 },
  { code: 'NL', name: 'Netherlands', lat: 52.1326, lon: 5.2913 },
  { code: 'MY', name: 'Malaysia', lat: 4.2105, lon: 101.9758 },
  { code: 'TH', name: 'Thailand', lat: 15.87, lon: 100.9925 },
];

export interface HubOption {
  key: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
}

export const GLOBAL_HUBS: HubOption[] = [
  // India
  { key: 'pune', city: 'Pune', state: 'Maharashtra', country: 'India', countryCode: 'IN', lat: 18.5204, lon: 73.8567 },
  { key: 'delhi', city: 'Delhi / NCR', state: 'Delhi', country: 'India', countryCode: 'IN', lat: 28.6139, lon: 77.2090 },
  { key: 'chennai', city: 'Chennai', state: 'Tamil Nadu', country: 'India', countryCode: 'IN', lat: 13.0827, lon: 80.2707 },
  { key: 'mumbai', city: 'Mumbai', state: 'Maharashtra', country: 'India', countryCode: 'IN', lat: 19.0760, lon: 72.8777 },
  { key: 'bangalore', city: 'Bengaluru / Bangalore', state: 'Karnataka', country: 'India', countryCode: 'IN', lat: 12.9716, lon: 77.5946 },
  { key: 'hyderabad', city: 'Hyderabad', state: 'Telangana', country: 'India', countryCode: 'IN', lat: 17.3850, lon: 78.4867 },
  { key: 'kolkata', city: 'Kolkata', state: 'West Bengal', country: 'India', countryCode: 'IN', lat: 22.5726, lon: 88.3639 },
  { key: 'ahmedabad', city: 'Ahmedabad', state: 'Gujarat', country: 'India', countryCode: 'IN', lat: 23.0225, lon: 72.5714 },
  { key: 'noida', city: 'Noida', state: 'Uttar Pradesh', country: 'India', countryCode: 'IN', lat: 28.5355, lon: 77.3910 },
  { key: 'gurgaon', city: 'Gurugram / Gurgaon', state: 'Haryana', country: 'India', countryCode: 'IN', lat: 28.4595, lon: 77.0266 },
  // China
  { key: 'shenzhen', city: 'Shenzhen', state: 'Guangdong', country: 'China', countryCode: 'CN', lat: 22.5431, lon: 114.0579 },
  { key: 'dongguan', city: 'Dongguan', state: 'Guangdong', country: 'China', countryCode: 'CN', lat: 23.0207, lon: 113.7518 },
  { key: 'guangzhou', city: 'Guangzhou', state: 'Guangdong', country: 'China', countryCode: 'CN', lat: 23.1291, lon: 113.2644 },
  { key: 'suzhou', city: 'Suzhou', state: 'Jiangsu', country: 'China', countryCode: 'CN', lat: 31.2989, lon: 120.5853 },
  { key: 'chengdu', city: 'Chengdu', state: 'Sichuan', country: 'China', countryCode: 'CN', lat: 30.5728, lon: 104.0668 },
  { key: 'shanghai', city: 'Shanghai', state: 'Shanghai', country: 'China', countryCode: 'CN', lat: 31.2304, lon: 121.4737 },
  { key: 'beijing', city: 'Beijing', state: 'Beijing', country: 'China', countryCode: 'CN', lat: 39.9042, lon: 116.4074 },
  { key: 'wuhan', city: 'Wuhan', state: 'Hubei', country: 'China', countryCode: 'CN', lat: 30.5928, lon: 114.3055 },
  // Taiwan
  { key: 'taipei', city: 'Taipei', state: 'Taiwan', country: 'Taiwan', countryCode: 'TW', lat: 25.0330, lon: 121.5654 },
  { key: 'hsinchu', city: 'Hsinchu Science Park', state: 'Taiwan', country: 'Taiwan', countryCode: 'TW', lat: 24.8138, lon: 120.9675 },
  { key: 'taichung', city: 'Taichung', state: 'Taiwan', country: 'Taiwan', countryCode: 'TW', lat: 24.1477, lon: 120.6736 },
  // USA
  { key: 'austin', city: 'Austin', state: 'Texas', country: 'United States', countryCode: 'US', lat: 30.2672, lon: -97.7431 },
  { key: 'sanjose', city: 'San Jose / Silicon Valley', state: 'California', country: 'United States', countryCode: 'US', lat: 37.3382, lon: -121.8863 },
  { key: 'dallas', city: 'Dallas / Fort Worth', state: 'Texas', country: 'United States', countryCode: 'US', lat: 32.7767, lon: -96.7970 },
  { key: 'columbus', city: 'Columbus', state: 'Ohio', country: 'United States', countryCode: 'US', lat: 39.9612, lon: -82.9988 },
  { key: 'reno', city: 'Reno', state: 'Nevada', country: 'United States', countryCode: 'US', lat: 39.5296, lon: -119.8138 },
  { key: 'chicago', city: 'Chicago', state: 'Illinois', country: 'United States', countryCode: 'US', lat: 41.8781, lon: -87.6298 },
  { key: 'newyork', city: 'New York', state: 'New York', country: 'United States', countryCode: 'US', lat: 40.7128, lon: -74.0060 },
  // Germany
  { key: 'stuttgart', city: 'Stuttgart', state: 'Baden-Württemberg', country: 'Germany', countryCode: 'DE', lat: 48.7758, lon: 9.1829 },
  { key: 'munich', city: 'Munich', state: 'Bavaria', country: 'Germany', countryCode: 'DE', lat: 48.1351, lon: 11.5820 },
  { key: 'frankfurt', city: 'Frankfurt', state: 'Hesse', country: 'Germany', countryCode: 'DE', lat: 50.1109, lon: 8.6821 },
  { key: 'berlin', city: 'Berlin', state: 'Berlin', country: 'Germany', countryCode: 'DE', lat: 52.5200, lon: 13.4050 },
  { key: 'hamburg', city: 'Hamburg', state: 'Hamburg', country: 'Germany', countryCode: 'DE', lat: 53.5511, lon: 9.9937 },
  // Japan
  { key: 'tokyo', city: 'Tokyo', state: 'Kanto', country: 'Japan', countryCode: 'JP', lat: 35.6762, lon: 139.6503 },
  { key: 'osaka', city: 'Osaka', state: 'Kansai', country: 'Japan', countryCode: 'JP', lat: 34.6937, lon: 135.5023 },
  { key: 'kyoto', city: 'Kyoto', state: 'Kansai', country: 'Japan', countryCode: 'JP', lat: 35.0116, lon: 135.7681 },
  // South Korea
  { key: 'seoul', city: 'Seoul', state: 'Gyeonggi', country: 'South Korea', countryCode: 'KR', lat: 37.5665, lon: 126.9780 },
  { key: 'suwon', city: 'Suwon', state: 'Gyeonggi', country: 'South Korea', countryCode: 'KR', lat: 37.2636, lon: 127.0286 },
  { key: 'busan', city: 'Busan', state: 'Gyeongsang', country: 'South Korea', countryCode: 'KR', lat: 35.1796, lon: 129.0756 },
  // Vietnam
  { key: 'hanoi', city: 'Hanoi', state: 'Red River Delta', country: 'Vietnam', countryCode: 'VN', lat: 21.0285, lon: 105.8542 },
  { key: 'hochiminh', city: 'Ho Chi Minh City', state: 'Southeast', country: 'Vietnam', countryCode: 'VN', lat: 10.8231, lon: 106.6297 },
  { key: 'bacninh', city: 'Bac Ninh', state: 'Red River Delta', country: 'Vietnam', countryCode: 'VN', lat: 21.1861, lon: 106.0763 },
  // Singapore & Malaysia
  { key: 'singapore', city: 'Singapore', state: 'Singapore', country: 'Singapore', countryCode: 'SG', lat: 1.3521, lon: 103.8198 },
  { key: 'penang', city: 'Penang', state: 'Penang', country: 'Malaysia', countryCode: 'MY', lat: 5.4141, lon: 100.3288 },
  { key: 'kualalumpur', city: 'Kuala Lumpur', state: 'Kuala Lumpur', country: 'Malaysia', countryCode: 'MY', lat: 3.1390, lon: 101.6869 },
];

export const SetLocationModal: React.FC<SetLocationModalProps> = ({
  entityType,
  code,
  name,
  currentLocation,
  isOpen,
  onClose,
  onSaved,
  isSavingEnabled,
  clickedCoords,
  onEnableClickToPlace,
  onDisableClickToPlace,
  isClickToPlaceActive,
}) => {
  const [method, setMethod] = useState<'country' | 'coords' | 'click'>('country');
  const [selectedCountry, setSelectedCountry] = useState<string>('IN');
  const [selectedHub, setSelectedHub] = useState<string>('');
  const [latInput, setLatInput] = useState<string>(
    currentLocation?.lat != null ? String(currentLocation.lat) : ''
  );
  const [lonInput, setLonInput] = useState<string>(
    currentLocation?.lon != null ? String(currentLocation.lon) : ''
  );
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-detect hub from name or code
  const detectedHub = React.useMemo(() => {
    const combined = `${name || ''} ${code || ''}`.toLowerCase();
    const cleanTokens = combined.split(/[-_\s/.]+/);
    return GLOBAL_HUBS.find(
      (h) =>
        combined.includes(h.key) ||
        combined.includes(h.city.toLowerCase()) ||
        cleanTokens.includes(h.key) ||
        (h.key === 'pune' && cleanTokens.includes('pun')) ||
        (h.key === 'delhi' && cleanTokens.includes('del')) ||
        (h.key === 'chennai' && (cleanTokens.includes('che') || cleanTokens.includes('maa')))
    );
  }, [name, code]);

  // Available hubs for the selected country
  const availableHubs = React.useMemo(() => {
    return GLOBAL_HUBS.filter((h) => h.countryCode === selectedCountry);
  }, [selectedCountry]);

  if (!isOpen) return null;

  // React to coordinates from click-on-globe mode
  const effectiveLat = method === 'click' && clickedCoords ? clickedCoords.lat : null;
  const effectiveLon = method === 'click' && clickedCoords ? clickedCoords.lon : null;

  const applyDetectedHub = async (hub: HubOption) => {
    if (!isSavingEnabled) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await overrideLocation({
        entity_type: entityType,
        code,
        lat: hub.lat,
        lon: hub.lon,
        note: `${hub.city}, ${hub.state} (${hub.countryCode})`,
      });
      if (onDisableClickToPlace) onDisableClickToPlace();
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save location override';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSavingEnabled) return;
    setErrorMsg(null);

    let finalLat: number | null = null;
    let finalLon: number | null = null;
    let finalNote = note.trim();

    if (method === 'country') {
      if (selectedHub) {
        const hub = GLOBAL_HUBS.find((h) => h.key === selectedHub);
        if (hub) {
          finalLat = hub.lat;
          finalLon = hub.lon;
          finalNote = finalNote || `${hub.city}, ${hub.state} (${hub.countryCode})`;
        }
      }
      if (finalLat === null) {
        const match = COUNTRY_OPTIONS.find((c) => c.code === selectedCountry);
        if (!match) {
          setErrorMsg('Please select a valid country.');
          return;
        }
        finalLat = match.lat;
        finalLon = match.lon;
        finalNote = finalNote || `Manually set (${selectedCountry} Centroid)`;
      }
    } else if (method === 'coords') {
      const parsedLat = parseFloat(latInput.trim());
      const parsedLon = parseFloat(lonInput.trim());

      if (isNaN(parsedLat) || !isFinite(parsedLat)) {
        setErrorMsg('Latitude must be a valid finite number.');
        return;
      }
      if (parsedLat < -90 || parsedLat > 90) {
        setErrorMsg('Latitude must be between -90 and 90 degrees.');
        return;
      }
      if (isNaN(parsedLon) || !isFinite(parsedLon)) {
        setErrorMsg('Longitude must be a valid finite number.');
        return;
      }
      if (parsedLon < -180 || parsedLon > 180) {
        setErrorMsg('Longitude must be between -180 and 180 degrees.');
        return;
      }
      if (Math.abs(parsedLat) < 1e-6 && Math.abs(parsedLon) < 1e-6) {
        setErrorMsg('Coordinates (0, 0) represent Null Island and are rejected.');
        return;
      }

      finalLat = parsedLat;
      finalLon = parsedLon;
    } else if (method === 'click') {
      if (effectiveLat == null || effectiveLon == null) {
        setErrorMsg('Please click a location on the globe first.');
        return;
      }
      finalLat = effectiveLat;
      finalLon = effectiveLon;
    }

    setSubmitting(true);
    try {
      await overrideLocation({
        entity_type: entityType,
        code,
        lat: finalLat,
        lon: finalLon,
        note: finalNote || `Manually set (${method})`,
      });
      if (onDisableClickToPlace) onDisableClickToPlace();
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save location override';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (!isSavingEnabled) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await overrideLocation({
        entity_type: entityType,
        code,
        clear: true,
      });
      if (onDisableClickToPlace) onDisableClickToPlace();
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to clear location';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-location-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
    >
      <div className="bg-[#0e172e] border border-cyan-500/30 rounded-xl max-w-md w-full p-5 text-slate-100 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-700/60 pb-3">
          <div>
            <h3 id="set-location-title" className="font-bold text-base text-cyan-300">
              Set Location for {code}
            </h3>
            <p className="text-xs text-text-muted truncate max-w-xs">{name}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onDisableClickToPlace) onDisableClickToPlace();
              onClose();
            }}
            className="text-text-muted hover:text-white text-lg p-1"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

        {/* Smart Auto-Detection Recommendation */}
        {detectedHub && (
          <div
            data-testid="smart-detected-hub-banner"
            className="p-3 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-200 text-xs flex items-center justify-between gap-3 shadow-md"
          >
            <div>
              <span className="font-bold text-cyan-300 block">
                ✨ Auto-Detected Location
              </span>
              <span className="text-[11px] text-slate-300">
                {detectedHub.city}, {detectedHub.state} ({detectedHub.country}) &bull;{' '}
                <span className="font-mono text-cyan-400">
                  {detectedHub.lat.toFixed(4)}°, {detectedHub.lon.toFixed(4)}°
                </span>
              </span>
            </div>
            <button
              type="button"
              disabled={!isSavingEnabled || submitting}
              onClick={() => applyDetectedHub(detectedHub)}
              className="px-2.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs whitespace-nowrap shadow-sm transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              Apply Exact Location
            </button>
          </div>
        )}

        {/* Disabled warning if ENABLE_WEB_IMPORT is false */}
        {!isSavingEnabled && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-amber-950/70 border border-amber-600/50 text-amber-200 text-xs leading-relaxed"
          >
            Saving locations is disabled. Set ENABLE_WEB_IMPORT=true in backend\.env and restart the backend.
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div role="alert" className="p-2.5 rounded bg-rose-950/80 border border-rose-700 text-rose-200 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* Method Selector */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 block">Placement Method:</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMethod('country');
                  if (onDisableClickToPlace) onDisableClickToPlace();
                }}
                className={`py-1.5 px-2 rounded font-medium border text-center transition-colors ${
                  method === 'country'
                    ? 'bg-cyan-950 text-cyan-200 border-cyan-500'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                (a) Hub / Country
              </button>
              <button
                type="button"
                onClick={() => {
                  setMethod('coords');
                  if (onDisableClickToPlace) onDisableClickToPlace();
                }}
                className={`py-1.5 px-2 rounded font-medium border text-center transition-colors ${
                  method === 'coords'
                    ? 'bg-cyan-950 text-cyan-200 border-cyan-500'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                (b) Lat / Lon
              </button>
              <button
                type="button"
                onClick={() => {
                  setMethod('click');
                  if (onEnableClickToPlace) onEnableClickToPlace();
                }}
                className={`py-1.5 px-2 rounded font-medium border text-center transition-colors ${
                  method === 'click'
                    ? 'bg-cyan-950 text-cyan-200 border-cyan-500'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                (c) Click Globe
              </button>
            </div>
          </div>

          {/* Option A: Country & Hub selection */}
          {method === 'country' && (
            <div className="space-y-2.5 p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
              <div>
                <label htmlFor="country-select" className="text-slate-300 font-semibold block mb-1">
                  Select Country:
                </label>
                <select
                  id="country-select"
                  value={selectedCountry}
                  onChange={(e) => {
                    setSelectedCountry(e.target.value);
                    setSelectedHub('');
                  }}
                  disabled={!isSavingEnabled || submitting}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-500"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              {availableHubs.length > 0 && (
                <div className="pt-1 space-y-1">
                  <label htmlFor="hub-select" className="text-slate-300 font-semibold block">
                    City / State Manufacturing Hub:
                  </label>
                  <select
                    id="hub-select"
                    value={selectedHub}
                    onChange={(e) => setSelectedHub(e.target.value)}
                    disabled={!isSavingEnabled || submitting}
                    className="w-full bg-slate-900 border border-cyan-700/70 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-400 font-medium"
                  >
                    <option value="">-- Country Centroid (Coarse Center) --</option>
                    {availableHubs.map((h) => (
                      <option key={h.key} value={h.key}>
                        {h.city}, {h.state} ({h.lat.toFixed(2)}°, {h.lon.toFixed(2)}°)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-[11px] text-text-muted">
                {selectedHub
                  ? 'Entity will be mapped directly to this city/state coordinates.'
                  : 'Entity will be mapped to the approximate geographic center of the country.'}
              </p>
            </div>
          )}

          {/* Option B: Direct coordinate entry */}
          {method === 'coords' && (
            <div className="space-y-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="lat-input" className="text-slate-300 font-semibold block mb-1">
                    Latitude (-90..90):
                  </label>
                  <input
                    id="lat-input"
                    type="number"
                    step="any"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    disabled={!isSavingEnabled || submitting}
                    placeholder="e.g. 30.2672"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="lon-input" className="text-slate-300 font-semibold block mb-1">
                    Longitude (-180..180):
                  </label>
                  <input
                    id="lon-input"
                    type="number"
                    step="any"
                    value={lonInput}
                    onChange={(e) => setLonInput(e.target.value)}
                    disabled={!isSavingEnabled || submitting}
                    placeholder="e.g. -97.7431"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>
              <p className="text-[11px] text-text-muted">
                Coordinates (0, 0) represent Null Island and are rejected.
              </p>
            </div>
          )}

          {/* Option C: Click on globe */}
          {method === 'click' && (
            <div className="space-y-2 p-3 bg-slate-800/50 rounded-lg border border-cyan-500/40">
              <p className="text-cyan-200 font-medium">
                {isClickToPlaceActive
                  ? 'Click anywhere on the 3D globe to pick coordinates.'
                  : 'Click-to-place mode ready.'}
              </p>
              {effectiveLat != null && effectiveLon != null ? (
                <div className="p-2 bg-slate-900 rounded border border-cyan-600/50 font-mono text-xs text-cyan-300">
                  Selected: Lat {effectiveLat.toFixed(4)}, Lon {effectiveLon.toFixed(4)}
                </div>
              ) : (
                <div className="text-[11px] text-text-muted italic">
                  No globe point clicked yet. Click on the surface behind this modal or move the dialog.
                </div>
              )}
            </div>
          )}

          {/* Note input */}
          <div>
            <label htmlFor="note-input" className="text-slate-300 font-semibold block mb-1">
              Note (optional, max 200 chars):
            </label>
            <input
              id="note-input"
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!isSavingEnabled || submitting}
              placeholder="e.g. Main fabrication plant in Hsinchu"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-700/60">
            {currentLocation && currentLocation.precision === 'manual' ? (
              <button
                type="button"
                onClick={handleClear}
                disabled={!isSavingEnabled || submitting}
                className="px-3 py-1.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 disabled:opacity-50"
              >
                Clear Override
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (onDisableClickToPlace) onDisableClickToPlace();
                  onClose();
                }}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isSavingEnabled || submitting}
                className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-50 shadow-md transition-colors"
              >
                {submitting ? 'Saving...' : 'Save Location'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
