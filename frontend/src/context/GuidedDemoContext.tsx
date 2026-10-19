import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExecutiveSummary } from '../api/endpoints';
import type { ExecutiveSummaryResponse } from '../api/types';
import { GuidedDemoContext } from './guidedDemoContextDef';

export function GuidedDemoProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [summary, setSummary] = useState<ExecutiveSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const totalSteps = 5;

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getExecutiveSummary();
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const topRisk = summary?.top_risks?.[0] || null;
  const hasRisks = (summary?.top_risks?.length || 0) > 0;
  const priorityDecision = summary?.priority_decision || null;

  const getRouteForStep = useCallback((stepNumber: number) => {
    switch (stepNumber) {
      case 1:
        return '/executive-summary';
      case 2:
        return '/alerts';
      case 3:
        return '/alerts';
      case 4:
        return '/recommendations';
      case 5:
        return topRisk?.component_id ? `/simulator?component_id=${topRisk.component_id}` : '/simulator';
      default:
        return '/executive-summary';
    }
  }, [topRisk]);

  const startDemo = useCallback(() => {
    setIsOpen(true);
    setStep(1);
    loadSummary();
    navigate('/executive-summary');
  }, [navigate, loadSummary]);

  const exitDemo = useCallback(() => {
    setIsOpen(false);
  }, []);

  const goToStep = useCallback((targetStep: number) => {
    if (targetStep < 1 || targetStep > totalSteps) return;
    setStep(targetStep);
    const route = getRouteForStep(targetStep);
    navigate(route);
  }, [getRouteForStep, navigate, totalSteps]);

  const nextStep = useCallback(() => {
    if (step >= totalSteps) {
      exitDemo();
    } else {
      const next = step + 1;
      setStep(next);
      navigate(getRouteForStep(next));
    }
  }, [step, totalSteps, exitDemo, getRouteForStep, navigate]);

  const prevStep = useCallback(() => {
    if (step > 1) {
      const prev = step - 1;
      setStep(prev);
      navigate(getRouteForStep(prev));
    }
  }, [step, getRouteForStep, navigate]);

  // Keyboard navigation: Escape key exits demo
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitDemo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, exitDemo]);

  return (
    <GuidedDemoContext.Provider
      value={{
        isOpen,
        step,
        totalSteps,
        startDemo,
        exitDemo,
        nextStep,
        prevStep,
        goToStep,
        summary,
        loading,
        hasRisks,
        topRisk,
        priorityDecision,
      }}
    >
      {children}
    </GuidedDemoContext.Provider>
  );
}
