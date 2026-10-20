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
    default: 'bg-elevated text-text-primary border-border-subtle',
    info: 'bg-blue-950/60 text-blue-300 border-blue-700/60',
    success: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60',
    warning: 'bg-amber-950/60 text-amber-200 border-amber-700/60',
    danger: 'bg-red-950/60 text-red-300 border-red-700/60',
    neutral: 'bg-surface text-text-secondary border-border-subtle',
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
