import type { ReactNode } from 'react';
import type { AlertSeverity, ComponentCriticality, PurchaseOrderStatus, RiskLevel } from '../api/types';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
  testId?: string;
}

export function Badge({
  children,
  variant = 'default',
  className = '',
  testId,
}: BadgeProps) {
  const variantStyles: Record<string, string> = {
    default: 'bg-slate-100 text-slate-800 border-slate-300',
    info: 'bg-blue-50 text-blue-800 border-blue-300',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    warning: 'bg-amber-50 text-amber-900 border-amber-300',
    danger: 'bg-red-50 text-red-900 border-red-300',
    neutral: 'bg-zinc-100 text-zinc-800 border-zinc-300',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${variantStyles[variant]} ${className}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const config: Record<
    PurchaseOrderStatus,
    { label: string; variant: 'info' | 'warning' | 'success' | 'neutral' | 'default' }
  > = {
    open: { label: 'Open', variant: 'info' },
    in_transit: { label: 'In Transit', variant: 'warning' },
    partially_received: { label: 'Partially Received', variant: 'warning' },
    received: { label: 'Received', variant: 'success' },
    cancelled: { label: 'Cancelled', variant: 'neutral' },
  };

  const current = config[status] || { label: status, variant: 'default' };

  return <Badge variant={current.variant}>{current.label}</Badge>;
}

export function CriticalityBadge({ criticality }: { criticality: ComponentCriticality }) {
  const config: Record<
    ComponentCriticality,
    { label: string; variant: 'danger' | 'warning' | 'neutral' }
  > = {
    critical: { label: 'Critical', variant: 'danger' },
    high: { label: 'High', variant: 'warning' },
    normal: { label: 'Normal', variant: 'neutral' },
  };

  const current = config[criticality] || { label: criticality, variant: 'neutral' };

  return <Badge variant={current.variant}>{current.label}</Badge>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const config: Record<
    RiskLevel,
    { label: string; variant: 'danger' | 'warning' | 'info' | 'success' | 'neutral' | 'default' }
  > = {
    critical: { label: 'Critical', variant: 'danger' },
    high: { label: 'High', variant: 'warning' },
    medium: { label: 'Medium', variant: 'info' },
    low: { label: 'Low', variant: 'success' },
    unknown: { label: 'Unknown', variant: 'neutral' },
    none: { label: 'Not applicable', variant: 'default' },
  };

  const current = config[level] || { label: level, variant: 'default' };

  return (
    <Badge variant={current.variant} testId={`risk-badge-${level}`}>
      {current.label}
    </Badge>
  );
}

export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  const config: Record<
    AlertSeverity,
    { label: string; variant: 'danger' | 'warning' | 'info' | 'success' | 'neutral' }
  > = {
    critical: { label: 'Critical', variant: 'danger' },
    high: { label: 'High', variant: 'warning' },
    medium: { label: 'Medium', variant: 'info' },
    low: { label: 'Low', variant: 'neutral' },
    info: { label: 'Info', variant: 'neutral' },
  };

  const current = config[severity] || { label: severity, variant: 'neutral' };

  return (
    <Badge variant={current.variant} testId={`alert-severity-badge-${severity}`}>
      {current.label}
    </Badge>
  );
}

