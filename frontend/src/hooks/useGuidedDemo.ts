import { useContext } from 'react';
import { GuidedDemoContext, type GuidedDemoContextType } from '../context/guidedDemoContextDef';

const defaultGuidedDemoContext: GuidedDemoContextType = {
  isOpen: false,
  step: 1,
  totalSteps: 5,
  startDemo: () => {},
  exitDemo: () => {},
  nextStep: () => {},
  prevStep: () => {},
  goToStep: () => {},
  summary: null,
  loading: false,
  hasRisks: false,
  topRisk: null,
  priorityDecision: null,
};

export function useGuidedDemo(): GuidedDemoContextType {
  const context = useContext(GuidedDemoContext);
  return context || defaultGuidedDemoContext;
}
