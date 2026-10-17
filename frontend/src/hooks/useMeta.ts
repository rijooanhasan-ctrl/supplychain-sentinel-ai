import { useContext } from 'react';
import { MetaContext, type MetaContextValue } from '../context/metaContextDef';

export function useMeta(): MetaContextValue {
  const context = useContext(MetaContext);
  if (!context) {
    throw new Error('useMeta must be used within a MetaProvider');
  }
  return context;
}
