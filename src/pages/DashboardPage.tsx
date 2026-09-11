import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { StatCard, Card, CardHeader } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { LoadingSpinner, WarningBanner } from '../components/common/LoadingSpinner';
import { Badge } from '../components/common/Badge';
import {
  getEmployees, getAssignments, getSwapRequests,
  getOpenShifts, getActiveSchedule, getPlanningSchedule, getScheduleEmployees, grantLateAvailabilityAccess
} from '../services/dataService';
import {
  getDashboardSummary, validateShiftCoverage, validate48HourRule,
  getEmployeeCycleSummary, calculateShiftTypeHours, calculateEmployeeHoursByCycle
} from '../utils/scheduleUtils';
import { formatDate, formatShortDate, formatDayName, getCycleDay } from '../utils/dateUtils';
import type { Employee, ShiftAssignment, SwapRequest, OpenShiftRequest, SchedulePeriod } from '../types';

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [openShifts, setOpenShifts] = useState<OpenShiftRequest[]>([]);
  const [schedule, setSchedule] = useState<SchedulePeriod | null>(null);
  const [planningSchedule, setPlanningSchedule] = useState<SchedulePeriod | null>(null);
  const [planningEmployees, setPlanningEmployees] = useState<Employee[]>([]);
  useEffect(() => {
    async function load() {
      const [emps, asgn, sw, os, sched, planning] = await Promise.all([
        getEmployees(), getAssignments(), getSwapRequests(), getOpenShifts(), getActiveSchedule(), getPlanningSchedule()
      ]);
      const roster = planning ? await getScheduleEmployees(planning.id) : [];
      setEmployees(emps); setAssignments(asgn); setSwaps(sw); setOpenShifts(os); setSchedule(sched); setPlanningSchedule(planning); setPlanningEmployees(roster);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner label="Loading dashboard…" />;

  const isManager = currentUser?.role === 'manager';
  const startDate = schedule?.startDate ?? '';

  if (isManager) {
    return <ManagerDashboard
      employees={employees} assignments={assignments} swaps={swaps}
      openShifts={openShifts} schedule={schedule} planningSchedule={planningSchedule} planningEmployees={planningEmployees} onGrantLateAccess={async employeeId => { if (!planningSchedule) return; await grantLateAvailabilityAccess(planningSchedule.id, employeeId); setPlanningEmployees(await getScheduleEmployees(planningSchedule.id)); }} startDate={startDate}
    />;
  }
  return <EmployeeDashboard
    currentUser={currentUser!} employees={employees} assignments={assignments}
    swaps={swaps} openShifts={openShifts} startDate={startDate}
  />;
}

// ─── Manager Dashboard ────────────────────────────────────────────────────────

function ManagerDashboard({ employees, assignments, swaps, openShifts, schedule, planningSchedule, planningEmployees, onGrantLateAccess, startDate }: {
  employees: Employee[]; assignments: ShiftAssignment[];
  swaps: SwapRequest[]; openShifts: OpenShiftRequest[];
  schedule: SchedulePeriod | null; planningSchedule: SchedulePeriod | null; planningEmployees: Employee[]; onGrantLateAccess: (employeeId: string) => Promise<void>; startDate: string;
}) {
  const pendingSwaps = swaps.filter(s => s.status === 'pending').length;
  const openPool = openShifts.filter(o => o.status === 'open' || o.status === 'requested').length;
  const summary = getDashboardSummary(assignments, employees, startDate, pendingSwaps, openPool);
  const coverageWarnings = validateShiftCoverage(assignments, startDate);
  const cycle1Warnings = validate48HourRule(assignments, employees, startDate, 1);
  const cycle2Warnings = validate48HourRule(assignments, employees, startDate, 2);
  const cycle3Warnings = validate48HourRule(assignments, employees, startDate, 3);
  const allHourWarnings = [...cycle1Warnings, ...cycle2Warnings, ...cycle3Warnings];
  const [showMissed, setShowMissed] = useState(false);
  const [granting, setGranting] = useState('');
  const planningDeadline = planningSchedule?.availabilityDeadline ? new Date(planningSchedule.availabilityDeadline) : null;
  const planningDeadlinePassed = Boolean(planningDeadline && new Date() > planningDeadline);
  const submittedAvailabilityCount = planningEmployees.filter(employee => employee.availabilitySubmittedAt).length;
  const missedDeadlineEmployees = planningDeadlinePassed ? planningEmployees.filter(employee => !employee.availabilitySubmittedAt) : [];

  // Upcoming shifts today
  const today = new Date().toISOString().split('T')[0];
  const todayAssignments = assignments.filter(a => a.date === today);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy-50">Manager Dashboard</h1>
        <p className="text-sm text-navy-400 mt-0.5">
          {schedule ? `Schedule: ${schedule.label}` : 'No active schedule'}
        </p>
      </div>

      {planningSchedule?.availabilityDeadline && planningDeadline && (
        <>
          <Card className="border border-sky-500/25">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-navy-200">Availability deadline</div>
                <div className="text-xs text-navy-400 mt-1">{formatDate(planningDeadline)} · {planningSchedule.label}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-navy-200"><span className="text-emerald-300">{submittedAvailabilityCount} submitted</span> / {planningEmployees.length}{planningDeadlinePassed && <span className="ml-3 text-rose-300">{missedDeadlineEmployees.length} missed deadline</span>}</div>
                {planningDeadlinePassed && <Button size="sm" variant="secondary" onClick={() => setShowMissed(value => !value)}>{showMissed ? 'Hide' : 'View'}</Button>}
              </div>
            </div>
          </Card>
          {showMissed && planningDeadlinePassed && (
            <Card>
              <CardHeader title="Employees who missed the deadline" subtitle="Granting access lets one employee submit availability for this period." />
              {missedDeadlineEmployees.length === 0 ? <p className="text-sm text-navy-400">Everyone in this period has submitted availability.</p> : (
                <div className="space-y-2">
                  {missedDeadlineEmployees.map(employee => (
                    <div key={employee.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-navy-900 p-3">
                      <div><p className="text-sm font-medium text-navy-100">{employee.name}</p><p className="text-xs text-navy-400">{employee.email}</p></div>
                      <Button size="sm" disabled={granting === employee.id} onClick={async () => { setGranting(employee.id); try { await onGrantLateAccess(employee.id); } finally { setGranting(''); } }}>{granting === employee.id ? 'Granting…' : 'Grant re-access'}</Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DashboardLink to="/schedule"><StatCard label="Total Shifts" value={summary.totalShifts} icon="▦" /></DashboardLink>
        <DashboardLink to="/schedule"><StatCard label="Shortages" value={summary.shiftsWithShortage} icon="⚠" variant={summary.shiftsWithShortage > 0 ? 'danger' : 'success'} sub="shifts under 2 staff" /></DashboardLink>
        <DashboardLink to="/swaps"><StatCard label="Pending Swaps" value={pendingSwaps} icon="⇄" variant={pendingSwaps > 0 ? 'warning' : 'default'} /></DashboardLink>
        <DashboardLink to="/open-shifts"><StatCard label="Open Shift Pool" value={openPool} icon="◯" variant={openPool > 0 ? 'warning' : 'default'} sub="available shifts" /></DashboardLink>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <DashboardLink to="/fairness"><StatCard label="Under 48h" value={summary.employeesBelowHours} icon="↓" variant={summary.employeesBelowHours > 0 ? 'warning' : 'success'} sub="employees" /></DashboardLink>
        <DashboardLink to="/fairness"><StatCard label="Over 48h" value={summary.employeesAboveHours} icon="↑" variant={summary.employeesAboveHours > 0 ? 'warning' : 'success'} sub="employees" /></DashboardLink>
        <DashboardLink to="/fairness"><StatCard label="Fairness Alerts" value={summary.employeesWithFairnessWarnings} icon="⚖" variant={summary.employeesWithFairnessWarnings > 0 ? 'warning' : 'success'} sub="employees" /></DashboardLink>
      </div>

      {/* Warnings */}
      {coverageWarnings.length > 0 && (
        <Card>
          <CardHeader title="Coverage Warnings" icon="🔴" subtitle="Shifts with less than 2 employees" />
          <div className="space-y-2">
            {coverageWarnings.slice(0, 5).map((w, i) => (
              <WarningBanner key={i} message={w.message} type="error" />
            ))}
            {coverageWarnings.length > 5 && (
              <p className="text-xs text-navy-500 font-mono">+{coverageWarnings.length - 5} more — <Link to="/schedule" className="text-brand-400 hover:underline">View Schedule</Link></p>
            )}
          </div>
        </Card>
      )}

      {/* Today's shifts */}
      {todayAssignments.length > 0 && (
        <Card>
          <CardHeader title="Today's Shifts" icon="📅" subtitle={formatDate(today)} />
          <div className="space-y-2">
            {(['day', 'evening', 'night'] as const).map(type => {
              const list = todayAssignments.filter(a => a.shiftType === type);
              if (list.length === 0) return null;
              const empNames = list.map(a => employees.find(e => e.id === a.employeeId)?.name ?? a.employeeId);
              return (
                <div key={type} className="flex items-center gap-3 py-2 border-b border-navy-700/50 last:border-0">
                  <Badge variant={type} size="sm">
                    {type === 'day' ? '☀' : type === 'evening' ? '🌆' : '🌙'} {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Badge>
                  <div className="flex-1 text-xs text-navy-300">{empNames.join(', ')}</div>
                  {list.length < 2 && <Badge variant="shortage" size="xs">SHORTAGE</Badge>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Pending approvals */}
      {(pendingSwaps + openPool) > 0 && (
        <Card>
          <CardHeader title="Pending Approvals" icon="⏳" />
          <div className="space-y-2">
            {pendingSwaps > 0 && (
              <Link to="/swaps" className="flex items-center justify-between p-3 bg-navy-900 rounded-lg hover:bg-navy-700 transition-colors">
                <div className="text-sm text-navy-200">Shift Swap Requests</div>
                <Badge variant="pending">{pendingSwaps} pending</Badge>
              </Link>
            )}
            {openPool > 0 && (
              <Link to="/open-shifts" className="flex items-center justify-between p-3 bg-navy-900 rounded-lg hover:bg-navy-700 transition-colors">
                <div className="text-sm text-navy-200">Open Shift Pool</div>
                <Badge variant="pending">{openPool} open</Badge>
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* Hour warnings */}
      {allHourWarnings.length > 0 && (
        <Card>
          <CardHeader title="Hours Warnings" icon="⚠" subtitle="Employees not at 48h target" />
          <div className="space-y-1.5">
            {allHourWarnings.slice(0, 6).map((w, i) => (
              <WarningBanner key={i} message={w.message} type="warning" />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function DashboardLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="block rounded-xl transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-400">{children}</Link>;
}
// ─── Employee Dashboard ───────────────────────────────────────────────────────

function EmployeeDashboard({ currentUser, employees, assignments, swaps, openShifts, startDate }: {
  currentUser: { uid: string; name: string; employeeId: string };
  employees: Employee[]; assignments: ShiftAssignment[];
  swaps: SwapRequest[]; openShifts: OpenShiftRequest[];
  startDate: string;
}) {
  const empId = currentUser.employeeId;
  const myAssignments = assignments.filter(a => a.employeeId === empId);

  const today = new Date().toISOString().split('T')[0];
  const myNextShift = myAssignments.find(a => a.date >= today);

  const c1Hours = calculateEmployeeHoursByCycle(assignments, empId, startDate, 1);
  const c2Hours = calculateEmployeeHoursByCycle(assignments, empId, startDate, 2);
  const c3Hours = calculateEmployeeHoursByCycle(assignments, empId, startDate, 3);
  const periodAssignments = assignments.filter(assignment => {
    const periodStart = new Date(`${startDate}T00:00:00Z`).getTime();
    const assignmentDate = new Date(`${assignment.date}T00:00:00Z`).getTime();
    return assignmentDate >= periodStart && assignmentDate < periodStart + 23 * 24 * 60 * 60 * 1000;
  });
  const shiftHours = calculateShiftTypeHours(periodAssignments, empId);

  const myPendingSwaps = swaps.filter(s => (s.requesterId === empId || s.targetId === empId) && s.status === 'pending').length;
  const myPendingOpenShifts = openShifts.filter(o => o.pickupEmployeeId === empId && o.pickupStatus === 'pending').length;

  const nextShiftEmp = myNextShift ? employees.find(e => e.id === empId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-navy-50">Welcome, {currentUser.name}</h1>
        <p className="text-sm text-navy-400 mt-0.5">
          {startDate ? `Current period: ${formatDate(startDate)}` : 'No active schedule'}
        </p>
      </div>

      {/* Next shift */}
      {myNextShift ? (
        <Card className="border border-brand-500/20">
          <CardHeader title="Next Shift" icon="📌" />
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl
              ${myNextShift.shiftType === 'day' ? 'bg-amber-500/15' : myNextShift.shiftType === 'evening' ? 'bg-sky-500/15' : 'bg-indigo-500/15'}`}>
              {myNextShift.shiftType === 'day' ? '☀' : myNextShift.shiftType === 'evening' ? '🌆' : '🌙'}
            </div>
            <div>
              <div className="text-sm font-semibold text-navy-100">
                {formatDayName(myNextShift.date)}, {formatShortDate(myNextShift.date)}
              </div>
              <div className="text-xs text-navy-400">
                {myNextShift.shiftType.charAt(0).toUpperCase() + myNextShift.shiftType.slice(1)} Shift · {myNextShift.hours}h
              </div>
              <Badge variant={myNextShift.shiftType} size="xs" className="mt-1">
                {myNextShift.shiftType === 'day' ? '06:00–14:00' : myNextShift.shiftType === 'evening' ? '14:00–22:00' : '22:00–06:00'}
              </Badge>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-navy-400 text-center py-4">No upcoming shifts assigned.</p>
        </Card>
      )}

      {/* Hours */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Cycle 1 Hours" value={`${c1Hours}h`} icon="⏱"
          variant={c1Hours < 48 ? 'warning' : c1Hours > 48 ? 'danger' : 'success'}
          sub={c1Hours === 48 ? '✓ On target' : c1Hours < 48 ? `${48 - c1Hours}h short` : `${c1Hours - 48}h over`}
        />
        <StatCard label="Cycle 2 Hours" value={`${c2Hours}h`} icon="⏱"
          variant={c2Hours < 48 ? 'warning' : c2Hours > 48 ? 'danger' : 'success'}
          sub={c2Hours === 48 ? '✓ On target' : c2Hours < 48 ? `${48 - c2Hours}h short` : `${c2Hours - 48}h over`}
        />
        <StatCard label="Cycle 3 Hours" value={`${c3Hours}h`} icon="⏱"
          variant={c3Hours < 48 ? 'warning' : c3Hours > 48 ? 'danger' : 'success'}
          sub={c3Hours === 48 ? '✓ On target' : c3Hours < 48 ? `${48 - c3Hours}h short` : `${c3Hours - 48}h over`}
        />
      </div>

      {/* Shift type balance */}
      <Card>
        <CardHeader title="Shift Type Balance" subtitle="Target: 48h each across the 23-day period" icon="⚖" />
        <div className="space-y-3">
          {(['day', 'evening', 'night'] as const).map(type => {
            const hours = shiftHours[type];
            const pct = Math.min(100, Math.round((hours / 48) * 100));
            const isOver = hours > 48;
            return (
              <div key={type}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-navy-300">{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                  <span className={`font-mono ${isOver ? 'text-rose-400' : 'text-navy-400'}`}>{hours}h / 48h{isOver && ` (${hours - 48}h over)`}</span>
                </div>
                <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isOver ? 'bg-rose-500' : type === 'day' ? 'bg-amber-500' : type === 'evening' ? 'bg-sky-500' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Pending requests */}
      {(myPendingSwaps + myPendingOpenShifts) > 0 && (
        <Card>
          <CardHeader title="Pending Requests" icon="⏳" />
          {myPendingSwaps > 0 && (
            <Link to="/swaps" className="flex items-center justify-between p-2.5 bg-navy-900 rounded-lg mb-2">
              <span className="text-sm text-navy-300">Swap requests</span>
              <Badge variant="pending">{myPendingSwaps}</Badge>
            </Link>
          )}
          {myPendingOpenShifts > 0 && (
            <Link to="/open-shifts" className="flex items-center justify-between p-2.5 bg-navy-900 rounded-lg">
              <span className="text-sm text-navy-300">Open shift pickups</span>
              <Badge variant="pending">{myPendingOpenShifts}</Badge>
            </Link>
          )}
        </Card>
      )}

      {/* Quick actions */}
      <Card>
        <CardHeader title="Quick Actions" icon="⚡" />
        <div className="grid grid-cols-2 gap-2">
          <Link to="/availability" className="p-3 bg-navy-900 rounded-lg text-center hover:bg-navy-700 transition-colors">
            <div className="text-lg mb-1">✓</div>
            <div className="text-xs text-navy-300">Submit Availability</div>
          </Link>
          <Link to="/swaps" className="p-3 bg-navy-900 rounded-lg text-center hover:bg-navy-700 transition-colors">
            <div className="text-lg mb-1">⇄</div>
            <div className="text-xs text-navy-300">Request Swap</div>
          </Link>
          <Link to="/open-shifts" className="p-3 bg-navy-900 rounded-lg text-center hover:bg-navy-700 transition-colors">
            <div className="text-lg mb-1">◯</div>
            <div className="text-xs text-navy-300">Open Shift Pool</div>
          </Link>
          <Link to="/schedule" className="p-3 bg-navy-900 rounded-lg text-center hover:bg-navy-700 transition-colors">
            <div className="text-lg mb-1">▦</div>
            <div className="text-xs text-navy-300">View Schedule</div>
          </Link>
        </div>
      </Card>
    </div>
  );
}
