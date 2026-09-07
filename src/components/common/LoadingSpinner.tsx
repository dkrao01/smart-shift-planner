import React from 'react';

export function LoadingSpinner({ size = 'md', label }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const s = size === 'sm' ? 'h-5 w-5' : size === 'md' ? 'h-8 w-8' : 'h-12 w-12';
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <svg className={`animate-spin ${s} text-brand-500`} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label && <p className="text-sm text-navy-400">{label}</p>}
    </div>
  );
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = '📋', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
      <div className="text-4xl mb-3 opacity-50">{icon}</div>
      <h3 className="text-sm font-semibold text-navy-300 mb-1">{title}</h3>
      {description && <p className="text-xs text-navy-500 mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-navy-50 font-sans">{title}</h1>
        {subtitle && <p className="text-sm text-navy-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function WarningBanner({ message, type = 'warning' }: { message: string; type?: 'warning' | 'error' | 'info' }) {
  const styles = {
    warning: 'bg-amber-900/30 border-amber-500/40 text-amber-300',
    error:   'bg-rose-900/30 border-rose-500/40 text-rose-300',
    info:    'bg-sky-900/30 border-sky-500/40 text-sky-300',
  };
  const icons = { warning: '⚠', error: '✕', info: 'ℹ' };
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${styles[type]}`}>
      <span className="mt-0.5 shrink-0">{icons[type]}</span>
      <span>{message}</span>
    </div>
  );
}
