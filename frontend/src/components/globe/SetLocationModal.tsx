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
  { code: 'IN', name: 'India', lat: 20.5937, lon: 78.9629 },
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
  const [selectedCountry, setSelectedCountry] = useState<string>('US');
  const [latInput, setLatInput] = useState<string>(
    currentLocation?.lat != null ? String(currentLocation.lat) : ''
  );
  const [lonInput, setLonInput] = useState<string>(
    currentLocation?.lon != null ? String(currentLocation.lon) : ''
  );
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // React to coordinates from click-on-globe mode
  const effectiveLat = method === 'click' && clickedCoords ? clickedCoords.lat : null;
  const effectiveLon = method === 'click' && clickedCoords ? clickedCoords.lon : null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSavingEnabled) return;
    setErrorMsg(null);

    let finalLat: number | null = null;
    let finalLon: number | null = null;

    if (method === 'country') {
      const match = COUNTRY_OPTIONS.find((c) => c.code === selectedCountry);
      if (!match) {
        setErrorMsg('Please select a valid country.');
        return;
      }
      finalLat = match.lat;
      finalLon = match.lon;
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
        note: note.trim() || `Manually set (${method})`,
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
            <p className="text-xs text-slate-400 truncate max-w-xs">{name}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (onDisableClickToPlace) onDisableClickToPlace();
              onClose();
            }}
            className="text-slate-400 hover:text-white text-lg p-1"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>

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
                (a) Country
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

          {/* Option A: Country selection */}
          {method === 'country' && (
            <div className="space-y-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
              <label htmlFor="country-select" className="text-slate-300 font-semibold block">
                Select Country (Centroid approximate):
              </label>
              <select
                id="country-select"
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                disabled={!isSavingEnabled || submitting}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 focus:outline-hidden focus:border-cyan-500"
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400">
                Entity will be mapped to the approximate geographic center of the country.
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
              <p className="text-[11px] text-slate-400">
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
                <div className="text-[11px] text-slate-400 italic">
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
