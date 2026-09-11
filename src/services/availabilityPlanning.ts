import type { FeasibilityInput, FeasibilityResult, PlannedChoice } from '../utils/availabilitySolver';
import { USE_SUPABASE, getSupabase } from '../lib/supabase';
import { buildPeriodRange } from '../utils/dateUtils';

export interface AvailabilitySnapshot {
  schedule: { id: string; start_date: string; end_date: string; rest_days_published: boolean };
  roster: { employee_id: string; availability_approved_at: string | null }[];
  employees: { id: string; name: string }[];
  availability: { id: string; employee_id: string; date: string; status: string; approval_status: string }[];
  assignments: { id: string; employee_id: string; date: string; shift_type: string }[];
}
export interface AvailabilityPlan {
  snapshot: AvailabilitySnapshot;
  employeeId: string | null;
  choices: PlannedChoice[];
  changes: { employeeId: string; name: string; date: string; before: string; after: string; approved: boolean }[];
  allowChanges: boolean;
}

export function planningInput(snapshot: AvailabilitySnapshot, employeeId: string | null, allowChanges: boolean): FeasibilityInput {
  const approved = new Set(snapshot.roster.filter(m => m.availability_approved_at).map(m => m.employee_id));
  snapshot.availability.filter(a => a.status !== 'off' && a.approval_status === 'approved').forEach(a => approved.add(a.employee_id));
  snapshot.assignments.forEach(a => approved.add(a.employee_id));
  const preferences = new Map<string, PlannedChoice>();
  snapshot.availability.filter(a => a.status !== 'off').forEach(a => preferences.set(`${a.employee_id}|${a.date}`, {
    employeeId: a.employee_id, date: a.date, status: a.status as PlannedChoice['status'],
  }));
  // Published assignments take precedence over potentially stale availability.
  snapshot.assignments.forEach(a => preferences.set(`${a.employee_id}|${a.date}`, {
    employeeId: a.employee_id, date: a.date, status: a.shift_type as PlannedChoice['status'],
  }));
  const fixed = allowChanges ? [] : [...preferences.values()].filter(c => c.employeeId === employeeId || approved.has(c.employeeId));
  return {
    dates: buildPeriodRange(snapshot.schedule.start_date), employees: snapshot.employees,
    restDays: snapshot.availability.filter(a => a.status === 'off').map(a => ({ employeeId: a.employee_id, date: a.date })),
    fixed, preferences: [...preferences.values()],
  };
}

export async function prepareAvailabilityPlan(scheduleId: string, employeeId: string | null, allowChanges = false): Promise<AvailabilityPlan> {
  if (!USE_SUPABASE) throw new Error('Automatic team planning requires Supabase.');
  const { data, error } = await getSupabase().rpc('availability_planning_snapshot', { p_schedule_id: scheduleId });
  if (error) throw error;
  const snapshot = data as AvailabilitySnapshot;
  if (!snapshot.schedule.rest_days_published) throw new Error('Publish the manager-assigned rest days first.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const today = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
  if (snapshot.schedule.start_date <= today) throw new Error('Automatic planning is only available before the period starts.');
  if (employeeId && snapshot.availability.filter(a => a.employee_id === employeeId && a.status !== 'off').length !== 18) {
    throw new Error('The employee must complete all 18 working-day choices before approval.');
  }
  const input = planningInput(snapshot, employeeId, allowChanges);
  // First try changing only the employee being approved. Earlier approvals
  // are released for a correction only when that attempt proves impossible.
  let result: FeasibilityResult;
  if (allowChanges) {
    const keepApproved = planningInput(snapshot, employeeId, false);
    if (employeeId) keepApproved.fixed = keepApproved.fixed.filter(c => c.employeeId !== employeeId);
    result = await runAvailabilitySolver(keepApproved);
    if (result.status === 'infeasible') result = await runAvailabilitySolver(input);
  } else result = await runAvailabilitySolver(input);
  if (result.status !== 'feasible') throw new Error(result.reason);
  const writeIds = new Set(snapshot.roster.filter(m => m.availability_approved_at).map(m => m.employee_id));
  snapshot.assignments.forEach(a => writeIds.add(a.employee_id));
  snapshot.availability.filter(a => a.status !== 'off' && a.approval_status === 'approved').forEach(a => writeIds.add(a.employee_id));
  const approvedIds = new Set(writeIds);
  if (employeeId) writeIds.add(employeeId);
  const changes = result.choices.filter(c => writeIds.has(c.employeeId)).flatMap(c => {
    const before = input.preferences.find(p => p.employeeId === c.employeeId && p.date === c.date)?.status ?? 'Unselected';
    return before === c.status ? [] : [{ employeeId: c.employeeId,
      name: snapshot.employees.find(e => e.id === c.employeeId)?.name ?? c.employeeId,
      date: c.date, before, after: c.status, approved: approvedIds.has(c.employeeId) }];
  });
  return { snapshot, employeeId, choices: result.choices, changes, allowChanges };
}

export async function applyAvailabilityPlan(plan: AvailabilityPlan): Promise<void> {
  const { error } = await getSupabase().rpc('approve_feasible_availability', {
    p_schedule_id: plan.snapshot.schedule.id,
    p_employee_id: plan.employeeId,
    p_expected_snapshot: plan.snapshot,
    p_completion: plan.choices,
    p_allow_changes: plan.allowChanges,
  });
  if (error) throw error;
}

export function runAvailabilitySolver(input: FeasibilityInput): Promise<FeasibilityResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/availabilitySolver.worker.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('The schedule check timed out. No approval was saved.'));
    }, 12000);
    worker.onmessage = (event: MessageEvent<FeasibilityResult>) => {
      window.clearTimeout(timer); worker.terminate(); resolve(event.data);
    };
    worker.onerror = () => {
      window.clearTimeout(timer); worker.terminate(); reject(new Error('The schedule check could not run. Please reload and try again.'));
    };
    worker.postMessage(input);
  });
}
