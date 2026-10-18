"""app/api/routes/executive_summary.py

FastAPI route for Executive Summary (/api/executive-summary).
Provides a high-level briefing of top risks, priority recovery decisions,
cost comparison (acting vs doing nothing), data quality lineage, and transparent why explanations.
Strictly read-only GET endpoint. No orders or changes are created.
"""

from __future__ import annotations

from typing import Any, Dict
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.domain.executive_summary import ExecutiveSummary
from app.schemas.executive_summary import ExecutiveSummaryResponse
from app.services.executive_summary import get_executive_summary_data

router = APIRouter(prefix="/executive-summary", tags=["executive-summary"])


def _serialize_summary(summary: ExecutiveSummary) -> Dict[str, Any]:
    """Serialize ExecutiveSummary domain model into JSON-compatible response dict."""
    top_risks = [
        {
            "component_id": r.component_id,
            "component_sku": r.component_sku,
            "component_name": r.component_name,
            "severity": r.severity,
            "shortage_date": r.shortage_date,
            "days_until_impact": r.days_until_impact,
            "units_short_before_next_inbound": r.units_short_before_next_inbound,
            "first_shortage_window_days": r.first_shortage_window_days,
            "reason": r.reason,
            "related_alert_id": r.related_alert_id,
            "has_later_shortage": r.has_later_shortage,
            "exposed_orders_count": r.exposed_orders_count,
            "exposed_selling_value": str(r.exposed_selling_value) if r.exposed_selling_value is not None else None,
            "why": [{"label": w.label, "text": w.text} for w in r.why],
        }
        for r in summary.top_risks
    ]

    priority_decision = None
    if summary.priority_decision is not None:
        pd = summary.priority_decision
        runner_up = None
        if pd.runner_up is not None:
            runner_up = {
                "id": pd.runner_up.id,
                "kind": pd.runner_up.kind,
                "description": pd.runner_up.description,
                "incremental_cost": str(pd.runner_up.incremental_cost) if pd.runner_up.incremental_cost is not None else None,
                "cost_known": pd.runner_up.cost_known,
            }

        priority_decision = {
            "component_id": pd.component_id,
            "component_sku": pd.component_sku,
            "component_name": pd.component_name,
            "recommended_option_id": pd.recommended_option_id,
            "recommended_option_kind": pd.recommended_option_kind,
            "recommended_option_description": pd.recommended_option_description,
            "quantity": pd.quantity,
            "arrival_date": pd.arrival_date,
            "incremental_cost": str(pd.incremental_cost) if pd.incremental_cost is not None else None,
            "cost_known": pd.cost_known,
            "residual_unmet_before_next_inbound": pd.residual_unmet_before_next_inbound,
            "later_shortage_note": pd.later_shortage_note,
            "runner_up": runner_up,
            "scope_note": pd.scope_note,
            "why": [{"label": w.label, "text": w.text} for w in pd.why],
        }

    cost_comparison = None
    if summary.cost_comparison is not None:
        cc = summary.cost_comparison
        cost_comparison = {
            "act": {
                "cost": str(cc.act.cost) if cc.act.cost is not None else None,
                "cost_known": cc.act.cost_known,
                "residual_units_short": cc.act.residual_units_short,
                "affected_orders_count": cc.act.affected_orders_count,
                "selling_value": str(cc.act.selling_value) if cc.act.selling_value is not None else None,
            },
            "do_nothing": {
                "units_short": cc.do_nothing.units_short,
                "affected_orders_count": cc.do_nothing.affected_orders_count,
                "selling_value": str(cc.do_nothing.selling_value) if cc.do_nothing.selling_value is not None else None,
            },
            "difference_sentence": cc.difference_sentence,
            "exposure_disclaimer": cc.exposure_disclaimer,
        }

    exposure_totals = [
        {
            "component_id": exp.component_id,
            "component_sku": exp.component_sku,
            "component_name": exp.component_name,
            "orders_count": exp.orders_count,
            "selling_value": str(exp.selling_value) if exp.selling_value is not None else None,
        }
        for exp in summary.exposure_totals
    ]

    dq = summary.data_quality
    data_quality = {
        "dataset_label": dq.dataset_label,
        "dataset_source": dq.dataset_source,
        "is_live": dq.is_live,
        "components_evaluated": dq.components_evaluated,
        "components_unknown_risk": dq.components_unknown_risk,
        "supplier_confidence_counts": dq.supplier_confidence_counts,
        "top_risk_supplier_confidence": [
            {
                "supplier_id": sc.supplier_id,
                "supplier_code": sc.supplier_code,
                "supplier_name": sc.supplier_name,
                "confidence": sc.confidence,
                "n_deliveries": sc.n_deliveries,
            }
            for sc in dq.top_risk_supplier_confidence
        ],
        "priority_component_demand_history_days": dq.priority_component_demand_history_days,
        "flags": dq.flags,
        "data_quality_note": dq.data_quality_note,
    }

    why_dict = {
        k: [{"label": w.label, "text": w.text} for w in items]
        for k, items in summary.why.items()
    }

    return {
        "seeded": True,
        "as_of": summary.as_of,
        "label": summary.label,
        "headline": summary.headline,
        "top_risks": top_risks,
        "priority_decision": priority_decision,
        "cost_comparison": cost_comparison,
        "exposure_totals": exposure_totals,
        "exposure_note": summary.exposure_note,
        "data_quality": data_quality,
        "assumptions": summary.assumptions,
        "why": why_dict,
        "note": summary.note,
    }


@router.get("", response_model=Dict[str, Any])
def get_executive_summary(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    """Get the Executive Summary.

    Returns seeded=False envelope if database is not seeded.
    """
    summary = get_executive_summary_data(db, settings)
    if summary is None:
        return {
            "seeded": False,
            "as_of": None,
            "label": None,
            "headline": "Dataset is unseeded. No summary available.",
            "top_risks": [],
            "priority_decision": None,
            "cost_comparison": None,
            "exposure_totals": [],
            "exposure_note": "No exposure data available.",
            "data_quality": None,
            "assumptions": [],
            "why": {},
            "note": "Decision support only. No orders are created.",
        }

    return _serialize_summary(summary)
