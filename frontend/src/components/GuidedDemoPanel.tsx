import { useGuidedDemo } from '../hooks/useGuidedDemo';

export function GuidedDemoPanel() {
  const {
    isOpen,
    step,
    totalSteps,
    exitDemo,
    nextStep,
    prevStep,
    goToStep,
    summary,
    loading,
    hasRisks,
    topRisk,
    priorityDecision,
  } = useGuidedDemo();

  if (!isOpen) return null;

  // Build step details dynamically from API summary
  const getStepContent = () => {
    if (loading) {
      return {
        title: 'Loading Live Summary...',
        body: 'Fetching supply chain risk indicators from backend...',
      };
    }

    if (!hasRisks) {
      if (step === 5) {
        return {
          title: 'Step 5 of 5: What-If Disruption Simulator',
          body: 'Test hypothetical supply chain disruptions and observe simulated mitigation strategies.',
        };
      }
      return {
        title: `Step ${step} of ${totalSteps}: Guided Tour`,
        body: 'No components currently at risk. All inventory positions are currently stable.',
      };
    }

    // When risks exist:
    const sku = topRisk?.component_sku || 'component';
    const name = topRisk?.component_name || '';
    const shortageDate = topRisk?.shortage_date || 'near term';
    const unitsShort = topRisk?.units_short_before_next_inbound ?? 0;
    const headline = summary?.headline || 'Operational supply chain review';

    switch (step) {
      case 1:
        return {
          title: 'Step 1 of 5: Executive Summary & Top Risk',
          body: `${headline}. Highest immediate risk is ${sku} (${name}) with projected shortage on ${shortageDate} (${unitsShort} units short before next replenishment).`,
        };
      case 2:
        return {
          title: 'Step 2 of 5: Active Shortage Alerts',
          body: `Reviewing why the active shortage alert exists: ${topRisk?.reason || `Projected demand outpaces on-hand stock for ${sku}.`}`,
        };
      case 3:
        return {
          title: 'Step 3 of 5: Supplier Delay & Upstream Risk',
          body: `Inspecting upstream delivery reliability for ${sku}. Evaluating how promised vs actual lead times and supplier variance trigger downstream shortages.`,
        };
      case 4:
        return {
          title: 'Step 4 of 5: Prescriptive Recommendations',
          body: priorityDecision
            ? `Recommended mitigation for ${priorityDecision.component_sku}: ${priorityDecision.recommended_option_description}. Scope: ${priorityDecision.scope_note}`
            : `Evaluating prescriptive mitigation options for ${sku} and first-window resolution scope.`,
        };
      case 5:
        return {
          title: 'Step 5 of 5: What-If Disruption Simulator',
          body: `Simulating disruptions for ${sku}. Compare baseline vs disrupted vs recovered positions to evaluate costs of action vs inaction.`,
        };
      default:
        return {
          title: `Step ${step} of ${totalSteps}`,
          body: headline,
        };
    }
  };

  const content = getStepContent();

  return (
    <div
      role="dialog"
      aria-label="Guided Demo"
      aria-modal="false"
      className="fixed bottom-5 right-5 z-50 w-96 max-w-[calc(100vw-2.5rem)] bg-white border-2 border-blue-500 rounded-xl shadow-2xl p-5 text-slate-900 transition-all"
      data-testid="guided-demo-panel"
    >
      {/* Header with Step Counter and Exit */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" aria-hidden="true" />
          <span className="font-bold text-xs uppercase tracking-wider text-blue-900">
            Guided Demo Mode
          </span>
          <span
            className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-semibold border border-blue-200"
            data-testid="guided-demo-step-counter"
          >
            {step}/{totalSteps}
          </span>
        </div>
        <button
          type="button"
          onClick={exitDemo}
          aria-label="Exit guided demo"
          className="text-xs text-slate-500 hover:text-slate-800 font-medium px-1.5 py-0.5 rounded hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          data-testid="guided-demo-exit"
        >
          Exit demo
        </button>
      </div>

      {/* Step Title & Instruction Content */}
      <div className="space-y-2 mb-4">
        <h3 className="font-bold text-sm text-slate-900" data-testid="guided-demo-title">
          {content.title}
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed" data-testid="guided-demo-instruction">
          {content.body}
        </p>
      </div>

      {/* No-Risk Shortcut if applicable */}
      {!hasRisks && step !== 5 && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => goToStep(5)}
            className="w-full text-xs py-1.5 px-3 bg-amber-50 text-amber-900 border border-amber-300 rounded font-medium hover:bg-amber-100 cursor-pointer"
            data-testid="guided-demo-no-risk-simulator-btn"
          >
            Jump to What-If Simulator &rarr;
          </button>
        </div>
      )}

      {/* Navigation Controls */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-2">
        <button
          type="button"
          onClick={prevStep}
          disabled={step <= 1}
          className="px-3 py-1.5 rounded text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          data-testid="guided-demo-back"
        >
          &larr; Back
        </button>

        <span className="text-[11px] text-slate-600 font-mono">
          Press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px]">Esc</kbd> to exit
        </span>

        <button
          type="button"
          onClick={nextStep}
          className="px-3.5 py-1.5 rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          data-testid="guided-demo-next"
        >
          {step === totalSteps ? 'Finish' : 'Next \u2192'}
        </button>
      </div>
    </div>
  );
}
