import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { addDaysToStr, formatDate } from '../utils/dateUtils';
import { Badge } from '../components/common/Badge';
import { LoadingSpinner, PageHeader, WarningBanner } from '../components/common/LoadingSpinner';
import {
  getEmployees, getAssignments, getPlanningSchedule
} from '../services/dataService';
import {
  getEmployeeCycleSummary, getEmployeeFairnessSummary,
  calculateShiftTypeHours, calculateEmployeeHoursByCycle
} from '../utils/scheduleUtils';
import type { Employee, ShiftAssignment, SchedulePeriod, CycleSummary, FairnessSummary } from '../types';

const FAIRNESS_TARGET = 48;
const CYCLE_TARGET = 48;

export default function FairnessPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [schedule, setSchedule] = useState<SchedulePeriod | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<1 | 2 | 3>(1);

  const isManager = currentUser?.role === 'manager';
  const myEmpId = currentUser?.employeeId ?? '';

  useEffect(() => {
    async function load() {
      const [emps, asgn, sched] = await Promise.all([
        getEmployees(), getAssignments(), getPlanningSchedule()
      ]);
      setEmployees(emps); setAssignments(asgn); setSchedule(sched);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner label="Calculating hours…" />;

  const startDate = schedule?.startDate ?? '';
  const cycleSummaries = getEmployeeCycleSummary(assignments, employees, startDate, selectedCycle);
  const fairnessSummaries = getEmployeeFairnessSummary(assignments, employees, startDate);
  const cycleRanges = startDate ? ([
    { cycle: 1, start: addDaysToStr(startDate, 0), end: addDaysToStr(startDate, 7) },
    { cycle: 2, start: addDaysToStr(startDate, 8), end: addDaysToStr(startDate, 15) },
    { cycle: 3, start: addDaysToStr(startDate, 16), end: addDaysToStr(startDate, 22) },
  ] as const) : [];

  // For employees, only show their own row
  const displayCycle = isManager ? cycleSummaries : cycleSummaries.filter(s => s.employeeId === myEmpId);
  const displayFairness = isManager ? fairnessSummaries : fairnessSummaries.filter(s => s.employeeId === myEmpId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hours & Fairness"
        subtitle="48h in each cycle · 48h of every shift type per period"
      />

      {/* Cycle selector (manager) */}
      {isManager && (
        <div className="flex gap-2">
          {([1, 2, 3] as const).map(c => (
            <button
              key={c}
              onClick={() => setSelectedCycle(c)}
              className={`px-4 py-1.5 text-xs rounded font-mono border transition-colors ${selectedCycle === c ? 'bg-brand-500 text-white border-brand-500' : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-500'}`}
            >
              Cycle {c}
            </button>
          ))}
        </div>
      )}

      {cycleRanges.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {cycleRanges.map(range => (
            <div key={range.cycle} className={`rounded-lg border px-3 py-2 text-xs ${selectedCycle === range.cycle ? 'border-brand-500/50 bg-brand-500/10 text-navy-100' : 'border-navy-700 bg-navy-900 text-navy-400'}`}>
              <div className="font-medium">Cycle {range.cycle}</div>
              <div className="mt-1 font-mono">{formatDate(range.start, 'dd-MM-yyyy')} to {formatDate(range.end, 'dd-MM-yyyy')}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cycle hours */}
      <div>
        <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-3">
          Cycle {selectedCycle} — Hours (Target: 48h)
        </h3>
        <div className="space-y-2">
          {displayCycle.map(s => <CycleRow key={s.employeeId} summary={s} />)}
        </div>
      </div>

      {/* Fairness breakdown */}
      <div>
        <h3 className="text-xs font-mono text-navy-500 uppercase tracking-wide mb-1">
          Shift Type Balance — 23-Day Period (Target: 48h each)
        </h3>
        <p className="text-xs text-navy-600 mb-3">
          Every employee must complete exactly 48h of Day, Evening, and Night shifts within this 23-day period. Consecutive overtime shifts are shown in Schedule but are excluded from these normal roster-hour targets.
        </p>
        <div className="space-y-3">
          {displayFairness.map(f => <FairnessRow key={f.employeeId} summary={f} />)}
        </div>
      </div>

      {/* Fairness warnings */}
      {isManager && fairnessSummaries.filter(f => f.hasWarning).length > 0 && (
        <Card>
          <CardHeader title="Fairness Warnings" icon="⚖" subtitle="Employees with shift type imbalances" />
          <div className="space-y-1.5">
            {fairnessSummaries
              .filter(f => f.hasWarning)
              .flatMap(f => {
                const warnings = [];
                if (f.nightNeeded > 0) warnings.push(`${f.employeeName} needs ${f.nightNeeded}h more Night shifts.`);
                if (f.eveningNeeded > 0) warnings.push(`${f.employeeName} needs ${f.eveningNeeded}h more Evening shifts.`);
                if (f.dayNeeded > 0) warnings.push(`${f.employeeName} needs ${f.dayNeeded}h more Day shifts.`);
                return warnings;
              })
              .map((w, i) => <WarningBanner key={i} message={w} type="warning" />)
            }
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Cycle Row ────────────────────────────────────────────────────────────────

function CycleRow({ summary }: { summary: CycleSummary }) {
  const pct = Math.min(100, Math.round((summary.totalHours / CYCLE_TARGET) * 100));
  const status = summary.totalHours === CYCLE_TARGET ? 'balanced'
    : summary.isUnder ? 'under'
    : 'over';

  return (
    <Card className="py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-navy-200">{summary.employeeName}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-navy-400">{summary.totalHours}h / {CYCLE_TARGET}h</span>
          <Badge variant={status} size="xs">
            {status === 'balanced' ? '✓ OK' : status === 'under' ? `−${CYCLE_TARGET - summary.totalHours}h` : `+${summary.totalHours - CYCLE_TARGET}h`}
          </Badge>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-navy-900 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all ${
            status === 'balanced' ? 'bg-emerald-500' : status === 'under' ? 'bg-sky-500' : 'bg-orange-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Shift breakdown */}
      <div className="flex gap-3 text-[11px] font-mono text-navy-500">
        <span className="text-amber-400/80">☀ {summary.dayHours}h</span>
        <span className="text-sky-400/80">🌆 {summary.eveningHours}h</span>
        <span className="text-indigo-400/80">🌙 {summary.nightHours}h</span>
        <span className="ml-auto">{summary.workDays} days</span>
      </div>
    </Card>
  );
}

// ─── Fairness Row ─────────────────────────────────────────────────────────────

function FairnessRow({ summary }: { summary: FairnessSummary }) {
  const types = [
    { label: 'Day',     hours: summary.dayHours,     needed: summary.dayNeeded,     color: 'bg-amber-500',  textColor: 'text-amber-400' },
    { label: 'Evening', hours: summary.eveningHours, needed: summary.eveningNeeded, color: 'bg-sky-500',    textColor: 'text-sky-400' },
    { label: 'Night',   hours: summary.nightHours,   needed: summary.nightNeeded,   color: 'bg-indigo-500', textColor: 'text-indigo-400' },
  ];

  return (
    <Card className={summary.hasWarning ? 'border border-amber-500/25' : ''}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-navy-200">{summary.employeeName}</span>
        {summary.hasWarning ? (
          <Badge variant="warning" size="xs">⚠ Imbalanced</Badge>
        ) : (
          <Badge variant="balanced" size="xs">✓ Balanced</Badge>
        )}
      </div>

      <div className="space-y-2.5">
        {types.map(t => {
          const pct = Math.min(100, Math.round((t.hours / FAIRNESS_TARGET) * 100));
          const isOver = t.hours > FAIRNESS_TARGET;
          return (
            <div key={t.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className={t.textColor}>{t.label}</span>
                <span className={`font-mono ${isOver ? 'text-rose-400' : 'text-navy-500'}`}>
                  {t.hours}h / {FAIRNESS_TARGET}h
                  {isOver ? <span className="ml-1">({t.hours - FAIRNESS_TARGET}h over)</span> : t.needed > 0 && <span className="text-amber-400 ml-1">(needs {t.needed}h more)</span>}
                </span>
              </div>
              <div className="h-1.5 bg-navy-900 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${isOver ? 'bg-rose-500' : t.color}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
