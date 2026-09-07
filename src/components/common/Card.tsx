import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  bordered?: boolean;
}

export function Card({ children, className = '', padding = 'md', bordered = false }: CardProps) {
  const padClass = padding === 'none' ? '' : padding === 'sm' ? 'p-3' : padding === 'md' ? 'p-4' : 'p-6';
  const borderClass = bordered ? 'border border-navy-700' : '';
  return (
    <div className={`bg-navy-800 rounded-lg ${padClass} ${borderClass} ${className}`}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: string;
}

export function CardHeader({ title, subtitle, action, icon }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon && <span className="text-xl">{icon}</span>}
        <div>
          <h3 className="text-sm font-semibold text-navy-100 font-sans">{title}</h3>
          {subtitle && <p className="text-xs text-navy-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  variant?: 'default' | 'warning' | 'danger' | 'success';
  sub?: string;
}

export function StatCard({ label, value, icon, variant = 'default', sub }: StatCardProps) {
  const colors = {
    default: 'border-navy-700',
    warning: 'border-amber-500/40',
    danger:  'border-rose-500/40',
    success: 'border-emerald-500/40',
  };
  const valueColors = {
    default: 'text-navy-100',
    warning: 'text-amber-400',
    danger:  'text-rose-400',
    success: 'text-emerald-400',
  };
  return (
    <Card bordered className={`border ${colors[variant]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-navy-400 font-mono uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${valueColors[variant]}`}>{value}</p>
          {sub && <p className="text-xs text-navy-500 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl opacity-70">{icon}</span>
      </div>
    </Card>
  );
}
