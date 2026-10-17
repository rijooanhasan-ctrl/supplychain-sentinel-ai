import { useCallback, type ReactNode } from 'react';
import { getMeta } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { MetaContext } from './metaContextDef';

export function MetaProvider({ children }: { children: ReactNode }) {
  const fetcher = useCallback((signal: AbortSignal) => getMeta(signal), []);
  const { data: meta, loading, error, reload } = useApi(fetcher, [fetcher]);

  const isDemo =
    meta?.data_source === 'demo' ||
    Boolean(meta?.label && meta.label.toLowerCase().includes('demo'));

  const asOf = meta?.as_of || '2026-10-17';

  return (
    <MetaContext.Provider
      value={{
        meta,
        loading,
        error,
        reload,
        isDemo,
        asOf,
      }}
    >
      {children}
    </MetaContext.Provider>
  );
}
