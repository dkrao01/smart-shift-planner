import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardHeader } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { LoadingSpinner, EmptyState, WarningBanner, PageHeader } from '../components/common/LoadingSpinner';
import { Button } from '../components/common/Button';
import { Modal, FormField, Select } from '../components/common/Modal';
import {
  getEmployees, getAssignments, getActiveSchedule,
  addAssignment, removeAssignment, getAvailability
} from '../services/dataService';
import { getScheduleEmployeeOptions, validateShiftCoverage } from '../utils/scheduleUtils';
import { formatDate, formatDayName, formatShortDate, buildPeriodRange, getCycleDay } from '../utils/dateUtils';
import type { Availability, Employee, ShiftAssignment, SchedulePeriod, ShiftType } from '../types';

const SHIFT_TYPES: ShiftType[] = ['day', 'evening', 'night'];
const SHIFT_ICONS: Record<ShiftType, string> = { day: '☀', evening: '🌆', night: '🌙' };
const SHIFT_TIMES: Record<ShiftType, string> = {
  day: '06:00–14:00', evening: '14:00–22:00', night: '22:00–06:00'
};

export default function SchedulePage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [schedule, setSchedule] = useState<SchedulePeriod | null>(null);
  const [editModal, setEditModal] = useState<{ date: string; shiftType: ShiftType } | null>(null);
  const [addEmpId, setAddEmpId] = useState('');
  const [addHours, setAddHours] = useState<8 | 12 | 16>(8);
  const [saving, setSaving] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<1 | 2 | 3>(1);

  const isManager = currentUser?.role === 'manager';

  async function load() {
    const [emps, asgn, sched, avail] = await Promise.all([
      getEmployees(), getAssignments(), getActiveSchedule(), getAvailability()
    ]);
    setEmployees(emps); setAssignments(asgn); setSchedule(sched); setAvailability(avail);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <LoadingSpinner label="Loading schedule…" />;
  if (!schedule) return <EmptyState icon="▦" title="No active schedule" description="Manager has not created a schedule yet." />;

  const dates = buildPeriodRange(schedule.startDate);
  const cycleDates = dates.filter((_, i) => {
    const { cycleNumber } = getCycleDay(i);
    return cycleNumber === selectedCycle;
  });

  const coverageWarnings = validateShiftCoverage(assignments, schedule.startDate);
  const warningKeys = new Set(coverageWarnings.map(w => `${w.date}|${w.shiftType}`));
  const scheduleEmployeeOptions = editModal
    ? getScheduleEmployeeOptions(
      assignments,
      employees,
      editModal.date,
      editModal.shiftType,
      new Set(availability.filter(a => a.date === editModal.date && a.status === 'off').map(a => a.employeeId))
    )
    : [];
  const eligibleAddEmployees = scheduleEmployeeOptions.filter(option => option.eligible);

  function getShiftAssignments(date: string, type: ShiftType) {
    return assignments.filter(a => a.date === date && a.shiftType === type);
  }

  function isOvertimeAssignment(assignment: ShiftAssignment) {
    const shiftOrder: ShiftType[] = ['day', 'evening', 'night'];
    return assignments
      .filter(a => a.date === assignment.date && a.employeeId === assignment.employeeId)
      .sort((a, b) => shiftOrder.indexOf(a.shiftType) - shiftOrder.indexOf(b.shiftType))
      .findIndex(a => a.id === assignment.id) > 0;
  }

  function openEditModal(date: string, shiftType: ShiftType) {
    if (!isManager) return;
    setEditModal({ date, shiftType });
    setAddEmpId('');
    setAddHours(8);
  }

  async function handleAddEmployee() {
    if (!editModal || !addEmpId || !schedule) return;
    setSaving(true);
    await addAssignment({
      scheduleId: schedule.id,
      date: editModal.date,
      shiftType: editModal.shiftType,
      employeeId: addEmpId,
      hours: addHours,
      status: 'scheduled',
    });
    await load();
    setSaving(false);
    setEditModal(null);
  }

  async function handleRemove(id: string) {
    await removeAssignment(id);
    await load();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="23-Day Schedule"
        subtitle={schedule.label}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedCycle(1)}
              className={`px-3 py-1.5 text-xs rounded font-mono border transition-colors ${selectedCycle === 1 ? 'bg-brand-500 text-white border-brand-500' : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-500'}`}
            >Cycle 1</button>
            <button
              onClick={() => setSelectedCycle(2)}
              className={`px-3 py-1.5 text-xs rounded font-mono border transition-colors ${selectedCycle === 2 ? 'bg-brand-500 text-white border-brand-500' : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-500'}`}
            >Cycle 2</button>
            <button
              onClick={() => setSelectedCycle(3)}
              className={`px-3 py-1.5 text-xs rounded font-mono border transition-colors ${selectedCycle === 3 ? 'bg-brand-500 text-white border-brand-500' : 'bg-navy-800 text-navy-400 border-navy-700 hover:border-navy-500'}`}
            >Cycle 3</button>
          </div>
        }
      />

      {/* Warnings */}
      {coverageWarnings.length > 0 && (
        <div className="space-y-1.5">
          {coverageWarnings.slice(0, 3).map((w, i) => (
            <WarningBanner key={i} message={w.message} type="error" />
          ))}
          {coverageWarnings.length > 3 && (
            <p className="text-xs text-navy-500 font-mono">{coverageWarnings.length - 3} more warnings…</p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-navy-500 font-mono">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Day 06–14</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500 inline-block" />Eve 14–22</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />Night 22–06</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />Shortage</span>
      </div>

      {/* Schedule grid */}
      <div className="space-y-3">
        {cycleDates.map((date, idx) => {
          const offset = dates.indexOf(date);
          const { cycleDay, isWorkDay } = getCycleDay(offset);
          const today = new Date().toISOString().split('T')[0];
          const isToday = date === today;

          return (
            <Card key={date} className={isToday ? 'border border-brand-500/40' : ''}>
              {/* Date header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${isToday ? 'bg-brand-500 text-white' : 'bg-navy-900 text-navy-300'}`}>
                    {formatDayName(date).slice(0, 1)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-navy-100">{formatShortDate(date)}</div>
                    <div className="text-[10px] text-navy-500 font-mono">Cycle {selectedCycle} · Day {cycleDay}</div>
                  </div>
                </div>
                {isToday && <Badge variant="approved" size="xs">TODAY</Badge>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {SHIFT_TYPES.map(type => {
                    const list = getShiftAssignments(date, type);
                    const key = `${date}|${type}`;
                    const hasShortage = warningKeys.has(key);

                    return (
                      <div
                        key={type}
                        className={`rounded-lg p-2.5 border cursor-pointer transition-colors ${
                          hasShortage
                            ? 'bg-rose-950/30 border-rose-500/30 hover:border-rose-500/50'
                            : isManager
                            ? 'bg-navy-900 border-navy-700 hover:border-navy-500'
                            : 'bg-navy-900 border-navy-700'
                        }`}
                        onClick={() => isManager && openEditModal(date, type)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{SHIFT_ICONS[type]}</span>
                            <span className="text-xs font-medium text-navy-300 font-mono">
                              {type.charAt(0).toUpperCase() + type.slice(1)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {hasShortage && <Badge variant="shortage" size="xs">!</Badge>}
                            <span className="text-[10px] text-navy-600 font-mono">{SHIFT_TIMES[type]}</span>
                          </div>
                        </div>

                        {list.length === 0 ? (
                          <p className="text-[11px] text-navy-600 italic">
                            {isManager ? '+ Assign employee' : 'No assignments'}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {list.map(a => {
                              const emp = employees.find(e => e.id === a.employeeId);
                              const overtime = isOvertimeAssignment(a);
                              return (
                                <div key={a.id} className="flex items-center justify-between">
                                  <span className="text-xs text-navy-200">
                                    {emp?.name ?? a.employeeId}
                                    {overtime && <span className="ml-1.5 text-[10px] font-semibold text-amber-300">(Overtime shift)</span>}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] font-mono text-navy-500">{a.hours}h</span>
                                    {isManager && (
                                      <button
                                        onClick={e => { e.stopPropagation(); handleRemove(a.id); }}
                                        className="text-rose-500/50 hover:text-rose-400 text-xs leading-none transition-colors"
                                        title="Remove"
                                      >×</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Edit Modal */}
      {isManager && editModal && (
        <Modal
          isOpen={!!editModal}
          onClose={() => setEditModal(null)}
          title={`Assign to ${editModal.shiftType.charAt(0).toUpperCase() + editModal.shiftType.slice(1)} Shift — ${formatDate(editModal.date)}`}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setEditModal(null)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={handleAddEmployee} disabled={!addEmpId}>
                Add Employee
              </Button>
            </>
          }
        >
          {/* Current assignments */}
          <div className="mb-4">
            <p className="text-xs font-mono text-navy-400 mb-2 uppercase tracking-wide">Currently Assigned</p>
            {getShiftAssignments(editModal.date, editModal.shiftType).length === 0 ? (
              <p className="text-xs text-navy-600 italic">No one assigned yet</p>
            ) : (
              <div className="space-y-1.5">
                {getShiftAssignments(editModal.date, editModal.shiftType).map(a => {
                  const emp = employees.find(e => e.id === a.employeeId);
                  const overtime = isOvertimeAssignment(a);
                  return (
                    <div key={a.id} className="flex items-center justify-between bg-navy-900 rounded p-2">
                      <span className="text-sm text-navy-200">
                        {emp?.name}
                        {overtime && <span className="ml-1.5 text-[10px] font-semibold text-amber-300">(Overtime shift)</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-navy-500">{a.hours}h</span>
                        <button onClick={() => handleRemove(a.id)} className="text-xs text-rose-400 hover:text-rose-300">Remove</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <FormField label="Add Employee">
            <Select value={addEmpId} onChange={e => setAddEmpId(e.target.value)}>
              <option value="">Select employee…</option>
              {scheduleEmployeeOptions.map(option => (
                <option key={option.employee.id} value={option.employee.id} disabled={!option.eligible}>
                  {option.employee.name} — {option.reason === 'off'
                    ? `WARNING: manager assigned OFF${option.currentShift ? `, also on ${option.currentShift} shift` : ''}`
                    : option.reason === 'assigned'
                    ? `already assigned today to ${option.currentShift} shift`
                    : 'not assigned any shift today'}
                </option>
              ))}
            </Select>
            {eligibleAddEmployees.length === 0 && (
              <p className="mt-1.5 text-[11px] text-amber-300">No eligible same-day employees are available for this shift.</p>
            )}
            {scheduleEmployeeOptions.length > 0 && (
              <p className="mt-1.5 text-[11px] text-amber-300">Warnings are informational. You can still select an OFF employee or someone already assigned to another shift if the manager decides it is necessary.</p>
            )}
            {addEmpId && (() => {
              const selectedOption = scheduleEmployeeOptions.find(option => option.employee.id === addEmpId);
              if (!selectedOption) return null;
              return (
                <p className="mt-1.5 rounded border border-amber-500/30 bg-amber-900/20 px-2 py-1 text-[11px] text-amber-300">
                  {selectedOption.reason === 'off'
                    ? `Warning: manager assigned ${selectedOption.employee.name} OFF on this day.`
                    : selectedOption.reason === 'assigned'
                    ? `Info: ${selectedOption.employee.name} is already assigned to the ${selectedOption.currentShift} shift today.`
                    : `Info: ${selectedOption.employee.name} is not assigned to any shift today.`}
                </p>
              );
            })()}
          </FormField>

          <FormField label="Shift Duration">
            <Select value={addHours} onChange={e => setAddHours(Number(e.target.value) as 8 | 12 | 16)}>
              <option value={8}>8 hours</option>
              <option value={12}>12 hours</option>
              <option value={16}>16 hours</option>
            </Select>
          </FormField>
        </Modal>
      )}
    </div>
  );
}
