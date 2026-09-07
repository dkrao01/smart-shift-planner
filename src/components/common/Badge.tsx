import React from 'react';
import type { RequestStatus, ShiftType, AvailabilityStatus } from '../../types';

type BadgeVariant =
  | 'pending' | 'approved' | 'rejected'
  | 'shortage' | 'warning' | 'balanced' | 'over' | 'under'
  | 'day' | 'evening' | 'night'
  | 'available' | 'unavailable' | 'preferred_off' | 'off'
  | 'info' | 'default';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  pending:      'bg-amber-100 text-amber-800 border border-amber-200',
  approved:     'bg-emerald-100 text-emerald-800 border border-emerald-200',
  rejected:     'bg-rose-100 text-rose-800 border border-rose-200',
  shortage:     'bg-rose-100 text-rose-800 border border-rose-200',
  warning:      'bg-amber-100 text-amber-800 border border-amber-200',
  balanced:     'bg-emerald-100 text-emerald-800 border border-emerald-200',
  over:         'bg-orange-100 text-orange-800 border border-orange-200',
  under:        'bg-blue-100 text-blue-800 border border-blue-200',
  day:          'bg-amber-50 text-amber-700 border border-amber-200',
  evening:      'bg-sky-50 text-sky-700 border border-sky-200',
  night:        'bg-indigo-50 text-indigo-700 border border-indigo-200',
  available:    'bg-emerald-100 text-emerald-800 border border-emerald-200',
  unavailable:  'bg-rose-100 text-rose-800 border border-rose-200',
  preferred_off:'bg-slate-100 text-slate-700 border border-slate-200',
  off:         'bg-slate-100 text-slate-700 border border-slate-200',
  info:         'bg-sky-100 text-sky-800 border border-sky-200',
  default:      'bg-navy-100 text-navy-700 border border-navy-200',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export function Badge({ variant = 'default', children, size = 'sm', className = '' }: BadgeProps) {
  const sizeClass = size === 'xs'
    ? 'text-[10px] px-1.5 py-0.5'
    : size === 'sm'
    ? 'text-xs px-2 py-0.5'
    : 'text-sm px-2.5 py-1';

  return (
    <span className={`inline-flex items-center rounded font-medium font-mono ${sizeClass} ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}

// Convenience helpers
export function statusBadge(status: RequestStatus) {
  return <Badge variant={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export function shiftBadge(type: ShiftType) {
  const labels: Record<ShiftType, string> = { day: '☀ Day', evening: '🌆 Eve', night: '🌙 Night' };
  return <Badge variant={type}>{labels[type]}</Badge>;
}

export function availabilityBadge(status: AvailabilityStatus) {
  const labels: Record<AvailabilityStatus, string> = {
    day: '☀ Day',
    evening: '▣ Evening',
    night: '☾ Night',
    off: '– Off',
  };
  return <Badge variant={status}>{labels[status]}</Badge>;
}
