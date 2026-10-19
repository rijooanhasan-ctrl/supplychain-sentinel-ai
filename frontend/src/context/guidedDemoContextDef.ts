import { createContext } from 'react';
import type { ExecutiveSummaryResponse, TopRiskItem, PriorityDecision } from '../api/types';

export interface GuidedDemoContextType {
  isOpen: boolean;
  step: number;
  totalSteps: number;
  startDemo: () => void;
  exitDemo: () => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  summary: ExecutiveSummaryResponse | null;
  loading: boolean;
  hasRisks: boolean;
  topRisk: TopRiskItem | null;
  priorityDecision: PriorityDecision | null;
}

export const GuidedDemoContext = createContext<GuidedDemoContextType | undefined>(undefined);
