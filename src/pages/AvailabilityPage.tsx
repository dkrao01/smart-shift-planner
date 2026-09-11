import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { Badge, availabilityBadge } from '../components/common/Badge';
import { LoadingSpinner, EmptyState, PageHeader } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { AvailabilityPlanReview } from '../components/AvailabilityPlanReview';
import { prepareAvailabilityPlan, applyAvailabilityPlan, type AvailabilityPlan } from '../services/availabilityPlanning';
import { USE_SUPABASE } from '../lib/supabase';
import {
  getEmployees, getAssignments, getActiveSchedule,
  clearAvailabilityChoice,
  getAvailability, setAvailability, removeAvailability, publishRestDays, approveEmployeeAvailability, rejectEmployeeAvailability, requestAvailabilityResubmission, createSchedulePeriod, getPlanningSchedule, getSchedulePeriods, getScheduleEmployees, updateSchedulePeriodDates, deleteFutureSchedulePeriod, addEmployeeToSchedule, removeEmployeeFromSchedule, setScheduleEmployeeOrder, submitEmployeeAvailability, reopenManagerRestDays, diagnoseAvailabilityEdit
} from '../services/dataService';
import { formatDate, formatDayName, formatShortDate, buildPeriodRange, getCycleDay } from '../utils/dateUtils';
import type { Employee, SchedulePeriod, Availability, AvailabilityStatus } from '../types';

const STATUS_OPTIONS: { value: 'day' | 'evening' | 'night'; label: string; color: string }[] = [
  { value: 'day',        label: '☀ Day',       color: 'bg-amber-500 text-white border-amber-500' },
  { value: 'evening',    label: '▣ Evening',   color: 'bg-sky-600 text-white border-sky-600' },
  { value: 'night',      label: '☾ Night',     color: 'bg-indigo-600 text-white border-indigo-600' },
];

export default function AvailabilityPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
 const [schedule, setSchedule] = useState<SchedulePeriod | null>(null);
  const [availability, setAvailabilityState] = useState<Availability[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [availabilityError, setAvailabilityError] = useState('');
  const [periodSubmitting, setPeriodSubmitting] = useState(false);
  const [periodSubmitted, setPeriodSubmitted] = useState(false);
  const [periods, setPeriods] = useState<SchedulePeriod[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | undefined>();

  const isManager = currentUser?.role === 'manager';

  async function load(scheduleId?: string) {
    const [all, allPeriods, defaultSchedule] = await Promise.all([getEmployees(), getSchedulePeriods(), isManager ? getActiveSchedule().then(active => active ?? getPlanningSchedule()) : getPlanningSchedule()]);
    const sched = scheduleId ? allPeriods.find(period => period.id === scheduleId) ?? defaultSchedule : defaultSchedule;
    const [avail, roster] = sched ? await Promise.all([getAvailability(sched.id), getScheduleEmployees(sched.id)]) : [[], []];
    setAllEmployees(all);
    setPeriods(allPeriods);
    setEmployees(roster);
    setAvailabilityState(avail);
    setSchedule(sched);
    // Pre-fill notes
    const n: Record<string, string> = {};
    avail.forEach(a => { n[`${a.employeeId}|${a.date}`] = a.note ?? ''; });
    setNotes(n);
    setLoading(false);
  }

  useEffect(() => { load(selectedScheduleId); const timer = window.setInterval(() => load(selectedScheduleId), 5000); return () => window.clearInterval(timer); }, [selectedScheduleId, isManager]);

  function getAvailStatus(empId: string, date: string): AvailabilityStatus | undefined {
    return availability.find(a => a.scheduleId === schedule?.id && a.employeeId === empId && a.date === date)?.status;
  }

  function getShiftCounts(empId: string): Record<'day' | 'evening' | 'night', number> {
    const counts = { day: 0, evening: 0, night: 0 };
    availability.filter(a => a.scheduleId === schedule?.id && a.employeeId === empId).forEach(a => {
      if (a.status === 'day' || a.status === 'evening' || a.status === 'night') counts[a.status] += 1;
    });
    return counts;
  }

  async function handleSetStatus(date: string, status: AvailabilityStatus) {
    if (!schedule || !currentUser) return;
    const empId = currentUser.employeeId;
    const key = `${empId}|${date}`;
    setSaving(p => ({ ...p, [key]: true }));
    setAvailabilityError('');
    try {
      await setAvailability({
        employeeId: empId,
        scheduleId: schedule.id,
        date,
        status,
        note: notes[key] ?? '',
        submittedAt: new Date().toISOString(),
        approvalStatus: 'pending',
      });
      setPeriodSubmitted(false);
      await load();
    } catch (err) {
      // A database function error is the authoritative reason. Preserve it
      // instead of replacing it with a secondary diagnostic guess.
      const databaseMessage = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'This shift could not be selected.';
      try {
        const diagnostic = await diagnoseAvailabilityEdit(schedule.id, date, status as 'day' | 'evening' | 'night');
        setAvailabilityError(databaseMessage || diagnostic?.reason || 'This shift could not be selected.');
      } catch {
        setAvailabilityError(databaseMessage);
      }
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }

  async function handleClearChoice(date: string) {
    if (!schedule || !currentUser || availabilityLocked) return;
    const entry = availability.find(a => a.scheduleId === schedule.id && a.employeeId === currentUser.employeeId && a.date === date);
    if (!entry || entry.status === 'off' || entry.approvalStatus === 'approved') return;
    const key = `${currentUser.employeeId}|${date}`;
    setSaving(p => ({ ...p, [key]: true }));
    setAvailabilityError('');
    try {
      await clearAvailabilityChoice(entry.id);
      setPeriodSubmitted(false);
      await load(schedule.id);
    } catch (err) {
      setAvailabilityError(err && typeof err === 'object' && 'message' in err
        ? String(err.message) : 'Could not clear this choice.');
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }

  async function handleNoteBlur(date: string) {
    if (!schedule || !currentUser) return;
    const empId = currentUser.employeeId;
    const key = `${empId}|${date}`;
    const existing = availability.find(a => a.scheduleId === schedule.id && a.employeeId === empId && a.date === date);
    if (!existing) return;
    await setAvailability({ ...existing, note: notes[key] ?? '' });
    await load();
  }

  async function handleSubmitPeriod(dates: string[]) {
    if (!schedule || !currentUser) return;
    const empId = currentUser.employeeId;
    const entries = dates.map(date => availability.find(a => a.employeeId === empId && a.date === date));
    if (entries.some(entry => !entry)) return;
    setPeriodSubmitting(true);
    setAvailabilityError('');
    try {
      await Promise.all(entries.map(entry => setAvailability({
        ...entry!,
        note: notes[`${empId}|${entry!.date}`] ?? entry!.note ?? '',
        submittedAt: new Date().toISOString(),
        approvalStatus: 'pending',
      })));
      await submitEmployeeAvailability(schedule.id, empId);
      await load();
      setPeriodSubmitted(true);
    } catch (err) {
      setAvailabilityError(err instanceof Error ? err.message : 'Could not submit your availability.');
    } finally {
      setPeriodSubmitting(false);
    }
  }

  if (loading) return <LoadingSpinner label="Loading availability…" />;
  if (!schedule) return isManager ? <CreatePeriodView onCreate={async (startDate) => { await createSchedulePeriod(startDate, currentUser!.uid); await load(); }} /> : <EmptyState icon="?" title="No active schedule" description="Your manager has not created the next 23-day period yet." />;

  const dates = buildPeriodRange(schedule.startDate);

  async function handleManagerOff(employeeId: string, date: string) {
    if (!schedule) return;
    const existing = availability.find(a => a.scheduleId === schedule.id && a.employeeId === employeeId && a.date === date);
    const offCount = availability.filter(a => a.scheduleId === schedule.id && a.employeeId === employeeId && a.status === 'off').length;
    if (existing?.status !== 'off' && offCount >= 5) return;
    if (existing?.status === 'off') await removeAvailability(existing.id);
    else await setAvailability({
      employeeId, scheduleId: schedule.id, date, status: 'off',
      note: 'Manager-assigned rest day', submittedAt: new Date().toISOString(),
    });
    await load();
  }

  async function handlePublishRestDays() {
    if (!schedule) return;
    const allComplete = employees.every(employee =>
      availability.filter(a => a.scheduleId === schedule.id && a.employeeId === employee.id && a.status === 'off').length === 5
    );
    if (!allComplete) return;
    await publishRestDays(schedule.id);
    await load();
  }

  if (isManager) {
    return <ManagerAvailabilityView key={schedule.id} onAvailabilityChanged={() => load(schedule.id)} employees={employees} allEmployees={allEmployees} dates={dates} availability={availability} published={Boolean(schedule.restDaysPublished)} canEditRestDays={schedule.endDate >= new Date().toISOString().slice(0, 10)} schedule={schedule} periods={periods} onSelectPeriod={async id => setSelectedScheduleId(id)} onDeletePeriod={async id => { const sourceId = await deleteFutureSchedulePeriod(id); setSelectedScheduleId(sourceId); await load(sourceId); }} onAddEmployee={async employeeId => { await addEmployeeToSchedule(schedule.id, employeeId); await reopenManagerRestDays(schedule.id); await load(); }} onRemoveEmployee={async employeeId => { await removeEmployeeFromSchedule(schedule.id, employeeId); await reopenManagerRestDays(schedule.id); await load(); }} onReorderEmployees={async employeeIds => { await setScheduleEmployeeOrder(schedule.id, employeeIds); await load(); }} onCreatePeriod={async (startDate, repeat) => { const created = await createSchedulePeriod(startDate, currentUser!.uid, repeat ? schedule : undefined, schedule); setSelectedScheduleId(created.id); await load(created.id); }} scheduleId={schedule.id} onToggleOff={handleManagerOff} onPublish={handlePublishRestDays} onApprove={async employeeId => { await approveEmployeeAvailability(employeeId, schedule.id); await load(); }} onReject={async (employeeId, note) => { await rejectEmployeeAvailability(employeeId, schedule.id, note); await load(); }} onResubmit={async (employeeId, note) => { await requestAvailabilityResubmission(employeeId, schedule.id, note); await load(); }} />;
  }

  if (!employees.some(employee => employee.id === currentUser!.employeeId)) return <EmptyState icon='?' title='Not included in this period' description='Your manager has not added you to this schedule period yet.' />;

  const managerOffDates = availability.filter(a => a.scheduleId === schedule.id && a.employeeId === currentUser!.employeeId && a.status === 'off').map(a => a.date);
  if (!schedule.restDaysPublished || managerOffDates.length !== 5) {
    return (
      <div className="space-y-5">
        <PageHeader title="My Availability" subtitle={`Schedule: ${schedule.label}`} />
        <div className="bg-amber-900/20 border border-amber-500/25 rounded-lg px-4 py-3 text-sm text-amber-200">
          Manager needs to finish and publish your 5 rest days first. Availability opens after the manager posts the complete rest-day schedule.
        </div>
      </div>
    );
  }

  const workDates = dates.filter(date => !managerOffDates.includes(date));
  const deadlinePassed = Boolean(schedule.availabilityDeadline && new Date() > new Date(schedule.availabilityDeadline));
  const shiftCounts = getShiftCounts(currentUser!.employeeId);
  const periodComplete = workDates.every(date => Boolean(getAvailStatus(currentUser!.employeeId, date))) && shiftCounts.day === 6 && shiftCounts.evening === 6 && shiftCounts.night === 6;
  const currentRosterEmployee = employees.find(employee => employee.id === currentUser!.employeeId);
  const currentEntry = availability.find(a => a.scheduleId === schedule.id && a.employeeId === currentUser!.employeeId && a.status !== 'off')
    ?? availability.find(a => a.scheduleId === schedule.id && a.employeeId === currentUser!.employeeId && a.approvalStatus === 'resubmit');
  const currentApproval = currentEntry?.approvalStatus;
  const openWave = Math.min(...employees.filter(employee => !employee.availabilityApprovedAt).map(employee => employee.availabilityWave ?? 1));
  const queuePairs = Array.from(new Set(employees.map(employee => employee.availabilityWave ?? 1))).sort((a, b) => a - b).map(wave => ({ wave, people: employees.filter(employee => (employee.availabilityWave ?? 1) === wave) }));
  const canPickThisWave = Boolean(currentRosterEmployee?.availabilityDeadlineOverride || currentRosterEmployee?.availabilityWave === openWave);
  const availabilityLocked = currentApproval === 'approved' || deadlinePassed || Boolean(currentRosterEmployee?.availabilitySubmittedAt) || !canPickThisWave;
  const availabilityLockMessage = currentApproval === 'approved' ? 'Your availability is approved and fixed for this period.' : deadlinePassed ? 'The availability deadline has passed.' : currentRosterEmployee?.availabilitySubmittedAt ? 'Your complete availability was submitted and is waiting for manager review.' : !canPickThisWave ? 'Your pair is waiting for the earlier pair to be approved.' : null;
  function getShiftCapacity(date: string, type: 'day' | 'evening' | 'night') {
    const offCount = availability.filter(item => item.scheduleId === schedule!.id && item.date === date && item.status === 'off').length;
    // Approved choices always reserve capacity. Pending choices reserve it
    // only for the pair currently picking; old draft data must not block later pairs.
    const reserved = (shift: 'day' | 'evening' | 'night') => availability.filter(item => {
      if (item.scheduleId !== schedule!.id || item.date !== date || item.status !== shift || item.employeeId === currentUser!.employeeId) return false;
      if (item.approvalStatus === 'approved') return true;
      if (item.approvalStatus !== 'pending') return false;
      return employees.find(employee => employee.id === item.employeeId)?.availabilityPairIndex === currentRosterEmployee?.availabilityPairIndex;
    }).length;
    const otherShiftAlreadyHasThree = (['day', 'evening', 'night'] as const).some(shift => shift !== type && reserved(shift) >= 3);
    const capacity = offCount === 1 && !otherShiftAlreadyHasThree ? 3 : 2;
    const taken = reserved(type);
    return { taken, capacity, filled: taken >= capacity };
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Availability"
        subtitle={`Schedule: ${schedule.label}`}
      />
      <Card className="border border-violet-500/25"><CardHeader title="Availability picking order" subtitle="Pairs rotate their first-pick position each period. The manager’s roster display order cannot change the pairs." /><div className="space-y-2 text-sm">{queuePairs.map((entry, index) => { const completed = entry.people.every(person => Boolean(person.availabilityApprovedAt)); const picking = !completed && entry.wave === openWave; return <div key={entry.wave} className={`rounded border px-3 py-2 ${completed ? 'border-sky-500/30 bg-sky-900/20 text-sky-200' : picking ? 'border-emerald-500/40 bg-emerald-900/20 text-emerald-100' : 'border-navy-700 bg-navy-900/40 text-navy-400'}`}><strong>{index + 1}. {entry.people.map(person => person.name).join(' & ')}</strong><span className="ml-2">— {completed ? 'Picked up' : picking ? 'Picking now' : 'Waiting'}</span></div>; })}</div></Card>
      {availabilityLockMessage && <div className="bg-amber-900/20 border border-amber-500/25 rounded-lg px-3 py-2 text-xs text-amber-200">{availabilityLockMessage}</div>}
      {!deadlinePassed && schedule.availabilityDeadline && <div className="bg-amber-900/20 border border-amber-500/25 rounded-lg px-3 py-2 text-xs text-amber-200">Submit by {formatDate(schedule.availabilityDeadline)} (5 days before the period starts).</div>}
      {availabilityError && <>
        <div className="bg-rose-900/20 border border-rose-500/25 rounded-lg px-3 py-2 text-xs text-rose-200">Could not save this choice: {availabilityError}</div>
        <div role="alert" className="fixed bottom-5 left-1/2 z-50 w-[min(92vw,42rem)] -translate-x-1/2 rounded-lg border border-rose-400 bg-rose-950 px-4 py-3 text-sm font-medium text-rose-100 shadow-2xl">
          <div className="flex items-start justify-between gap-3"><span>Could not save: {availabilityError}</span><button type="button" onClick={() => setAvailabilityError('')} className="shrink-0 text-rose-200 hover:text-white" aria-label="Dismiss error">×</button></div>
        </div>
      </>}
      <div className="bg-sky-900/20 border border-sky-500/20 rounded-lg px-3 py-2 text-xs text-sky-300">
        ℹ Choose Day, Evening, or Night for each date that is not a manager-assigned rest day.
      </div>
      {(currentApproval === 'rejected' || currentApproval === 'resubmit') && (
        <div className="bg-rose-900/20 border border-rose-500/25 rounded-lg px-3 py-2 text-xs text-rose-200">
          {currentApproval === 'resubmit' ? 'Manager asked you to resubmit: ' : 'Manager rejected this submission: '}
          {currentEntry?.managerNote || 'Please review and resubmit your availability.'}
        </div>
      )}


      <div className="space-y-2">
        {dates.map((date, i) => {
          const { cycleDay, cycleNumber } = getCycleDay(i);
          const empId = currentUser!.employeeId;
          const key = `${empId}|${date}`;
          const currentStatus = getAvailStatus(empId, date);
          const isManagerOff = currentStatus === 'off';
          const isBusy = saving[key];
          const today = new Date().toISOString().split('T')[0];

          return (
            <Card key={date} className={isManagerOff ? 'opacity-60' : ''}>
              <div className="flex items-start gap-3">
                {/* Date */}
                <div className="shrink-0 text-center w-12">
                  <div className="text-xs text-navy-500 font-mono">{formatDayName(date)}</div>
                  <div className={`text-sm font-bold ${date === today ? 'text-brand-400' : 'text-navy-200'}`}>
                    {formatDate(date, 'MMM dd')}
                  </div>
                  <div className="text-[10px] text-navy-600 font-mono">C{cycleNumber}D{cycleDay}</div>
                  {isManagerOff && <div className="text-[9px] text-navy-600 mt-0.5">REST</div>}
                </div>

                {/* Status buttons */}
                <div className="flex-1">
                  {!isManagerOff && (
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {STATUS_OPTIONS.map(opt => {
                        const capacity = getShiftCapacity(date, opt.value);
                        const shiftFilled = capacity.filled && currentStatus !== opt.value;
                        return (
                          <button
                            key={opt.value}
                            disabled={isBusy || availabilityLocked || shiftFilled || (shiftCounts[opt.value] >= 6 && currentStatus !== opt.value)}
                            onClick={() => handleSetStatus(date, opt.value)}
                            className={`px-2.5 py-1 rounded text-xs border font-medium transition-all disabled:opacity-50 ${
                              currentStatus === opt.value
                                ? opt.color
                                : 'bg-navy-900 text-navy-400 border-navy-700 hover:border-navy-500 hover:text-navy-200'
                            }`}
                          >
                            <span>{opt.label}</span>
                            <span className={`ml-1 rounded px-1 py-0.5 font-mono text-[10px] ${shiftCounts[opt.value] === 6 ? 'bg-emerald-950/40 text-emerald-100' : 'bg-navy-950/40 text-navy-200'}`}>{shiftCounts[opt.value]}/6</span>
                            {shiftFilled && <span className="rounded bg-rose-950/60 px-1 py-0.5 font-mono text-[10px] text-rose-200">Filled</span>}
                          </button>
                        );
                      })}
                      {currentStatus && (
                        <button
                          type="button"
                          disabled={isBusy || availabilityLocked || periodSubmitting}
                          onClick={() => handleClearChoice(date)}
                          aria-label={`Clear shift choice for ${formatDate(date)}`}
                          className="px-2.5 py-1 rounded text-xs border border-navy-700 text-navy-400 hover:border-navy-500 hover:text-navy-200 disabled:opacity-50"
                        >
                          Clear choice
                        </button>
                      )}
                    </div>
                  )}
                  {!isManagerOff && currentStatus && shiftCounts[currentStatus] > 6 && (
                    <div className="mb-2 rounded border border-amber-500/30 bg-amber-900/20 px-2 py-1 text-[11px] text-amber-300">
                      Warning: You have selected {shiftCounts[currentStatus]} days of {currentStatus} shift, and that violates the 6-day limit.
                    </div>
                  )}
                  {/* Note input */}
                  {!isManagerOff && <input
                    type="text"
                    placeholder="Add note (optional)…"
                    value={notes[key] ?? ''}
                    onChange={e => setNotes(p => ({ ...p, [key]: e.target.value }))}
                    onBlur={() => handleNoteBlur(date)}
                    disabled={availabilityLocked || isBusy}
                    className="w-full text-xs bg-navy-900 border border-navy-700 rounded px-2 py-1 text-navy-300 placeholder:text-navy-600 focus:outline-none focus:border-navy-500"
                  />}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="border border-brand-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-navy-200">Period availability</div>
            <div className="text-xs text-navy-500 mt-0.5">
              {periodComplete ? 'All 18 working days are balanced: 6 Day, 6 Evening, 6 Night.' : 'Select every working day with exactly 6 Day, 6 Evening, and 6 Night choices before submitting.'}
              {' '}Exactly six selections are required for each shift type.
            </div>
          </div>
          <Button
            size="sm"
            loading={periodSubmitting}
            disabled={!periodComplete || availabilityLocked || Object.values(saving).some(Boolean)}
            onClick={() => handleSubmitPeriod(workDates)}
          >
            {currentRosterEmployee?.availabilitySubmittedAt ? 'Submitted for Approval' : periodSubmitted ? 'Submitted for Approval' : 'Submit Full Period'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Manager View ─────────────────────────────────────────────────────────────

function ManagerAvailabilityView({
  employees, allEmployees, dates, availability, published, canEditRestDays, schedule, periods, onSelectPeriod, onDeletePeriod, onAddEmployee, onRemoveEmployee, onReorderEmployees, onCreatePeriod, scheduleId, onToggleOff, onPublish, onApprove, onReject, onResubmit, onAvailabilityChanged
}: {
  employees: Employee[];
  allEmployees: Employee[];
  dates: string[];
  availability: Availability[];
  published: boolean;
  canEditRestDays: boolean;
  schedule: SchedulePeriod;
  periods: SchedulePeriod[];
  onSelectPeriod: (id: string) => Promise<void>;
  onDeletePeriod: (scheduleId: string) => Promise<void>;
  onAddEmployee: (employeeId: string) => Promise<void>;
  onRemoveEmployee: (employeeId: string) => Promise<void>;
  onReorderEmployees: (employeeIds: string[]) => Promise<void>;
  onCreatePeriod: (startDate: string, repeat: boolean) => Promise<void>;
  scheduleId: string;
  onToggleOff: (employeeId: string, date: string) => Promise<void>;
  onPublish: () => Promise<void>;
  onApprove: (employeeId: string) => Promise<void>;
  onAvailabilityChanged: () => Promise<void>;
  onReject: (employeeId: string, note: string) => Promise<void>;
  onResubmit: (employeeId: string, note: string) => Promise<void>;
}) {
  const [filterEmp, setFilterEmp] = useState('all');
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [approvalTarget, setApprovalTarget] = useState<string | null>(null);
  const [correction, setCorrection] = useState<AvailabilityPlan | null>(null);
  const errorMessage = (err: unknown) => err && typeof err === 'object' && 'message' in err ? String(err.message) : 'The schedule check failed. No changes were saved.';
  async function approve(employeeId: string) {
    if (approvalBusy) return;
    setApprovalBusy(true); setApprovalError(''); setApprovalTarget(employeeId);
    try { await onApprove(employeeId); setViewEmployee(null); }
    catch (err) { setApprovalError(errorMessage(err)); }
    finally { setApprovalBusy(false); }
  }
  async function findCorrection(employeeId: string | null) {
    if (approvalBusy) return;
    setViewEmployee(null); setCorrection(null); setApprovalBusy(true); setApprovalError(''); setApprovalTarget(employeeId);
    try { setCorrection(await prepareAvailabilityPlan(schedule.id, employeeId, true)); }
    catch (err) { setApprovalError(errorMessage(err)); }
    finally { setApprovalBusy(false); }
  }
  async function applyCorrection() {
    if (!correction || approvalBusy) return;
    setApprovalBusy(true); setApprovalError('');
    try { await applyAvailabilityPlan(correction); setCorrection(null); await onAvailabilityChanged(); }
    catch (err) { setCorrection(null); setApprovalError(errorMessage(err)); }
    finally { setApprovalBusy(false); }
  }
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [nextStartDate, setNextStartDate] = useState(() => { const d = new Date(schedule.endDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); });
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [periodError, setPeriodError] = useState('');
  const [repeatConfirmOpen, setRepeatConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingPeriod, setDeletingPeriod] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [rosterEmployeeId, setRosterEmployeeId] = useState('');
  const [rosterBusy, setRosterBusy] = useState(false);
  const candidates = allEmployees.filter(employee => !employees.some(member => member.id === employee.id));
  async function changeRoster(action: () => Promise<void>) { setRosterBusy(true); try { await action(); } finally { setRosterBusy(false); } }
  async function moveEmployee(index: number, direction: -1 | 1) { const next = [...employees]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; await changeRoster(() => onReorderEmployees(next.map(employee => employee.id))); }
  async function createNext(repeat: boolean) { setCreatingPeriod(true); setPeriodError(''); try { await onCreatePeriod(nextStartDate, repeat); setRepeatConfirmOpen(false); } catch (err) { setPeriodError(err instanceof Error ? err.message : 'Could not create period.'); } finally { setCreatingPeriod(false); } }
  async function removePeriod() { setDeletingPeriod(true); setDeleteError(''); try { await onDeletePeriod(schedule.id); setDeleteConfirmOpen(false); } catch (err) { setDeleteError(err instanceof Error ? err.message : 'Could not delete period.'); } finally { setDeletingPeriod(false); } }
  const isPastPeriod = schedule.endDate < new Date().toISOString().slice(0, 10);
  const managerOpenWave = Math.min(...employees.filter(employee => !employee.availabilityApprovedAt).map(employee => employee.availabilityWave ?? 1));
  const managerPairs = Array.from(new Set(employees.map(employee => employee.availabilityWave ?? 1))).sort((a, b) => a - b).map(wave => ({ wave, people: employees.filter(employee => (employee.availabilityWave ?? 1) === wave) }));
  const filtered = filterEmp === 'all' ? employees : employees.filter(e => e.id === filterEmp);

  function getStatus(empId: string, date: string): AvailabilityStatus | undefined {
    const entry = availability.find(a => a.scheduleId === schedule?.id && a.employeeId === empId && a.date === date);
    return entry?.status === 'off' || entry?.approvalStatus === 'approved' ? entry.status : undefined;
  }

  function getNote(empId: string, date: string): string {
    return availability.find(a => a.employeeId === empId && a.date === date)?.note ?? '';
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Team Availability" subtitle={`${schedule.label} · ${dates.length}-day period · ${employees.length} employees`} />
      <Card className="border border-sky-500/25"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-medium text-navy-200">Selected period: {formatDate(schedule.startDate)} to {formatDate(schedule.endDate)}</div><label className="mt-2 block text-xs text-navy-400">Browse periods<select value={schedule.id} onChange={event => onSelectPeriod(event.target.value)} className="mt-1 block w-full bg-navy-900 border border-navy-600 rounded px-2 py-1.5 text-sm text-navy-100">{periods.map(period => <option key={period.id} value={period.id}>{formatDate(period.startDate)} to {formatDate(period.endDate)}</option>)}</select></label></div>{!isPastPeriod && <Button variant="danger" size="sm" onClick={() => { setDeleteError(''); setDeleteConfirmOpen(true); }}>Delete this period</Button>}</div></Card>
      <div className="bg-amber-900/20 border border-amber-500/25 rounded-lg px-4 py-3 text-xs text-amber-200">
        First assign exactly 5 different rest days to every employee. Click any date cell to mark it as manager-assigned OFF; employees can submit shift availability only after their 5 rest days are posted.
      </div>
      <Modal isOpen={repeatConfirmOpen} onClose={() => !creatingPeriod && setRepeatConfirmOpen(false)} title="Create next period with repeated OFF cycle" footer={<><Button variant="secondary" disabled={creatingPeriod} onClick={() => setRepeatConfirmOpen(false)}>Cancel</Button><Button loading={creatingPeriod} onClick={() => createNext(true)}>Yes, create period</Button></>}><p className="text-sm text-navy-200">Create a new 23-day period beginning {nextStartDate}?</p><p className="mt-2 text-sm text-navy-400">The roster and continuous single/double OFF cycle will be carried forward. Shift availability is not copied.</p></Modal>
      <Modal isOpen={deleteConfirmOpen} onClose={() => !deletingPeriod && setDeleteConfirmOpen(false)} title="Delete this schedule period?" footer={<><Button variant="secondary" disabled={deletingPeriod} onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button><Button variant="danger" loading={deletingPeriod} onClick={removePeriod}>Yes, delete period</Button></>}><p className="text-sm text-navy-200">Delete {formatDate(schedule.startDate)} to {formatDate(schedule.endDate)}?</p><p className="mt-2 text-sm text-rose-200">This permanently removes its roster, manager OFFs, employee availability, approvals, and assignments.</p>{deleteError && <p className="mt-2 text-sm text-rose-300">{deleteError}</p>}</Modal>
      {isPastPeriod && <div className="rounded-lg border border-navy-600 bg-navy-800 px-4 py-3 text-sm text-navy-300">This period has ended and is read-only. Past schedules are retained for reference.</div>}
      {managerPairs.length > 0 && <Card className="border border-violet-500/25"><CardHeader title="Availability picking order" subtitle="Saved pairs remain fixed for this period." /><div className="space-y-2 text-sm">{managerPairs.map((entry, index) => { const completed = entry.people.every(person => Boolean(person.availabilityApprovedAt)); const picking = !completed && entry.wave === managerOpenWave; return <div key={entry.wave} className={`rounded border px-3 py-2 ${completed ? 'border-sky-500/30 bg-sky-900/20 text-sky-200' : picking ? 'border-emerald-500/40 bg-emerald-900/20 text-emerald-100' : 'border-navy-700 bg-navy-900/40 text-navy-400'}`}><strong>{index + 1}. {entry.people.map(person => person.name).join(' & ')}</strong><span className="ml-2">— {completed ? 'Picked up' : picking ? 'Picking now' : 'Waiting'}</span></div>; })}</div></Card>}
      <Card className="border border-sky-500/25"><div className="flex flex-col gap-3"><div><div className="text-sm font-medium text-navy-200">Start the next 23-day period</div><div className="text-xs text-navy-500 mt-1">Repeat copies only this period?s manager-assigned OFF positions. Custom starts blank.</div></div><div className="flex flex-wrap gap-2 items-center"><input type="date" value={nextStartDate} onChange={e => setNextStartDate(e.target.value)} className="bg-navy-900 border border-navy-600 rounded px-2 py-1.5 text-sm text-navy-100"/><Button size="sm" loading={creatingPeriod} variant="secondary" disabled={isPastPeriod || !published} onClick={() => setRepeatConfirmOpen(true)}>Create Next ? Repeat OFF Cycle</Button><Button size="sm" loading={creatingPeriod} disabled={isPastPeriod} onClick={() => createNext(false)}>Create Custom Period</Button></div>{!published && <p className="text-xs text-amber-300">Publish this period's rest days before repeating its OFF cycle.</p>}{periodError && <p className="text-xs text-rose-300">{periodError}</p>}</div></Card>
      <Card className="border border-sky-500/25">
        <div className="text-sm font-medium text-navy-200">Period roster</div>
        <p className="mt-1 text-xs text-navy-500">Add approved employees, then use the arrows to set the manager’s planning order before publishing rest days.</p>
        <div className="mt-3 flex flex-wrap gap-2"><select value={rosterEmployeeId} onChange={e => setRosterEmployeeId(e.target.value)} className="bg-navy-900 border border-navy-600 rounded px-2 py-1.5 text-sm text-navy-100"><option value="">Select approved employee</option>{candidates.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><Button size="sm" loading={rosterBusy} disabled={isPastPeriod || !rosterEmployeeId} onClick={() => changeRoster(async () => { await onAddEmployee(rosterEmployeeId); setRosterEmployeeId(''); })}>Add employee</Button></div>
        <div className="mt-3 space-y-1">{employees.map((employee, index) => <div key={employee.id} className="flex items-center gap-2 rounded bg-navy-900 px-2 py-1.5 text-xs"><span className="w-5 text-navy-500">{index + 1}</span><span className="flex-1 text-navy-200">{employee.name}</span><><button disabled={isPastPeriod || rosterBusy || index === 0} onClick={() => moveEmployee(index, -1)} className="text-brand-400 disabled:opacity-30">↑</button><button disabled={isPastPeriod || rosterBusy || index === employees.length - 1} onClick={() => moveEmployee(index, 1)} className="text-brand-400 disabled:opacity-30">↓</button><button disabled={isPastPeriod || rosterBusy} onClick={() => changeRoster(() => onRemoveEmployee(employee.id))} className="ml-2 text-rose-300">Remove</button></></div>)}</div>
      </Card>      <Card className="border border-brand-500/25">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-navy-200">{published ? 'Rest days published' : 'Rest days not published'}</div>
            <div className="text-xs text-navy-500 mt-0.5">{published ? 'Employees can now enter their 18 working-day choices.' : 'Finish all employee rows, then publish to notify employees.'}</div>
          </div>
          <Button size="sm" onClick={onPublish} disabled={isPastPeriod || employees.length === 0 || !employees.every(employee => availability.filter(a => a.scheduleId === schedule.id && a.employeeId === employee.id && a.status === 'off').length === 5)}>
            {published ? 'Republish Manager OFFs' : 'Publish Manager OFFs'}
          </Button>
        </div>
      </Card>
      <div className="space-y-2">
        {employees.map(employee => {
          const employeeEntries = availability.filter(a => a.employeeId === employee.id && a.scheduleId === scheduleId);
          const offCount = employeeEntries.filter(a => a.status === 'off').length;
          const shiftCount = employeeEntries.filter(a => a.status !== 'off').length;
          const dayCount = employeeEntries.filter(a => a.status === 'day').length;
          const eveningCount = employeeEntries.filter(a => a.status === 'evening').length;
          const nightCount = employeeEntries.filter(a => a.status === 'night').length;
          const approval = employeeEntries.find(a => a.status !== 'off')?.approvalStatus;
          const missedDeadline = Boolean(schedule.availabilityDeadline && new Date() > new Date(schedule.availabilityDeadline) && !employee.availabilitySubmittedAt);
         return (
            <div key={employee.id} className="flex items-center justify-between gap-3 bg-navy-900 rounded-lg px-3 py-2">
              <div><div className="text-sm text-navy-200">{employee.name}</div><div className="text-[11px] text-navy-500">{offCount}/5 OFF · {shiftCount}/18 shifts · D{dayCount}/6 E{eveningCount}/6 N{nightCount}/6 · {employee.availabilitySubmittedAt ? (approval ?? 'submitted') : missedDeadline ? 'missed deadline' : 'not submitted'}</div></div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setViewEmployee(employee); setRejectNote(''); }}>View</Button>
                <Button size="sm" variant="danger" disabled={!shiftCount || approval === 'approved'} onClick={() => { setViewEmployee(employee); setRejectNote(''); }}>Reject</Button>
                <Button size="sm" variant="secondary" disabled={!shiftCount || approval !== 'approved'} onClick={() => { setViewEmployee(employee); setRejectNote(''); }}>Ask to resubmit</Button>
                <Button size="sm" variant="success" disabled={approvalBusy || shiftCount !== 18 || dayCount !== 6 || eveningCount !== 6 || nightCount !== 6 || approval === 'approved'} onClick={() => approve(employee.id)}>{approval === 'approved' ? 'Approved' : 'Approve'}</Button>
              </div>
            </div>
          );
        })}
      </div>

      {USE_SUPABASE && <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-sm font-medium text-navy-200">Prevent blocked shift choices</div>
            <p className="mt-1 text-xs text-navy-400">Every approval checks that the whole team can finish. If employees are already stuck, find a correction to review and apply.</p></div>
          <Button variant="secondary" loading={approvalBusy} disabled={!published || isPastPeriod} onClick={() => findCorrection(null)}>Resolve blocked choices</Button>
        </div>
        {approvalBusy && <p role="status" className="mt-3 text-sm text-brand-300">Checking a valid arrangement for the whole team...</p>}
        {approvalError && <div role="alert" className="mt-3 space-y-2 text-sm text-rose-300"><p>{approvalError}</p>
          <Button size="sm" variant="secondary" disabled={approvalBusy} onClick={() => findCorrection(approvalTarget)}>Find a correction</Button>
        </div>}
      </Card>}
      {correction && <AvailabilityPlanReview plan={correction} busy={approvalBusy} onClose={() => setCorrection(null)} onApply={applyCorrection} />}

      {viewEmployee && (() => {
        const entries = availability.filter(a => a.employeeId === viewEmployee.id && a.scheduleId === scheduleId);
        const decision = entries.find(a => a.status !== 'off')?.approvalStatus;
        return (
          <Modal
            isOpen={!!viewEmployee}
            onClose={() => setViewEmployee(null)}
            title={`${viewEmployee.name} availability`}
            footer={
              <>
                <Button variant="ghost" size="sm" onClick={() => setViewEmployee(null)}>Close</Button>
                <Button variant="danger" size="sm" disabled={!rejectNote.trim() || decision === 'approved'} onClick={async () => { await onReject(viewEmployee.id, rejectNote.trim()); setViewEmployee(null); }}>Reject</Button>
                <Button variant="secondary" size="sm" disabled={!rejectNote.trim() || decision !== 'approved'} onClick={async () => { await onResubmit(viewEmployee.id, rejectNote.trim()); setViewEmployee(null); }}>Ask to resubmit</Button>
                <Button variant="success" size="sm" disabled={approvalBusy || decision === 'approved' || entries.filter(a => a.status !== 'off').length !== 18 || entries.filter(a => a.status === 'day').length !== 6 || entries.filter(a => a.status === 'evening').length !== 6 || entries.filter(a => a.status === 'night').length !== 6} onClick={() => approve(viewEmployee.id)}>Approve</Button>
              </>
            }
          >
            {approvalBusy && <p role="status" className="mb-3 text-sm text-brand-300">Checking the whole team's remaining choices...</p>}
            {approvalError && <div role="alert" className="mb-3 space-y-2 text-sm text-rose-300"><p>{approvalError}</p>
              {USE_SUPABASE && <Button size="sm" variant="secondary" disabled={approvalBusy} onClick={() => findCorrection(viewEmployee.id)}>Find a correction</Button>}
            </div>}
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {dates.map(date => {
                const entry = entries.find(item => item.date === date);
                return <div key={date} className="flex items-center justify-between border-b border-navy-700/50 py-1.5 text-xs"><span className="text-navy-300">{formatShortDate(date)}</span><span className="font-mono text-navy-400">{entry?.status ?? 'Not submitted'}{entry?.note ? ` · ${entry.note}` : ''}</span></div>;
              })}
            </div>
            {decision !== 'rejected' && <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} placeholder="Reason or changes needed (required)" className="mt-3 w-full min-h-20 bg-navy-900 border border-navy-700 rounded px-2 py-1.5 text-xs text-navy-200 placeholder:text-navy-600" />}
          </Modal>
        );
      })()}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-navy-500 font-mono">Filter:</span>
        <select
          value={filterEmp}
          onChange={e => setFilterEmp(e.target.value)}
          className="text-xs bg-navy-800 border border-navy-700 text-navy-300 rounded px-2 py-1 focus:outline-none"
        >
          <option value="all">All Employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {/* Table — scrollable on mobile */}
      <div className="overflow-x-auto rounded-lg border border-navy-700">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-navy-900 border-b border-navy-700">
              <th className="sticky left-0 bg-navy-900 px-3 py-2 text-left font-mono text-navy-400 uppercase text-[10px] tracking-wide whitespace-nowrap">Employee</th>
              {dates.map((date, i) => {
                const { cycleDay, cycleNumber } = getCycleDay(i);
                return (
                  <th key={date} className="px-2 py-2 text-center font-mono text-[10px] text-navy-400">
                    <div>{formatDayName(date).slice(0, 2)}</div>
                    <div>{formatDate(date, 'MMM dd')}</div>
                    <div className="text-navy-600">C{cycleNumber}D{cycleDay}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp, ri) => (
              <tr key={emp.id} className={`border-b border-navy-800/50 ${ri % 2 === 0 ? '' : 'bg-navy-900/30'}`}>
                <td className="sticky left-0 bg-navy-900 px-3 py-2 font-medium text-navy-200 whitespace-nowrap border-r border-navy-800">
                  <div>{emp.name}</div>
                  <div className="text-[9px] text-navy-600">{availability.filter(a => a.employeeId === emp.id && a.status === 'off').length}/5 OFF</div>
                </td>
                {dates.map((date) => {
                  const status = getStatus(emp.id, date);
                  const note = getNote(emp.id, date);
                  return (
                    <td key={date} className="px-1 py-1.5 text-center">
                      {status ? (
                        <button disabled={!canEditRestDays} onClick={() => onToggleOff(emp.id, date)} title={status === 'off' ? 'Remove manager-assigned rest day' : 'Replace this availability with a manager-assigned rest day'}>
                          <span className={`inline-block w-5 h-5 rounded text-[10px] flex items-center justify-center ${
                            status === 'off' ? 'bg-slate-500/30 text-slate-300' : status === 'day' ? 'bg-amber-500/20 text-amber-400' :
                            status === 'evening' ? 'bg-sky-500/20 text-sky-400' :
                            'bg-indigo-500/20 text-indigo-400'
                          }`}>
                            {status === 'off' ? 'OFF' : status === 'day' ? '☀' : status === 'evening' ? '▣' : '☾'}
                          </span>
                        </button>
                      ) : (
                        <button disabled={!canEditRestDays} onClick={() => onToggleOff(emp.id, date)} className="text-navy-600 hover:text-slate-300" title="Set manager-assigned rest day">·</button>
                      )}
                      {status === 'off' && <button disabled={!canEditRestDays} onClick={() => onToggleOff(emp.id, date)} className="block mx-auto text-[9px] text-navy-600 hover:text-navy-300" title="Remove rest day">undo</button>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[11px] text-navy-500 font-mono">
        <span className="flex items-center gap-1"><span className="text-amber-400">☀</span> Day</span>
        <span className="flex items-center gap-1"><span className="text-sky-400">▣</span> Evening</span>
        <span className="flex items-center gap-1"><span className="text-indigo-400">☾</span> Night</span>
        <span className="flex items-center gap-1"><span className="text-slate-400">·</span> Manager-assigned rest day</span>
        <span className="flex items-center gap-1"><span className="text-navy-700">·</span> Not submitted</span>
      </div>
    </div>
  );
}function CreatePeriodView({ onCreate }: { onCreate: (startDate: string) => Promise<void> }) { const [date,setDate]=useState(new Date(Date.now() + 5 * 86400000).toISOString().slice(0,10)); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); async function create(){setBusy(true);setError('');try{await onCreate(date)}catch(e){setError(e instanceof Error?e.message:'Could not create period.')}finally{setBusy(false)}} return <div className="space-y-5"><PageHeader title="Create Schedule Period" subtitle="Start the next 23-day availability cycle"/><Card><p className="text-sm text-navy-300 mb-4">Select the first date. The period will run for 23 days and employee availability will lock five days before the start date.</p><input type="date" min={new Date(Date.now() + 5 * 86400000).toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)} className="bg-navy-900 border border-navy-600 rounded px-3 py-2 text-navy-100"/>{error&&<p className="text-xs text-rose-300 mt-3">{error}</p>}<div className="flex flex-wrap gap-3 mt-5"><Button loading={busy} onClick={()=>create()}>Create Custom Period</Button></div><p className="text-xs text-navy-500 mt-3">The first period starts blank. Once it exists, the manager can create the following period and repeat its OFF cycle.</p></Card></div>;}
