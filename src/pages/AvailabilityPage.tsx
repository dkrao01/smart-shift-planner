import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { Badge, availabilityBadge } from '../components/common/Badge';
import { LoadingSpinner, EmptyState, PageHeader } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import {
  getEmployees, getAssignments, getActiveSchedule,
  getAvailability, setAvailability, removeAvailability, publishRestDays, approveEmployeeAvailability, rejectEmployeeAvailability, requestAvailabilityResubmission
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
  const [schedule, setSchedule] = useState<SchedulePeriod | null>(null);
  const [availability, setAvailabilityState] = useState<Availability[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [periodSubmitting, setPeriodSubmitting] = useState(false);
  const [periodSubmitted, setPeriodSubmitted] = useState(false);

  const isManager = currentUser?.role === 'manager';

  async function load() {
    const [emps, avail, sched] = await Promise.all([
      getEmployees(), getAvailability(), getActiveSchedule()
    ]);
    setEmployees(emps);
    setAvailabilityState(avail);
    setSchedule(sched);
    // Pre-fill notes
    const n: Record<string, string> = {};
    avail.forEach(a => { n[`${a.employeeId}|${a.date}`] = a.note ?? ''; });
    setNotes(n);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function getAvailStatus(empId: string, date: string): AvailabilityStatus | undefined {
    return availability.find(a => a.employeeId === empId && a.date === date)?.status;
  }

  function getShiftCounts(empId: string): Record<'day' | 'evening' | 'night', number> {
    const counts = { day: 0, evening: 0, night: 0 };
    availability.filter(a => a.employeeId === empId).forEach(a => {
      if (a.status === 'day' || a.status === 'evening' || a.status === 'night') counts[a.status] += 1;
    });
    return counts;
  }

  async function handleSetStatus(date: string, status: AvailabilityStatus) {
    if (!schedule || !currentUser) return;
    const empId = currentUser.employeeId;
    const key = `${empId}|${date}`;
    setSaving(p => ({ ...p, [key]: true }));
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
    setSaving(p => ({ ...p, [key]: false }));
  }

  async function handleNoteBlur(date: string) {
    if (!schedule || !currentUser) return;
    const empId = currentUser.employeeId;
    const key = `${empId}|${date}`;
    const existing = availability.find(a => a.employeeId === empId && a.date === date);
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
    await Promise.all(entries.map(entry => setAvailability({
      ...entry!,
      note: notes[`${empId}|${entry!.date}`] ?? entry!.note ?? '',
      submittedAt: new Date().toISOString(),
      approvalStatus: 'pending',
    })));
    await load();
    setPeriodSubmitting(false);
    setPeriodSubmitted(true);
  }

  if (loading) return <LoadingSpinner label="Loading availability…" />;
  if (!schedule) return <EmptyState icon="✓" title="No active schedule" description="No schedule period found." />;

  const dates = buildPeriodRange(schedule.startDate);

  async function handleManagerOff(employeeId: string, date: string) {
    if (!schedule) return;
    const existing = availability.find(a => a.employeeId === employeeId && a.date === date);
    const offCount = availability.filter(a => a.employeeId === employeeId && a.status === 'off').length;
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
      availability.filter(a => a.employeeId === employee.id && a.status === 'off').length === 5
    );
    if (!allComplete) return;
    await publishRestDays(schedule.id);
    await load();
  }

  if (isManager) {
    return <ManagerAvailabilityView employees={employees} dates={dates} availability={availability} published={Boolean(schedule.restDaysPublished)} scheduleId={schedule.id} onToggleOff={handleManagerOff} onPublish={handlePublishRestDays} onApprove={async employeeId => { await approveEmployeeAvailability(employeeId, schedule.id); await load(); }} onReject={async (employeeId, note) => { await rejectEmployeeAvailability(employeeId, schedule.id, note); await load(); }} onResubmit={async (employeeId, note) => { await requestAvailabilityResubmission(employeeId, schedule.id, note); await load(); }} />;
  }

  const managerOffDates = availability.filter(a => a.employeeId === currentUser!.employeeId && a.status === 'off').map(a => a.date);
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
  const periodComplete = workDates.every(date => Boolean(getAvailStatus(currentUser!.employeeId, date)));
  const shiftCounts = getShiftCounts(currentUser!.employeeId);
  const currentEntry = availability.find(a => a.employeeId === currentUser!.employeeId && a.status !== 'off');
  const currentApproval = currentEntry?.approvalStatus;
  const availabilityLocked = currentApproval === 'approved';

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Availability"
        subtitle={`Schedule: ${schedule.label}`}
      />
      <div className="bg-sky-900/20 border border-sky-500/20 rounded-lg px-3 py-2 text-xs text-sky-300">
        ℹ Choose Day, Evening, or Night for each date that is not a manager-assigned rest day.
      </div>
      {(currentApproval === 'rejected' || currentApproval === 'resubmit') && (
        <div className="bg-rose-900/20 border border-rose-500/25 rounded-lg px-3 py-2 text-xs text-rose-200">
          {currentApproval === 'resubmit' ? 'Manager asked you to resubmit: ' : 'Manager rejected this submission: '}
          {currentEntry?.managerNote || 'Please review and resubmit your availability.'}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs font-mono">
        {(['day', 'evening', 'night'] as const).map(type => (
          <div key={type} className={`rounded border px-2 py-1.5 ${shiftCounts[type] === 6 ? 'border-emerald-500/40 text-emerald-300' : shiftCounts[type] > 6 ? 'border-rose-500/40 text-rose-300' : 'border-navy-700 text-navy-400'}`}>
            {type}: {shiftCounts[type]}/6
          </div>
        ))}
      </div>

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
                    {formatShortDate(date).split(' ')[0]}
                  </div>
                  <div className="text-[10px] text-navy-600 font-mono">C{cycleNumber}D{cycleDay}</div>
                  {isManagerOff && <div className="text-[9px] text-navy-600 mt-0.5">REST</div>}
                </div>

                {/* Status buttons */}
                <div className="flex-1">
                  {!isManagerOff && (
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {STATUS_OPTIONS.map(opt => {
                        return (
                          <button
                            key={opt.value}
                            disabled={isBusy || availabilityLocked}
                            onClick={() => handleSetStatus(date, opt.value)}
                            className={`px-2.5 py-1 rounded text-xs border font-medium transition-all disabled:opacity-50 ${
                              currentStatus === opt.value
                                ? opt.color
                                : 'bg-navy-900 text-navy-400 border-navy-700 hover:border-navy-500 hover:text-navy-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
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
                    disabled={availabilityLocked}
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
              {periodComplete ? 'All 18 working days have a selection.' : 'Select a shift for every working day before submitting.'}
              {' '}{(shiftCounts.day > 6 || shiftCounts.evening > 6 || shiftCounts.night > 6) ? 'A shift preference is above the usual 6-day guideline; your manager will review it.' : 'The usual guideline is up to 6 selections per shift type.'}
            </div>
          </div>
          <Button
            size="sm"
            loading={periodSubmitting}
            disabled={!periodComplete || availabilityLocked}
            onClick={() => handleSubmitPeriod(dates)}
          >
            {periodSubmitted ? 'Resubmit for Approval' : 'Submit Full Period'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Manager View ─────────────────────────────────────────────────────────────

function ManagerAvailabilityView({
  employees, dates, availability, published, scheduleId, onToggleOff, onPublish, onApprove, onReject, onResubmit
}: {
  employees: Employee[];
  dates: string[];
  availability: Availability[];
  published: boolean;
  scheduleId: string;
  onToggleOff: (employeeId: string, date: string) => Promise<void>;
  onPublish: () => Promise<void>;
  onApprove: (employeeId: string) => Promise<void>;
  onReject: (employeeId: string, note: string) => Promise<void>;
  onResubmit: (employeeId: string, note: string) => Promise<void>;
}) {
  const [filterEmp, setFilterEmp] = useState('all');
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const filtered = filterEmp === 'all' ? employees : employees.filter(e => e.id === filterEmp);

  function getStatus(empId: string, date: string): AvailabilityStatus | undefined {
    return availability.find(a => a.employeeId === empId && a.date === date)?.status;
  }

  function getNote(empId: string, date: string): string {
    return availability.find(a => a.employeeId === empId && a.date === date)?.note ?? '';
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Team Availability" subtitle={`${dates.length}-day period · ${employees.length} employees`} />
      <div className="bg-amber-900/20 border border-amber-500/25 rounded-lg px-4 py-3 text-xs text-amber-200">
        First assign exactly 5 different rest days to every employee. Click any date cell to mark it as manager-assigned OFF; employees can submit shift availability only after their 5 rest days are posted.
      </div>
      <Card className="border border-brand-500/25">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-navy-200">{published ? 'Rest days published' : 'Rest days not published'}</div>
            <div className="text-xs text-navy-500 mt-0.5">{published ? 'Employees can now enter their 18 working-day choices.' : 'Finish all employee rows, then publish to notify employees.'}</div>
          </div>
          <Button size="sm" onClick={onPublish} disabled={published || !employees.every(employee => availability.filter(a => a.employeeId === employee.id && a.status === 'off').length === 5)}>
            {published ? 'Published' : 'Publish Rest Days'}
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
          return (
            <div key={employee.id} className="flex items-center justify-between gap-3 bg-navy-900 rounded-lg px-3 py-2">
              <div><div className="text-sm text-navy-200">{employee.name}</div><div className="text-[11px] text-navy-500">{offCount}/5 OFF · {shiftCount}/18 shifts · D{dayCount}/6 E{eveningCount}/6 N{nightCount}/6 · {approval ?? 'not submitted'}</div></div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setViewEmployee(employee); setRejectNote(''); }}>View</Button>
                <Button size="sm" variant="danger" disabled={!shiftCount || approval === 'approved'} onClick={() => { setViewEmployee(employee); setRejectNote(''); }}>Reject</Button>
                <Button size="sm" variant="secondary" disabled={!shiftCount || approval !== 'approved'} onClick={() => { setViewEmployee(employee); setRejectNote(''); }}>Ask to resubmit</Button>
                <Button size="sm" variant="success" disabled={shiftCount !== 18 || approval === 'approved'} onClick={() => onApprove(employee.id)}>{approval === 'approved' ? 'Approved' : 'Approve'}</Button>
              </div>
            </div>
          );
        })}
      </div>

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
                <Button variant="success" size="sm" disabled={decision === 'approved' || entries.filter(a => a.status !== 'off').length !== 18} onClick={async () => { await onApprove(viewEmployee.id); setViewEmployee(null); }}>Approve</Button>
              </>
            }
          >
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
                    <div>{formatShortDate(date).split(' ')[0]}</div>
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
                        <button onClick={() => onToggleOff(emp.id, date)} title={status === 'off' ? 'Remove manager-assigned rest day' : 'Replace this availability with a manager-assigned rest day'}>
                          <span className={`inline-block w-5 h-5 rounded text-[10px] flex items-center justify-center ${
                            status === 'off' ? 'bg-slate-500/30 text-slate-300' : status === 'day' ? 'bg-amber-500/20 text-amber-400' :
                            status === 'evening' ? 'bg-sky-500/20 text-sky-400' :
                            'bg-indigo-500/20 text-indigo-400'
                          }`}>
                            {status === 'off' ? 'OFF' : status === 'day' ? '☀' : status === 'evening' ? '▣' : '☾'}
                          </span>
                        </button>
                      ) : (
                        <button onClick={() => onToggleOff(emp.id, date)} className="text-navy-600 hover:text-slate-300" title="Set manager-assigned rest day">·</button>
                      )}
                      {status === 'off' && <button onClick={() => onToggleOff(emp.id, date)} className="block mx-auto text-[9px] text-navy-600 hover:text-navy-300" title="Remove rest day">undo</button>}
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
}
