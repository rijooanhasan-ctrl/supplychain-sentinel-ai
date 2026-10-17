import { createContext } from 'react';
import type { DatasetMetaResponse } from '../api/types';

export interface MetaContextValue {
  meta: DatasetMetaResponse | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  isDemo: boolean;
  asOf: string;
}

export const MetaContext = createContext<MetaContextValue | undefined>(undefined);
