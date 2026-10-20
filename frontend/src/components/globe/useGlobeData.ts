import { useCallback, useEffect, useState } from 'react';
import { getGlobe } from '../../api/endpoints';
import type { GlobeResponse } from '../../api/types';

// Module-level cache keyed by dataset identifier
let moduleCachedGlobe: GlobeResponse | null = null;
let moduleCacheKey: string | null = null;
let moduleInFlight: Promise<GlobeResponse> | null = null;

// Subscribers for cache updates across multiple components/hooks
const listeners = new Set<(data: GlobeResponse | null) => void>();

function notifyListeners(data: GlobeResponse | null) {
  listeners.forEach((listener) => {
    try {
      listener(data);
    } catch {
      // ignore listener errors
    }
  });
}

export function clearGlobeCache(): void {
  moduleCachedGlobe = null;
  moduleCacheKey = null;
  moduleInFlight = null;
  notifyListeners(null);
}

export function getCachedGlobeData(): GlobeResponse | null {
  return moduleCachedGlobe;
}

export interface UseGlobeDataReturn {
  data: GlobeResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<GlobeResponse | null>;
}

/**
 * Shared data hook for /api/globe.
 * Fetches once and shares response across Overview (compact mode) and Global Map (full mode).
 * Automatically refetches if active dataset changes (keyed by label | generated_at | active_dataset).
 */
export function useGlobeData(activeDatasetKey?: string): UseGlobeDataReturn {
  const [data, setData] = useState<GlobeResponse | null>(() => moduleCachedGlobe);
  const [loading, setLoading] = useState<boolean>(() => !moduleCachedGlobe);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to module cache updates
  useEffect(() => {
    const handleUpdate = (updated: GlobeResponse | null) => {
      setData(updated);
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  const loadData = useCallback(
    async (force = false, signal?: AbortSignal): Promise<GlobeResponse | null> => {
      // Check cache key validity
      if (
        !force &&
        moduleCachedGlobe &&
        (!activeDatasetKey || moduleCacheKey === activeDatasetKey)
      ) {
        setData(moduleCachedGlobe);
        setLoading(false);
        return moduleCachedGlobe;
      }

      setLoading(true);
      setError(null);

      try {
        if (!moduleInFlight || force) {
          moduleInFlight = getGlobe(signal);
        }

        const res = await moduleInFlight;
        const newKey = res.dataset
          ? `${res.dataset.active_dataset}|${res.dataset.generated_at}|${res.dataset.label}`
          : 'default';

        moduleCachedGlobe = res;
        moduleCacheKey = newKey;
        moduleInFlight = null;

        setData(res);
        setLoading(false);
        notifyListeners(res);
        return res;
      } catch (err: any) {
        moduleInFlight = null;
        if (err?.name === 'AbortError') {
          return null;
        }
        const errMsg = err instanceof Error ? err.message : 'Failed to load globe data';
        setError(errMsg);
        setLoading(false);
        return null;
      }
    },
    [activeDatasetKey]
  );

  useEffect(() => {
    const abortCtrl = new AbortController();

    // If cache key mismatched with activeDatasetKey, force refetch
    if (activeDatasetKey && moduleCacheKey && moduleCacheKey !== activeDatasetKey) {
      loadData(true, abortCtrl.signal);
    } else if (!moduleCachedGlobe) {
      loadData(false, abortCtrl.signal);
    }

    return () => {
      abortCtrl.abort();
    };
  }, [activeDatasetKey, loadData]);

  const reload = useCallback(() => {
    return loadData(true);
  }, [loadData]);

  return { data, loading, error, reload };
}
