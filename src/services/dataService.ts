/**
 * dataService.ts
 *
 * Unified data access layer.
 * In DEMO MODE  → uses in-memory state seeded from mockData.ts
 * In FIREBASE MODE → reads/writes Firestore
 *
 * Components call this service; they don't touch Firestore directly.
 */

import { IS_DEMO_MODE } from '../lib/firebase';
import { hasNightToDayConflict } from '../utils/scheduleUtils';
import { USE_SUPABASE, getSupabase } from '../lib/supabase';
import { prepareAvailabilityPlan, applyAvailabilityPlan } from './availabilityPlanning';
import type {
  Employee, SchedulePeriod, ShiftAssignment,
  Availability, SwapRequest, OpenShiftRequest, OpenShiftPickupRequest, RequestStatus
} from '../types';
import {
  MOCK_EMPLOYEES, MOCK_SCHEDULE, MOCK_ASSIGNMENTS,
  MOCK_AVAILABILITY, MOCK_SWAP_REQUESTS, MOCK_OPEN_SHIFTS, MOCK_OPEN_SHIFT_PICKUP_REQUESTS
} from '../data/mockData';

const IS_LOCAL_DEMO_MODE = IS_DEMO_MODE && !USE_SUPABASE;

// ─── In-Memory Store (Demo Mode) ──────────────────────────────────────────────

let _employees: Employee[] = [...MOCK_EMPLOYEES];
const DEMO_STORAGE_KEY = 'smart-shift-planner-demo-v3';

function readDemoStore() {
  if (!IS_LOCAL_DEMO_MODE || typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) ?? 'null') as {
      schedule?: SchedulePeriod;
      availability?: Availability[];
      assignments?: ShiftAssignment[];
      swapRequests?: SwapRequest[];
      openShifts?: OpenShiftRequest[];
      openShiftPickupRequests?: OpenShiftPickupRequest[];
    } | null;
  } catch {
    return null;
  }
}

function persistDemoStore() {
  if (!IS_LOCAL_DEMO_MODE || typeof localStorage === 'undefined') return;
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({
    schedule: _schedule,
    availability: _availability,
    assignments: _assignments,
    swapRequests: _swapRequests,
    openShifts: _openShifts,
    openShiftPickupRequests: _openShiftPickupRequests,
  }));
}

const savedDemoStore = readDemoStore();
let _schedule: SchedulePeriod = savedDemoStore?.schedule
  ? { ...MOCK_SCHEDULE, ...savedDemoStore.schedule }
  : { ...MOCK_SCHEDULE };
let _assignments: ShiftAssignment[] = savedDemoStore?.assignments ?? [...MOCK_ASSIGNMENTS];
let _availability: Availability[] = savedDemoStore?.availability ?? [...MOCK_AVAILABILITY];
let _swapRequests: SwapRequest[] = savedDemoStore?.swapRequests ?? [...MOCK_SWAP_REQUESTS];
let _openShifts: OpenShiftRequest[] = savedDemoStore?.openShifts ?? [...MOCK_OPEN_SHIFTS];
let _openShiftPickupRequests: OpenShiftPickupRequest[] = savedDemoStore?.openShiftPickupRequests ?? [...MOCK_OPEN_SHIFT_PICKUP_REQUESTS];

/**
 * IDs are persisted to Supabase, so they must remain unique across browser
 * sessions and devices. A module-level counter restarted on every refresh,
 * causing duplicate-primary-key errors after an ID had already been saved.
 */
function newId(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

type SupabaseRow = Record<string, any>;

function employeeFromRow(row: SupabaseRow): Employee {
  return { id: row.id, name: row.name, email: row.email, uid: row.uid ?? undefined, active: row.active, joinDate: row.join_date ?? undefined, availabilityPairIndex: row.availability_pair_index ?? undefined };
}

function displayDateKey(value: string): string { const [year, month, day] = value.slice(0, 10).split('-'); return day + '-' + month + '-' + year; }

function scheduleFromRow(row: SupabaseRow): SchedulePeriod {
  return { id: row.id, startDate: row.start_date, endDate: row.end_date, label: displayDateKey(row.start_date) + ' to ' + displayDateKey(row.end_date), isActive: row.is_active, createdAt: row.created_at, createdBy: row.created_by ?? '', restDaysPublished: row.rest_days_published, availabilityDeadline: row.availability_deadline ?? undefined, sourceScheduleId: row.source_schedule_id ?? undefined, availabilityPriority: row.availability_priority ?? 0 };
}

function assignmentFromRow(row: SupabaseRow): ShiftAssignment {
  return { id: row.id, scheduleId: row.schedule_id, date: row.date, shiftType: row.shift_type, employeeId: row.employee_id, hours: Number(row.hours), status: row.status, notes: row.notes ?? undefined };
}

function availabilityFromRow(row: SupabaseRow): Availability {
  return { id: row.id, employeeId: row.employee_id, scheduleId: row.schedule_id, date: row.date, status: row.status, note: row.note ?? undefined, submittedAt: row.submitted_at, approvalStatus: row.approval_status, managerNote: row.manager_note ?? undefined };
}

function swapFromRow(row: SupabaseRow): SwapRequest {
  return { id: row.id, requesterId: row.requester_id, targetId: row.target_id, requesterShiftId: row.requester_shift_id, targetShiftId: row.target_shift_id, reason: row.reason, status: row.status, validationWarnings: row.validation_warnings ?? [], createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined, resolvedBy: row.resolved_by ?? undefined, managerNote: row.manager_note ?? undefined };
}

function openShiftFromRow(row: SupabaseRow): OpenShiftRequest {
  return { id: row.id, originalEmployeeId: row.original_employee_id, shiftId: row.shift_id, pickupEmployeeId: row.pickup_employee_id ?? undefined, pickupStatus: row.pickup_status ?? undefined, status: row.status, reason: row.reason, validationWarnings: row.validation_warnings ?? [], createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined, resolvedBy: row.resolved_by ?? undefined, managerNote: row.manager_note ?? undefined };
}

function openShiftPickupFromRow(row: SupabaseRow): OpenShiftPickupRequest {
  return { id: row.id, openShiftId: row.open_shift_id, employeeId: row.employee_id, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined, resolvedBy: row.resolved_by ?? undefined, managerNote: row.manager_note ?? undefined, validationWarnings: row.validation_warnings ?? [] };
}

function assignmentToRow(data: Omit<ShiftAssignment, 'id'>, id = newId('sa')) {
  return { id, schedule_id: data.scheduleId, date: data.date, shift_type: data.shiftType, employee_id: data.employeeId, hours: data.hours, status: data.status, notes: data.notes ?? null };
}

function availabilityToRow(data: Omit<Availability, 'id'>, id = newId('av')) {
  return { id, employee_id: data.employeeId, schedule_id: data.scheduleId, date: data.date, status: data.status, note: data.note ?? null, submitted_at: data.submittedAt, approval_status: data.approvalStatus ?? 'pending', manager_note: data.managerNote ?? null };
}

/**
 * Generate the next 23 days of an employee's OFF cycle.
 * The repeating 23-day pattern is 6 work, 1 OFF, 6 work, 2 OFF,
 * 6 work, 2 OFF. We infer the source period's phase, then continue it.
 * Therefore a two-day OFF can safely run from day 23 into day 1.
 */
function buildContinuedOffCycle(sourceStartDate: string, sourceOffDates: string[], targetStartDate: string): string[] {
  const sourceOffIndexes = new Set(sourceOffDates.map(date => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${sourceStartDate}T00:00:00Z`)) / 86400000)).filter(index => index >= 0 && index < 23));
  const canonicalOffIndexes = new Set([6, 13, 14, 21, 22]);
  let bestPhase = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let phase = 0; phase < 23; phase += 1) {
    let score = 0;
    for (let day = 0; day < 23; day += 1) {
      score += sourceOffIndexes.has(day) === canonicalOffIndexes.has((phase + day) % 23) ? 1 : -1;
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }
  const result: string[] = [];
  const targetStart = new Date(`${targetStartDate}T00:00:00Z`);
  for (let day = 0; day < 23; day += 1) {
    if (!canonicalOffIndexes.has((bestPhase + day) % 23)) continue;
    const date = new Date(targetStart);
    date.setUTCDate(date.getUTCDate() + day);
    result.push(date.toISOString().slice(0, 10));
  }
  return result;
}
function swapToRow(data: Omit<SwapRequest, 'id'>, id = newId('swap')) {
  return { id, requester_id: data.requesterId, target_id: data.targetId, requester_shift_id: data.requesterShiftId, target_shift_id: data.targetShiftId, reason: data.reason, status: data.status, validation_warnings: data.validationWarnings, created_at: data.createdAt, resolved_at: data.resolvedAt ?? null, resolved_by: data.resolvedBy ?? null, manager_note: data.managerNote ?? null };
}

function openShiftToRow(data: Omit<OpenShiftRequest, 'id'>, id = newId('open')) {
  return { id, original_employee_id: data.originalEmployeeId, shift_id: data.shiftId, pickup_employee_id: data.pickupEmployeeId ?? null, pickup_status: data.pickupStatus ?? null, status: data.status, reason: data.reason, validation_warnings: data.validationWarnings, created_at: data.createdAt, resolved_at: data.resolvedAt ?? null, resolved_by: data.resolvedBy ?? null, manager_note: data.managerNote ?? null };
}

function openShiftPickupToRow(data: Omit<OpenShiftPickupRequest, 'id'>, id = newId('pickup')) {
  return { id, open_shift_id: data.openShiftId, employee_id: data.employeeId, status: data.status, created_at: data.createdAt, resolved_at: data.resolvedAt ?? null, resolved_by: data.resolvedBy ?? null, manager_note: data.managerNote ?? null, validation_warnings: data.validationWarnings };
}

function toSnakeCaseUpdate(update: Record<string, any>) {
  const names: Record<string, string> = { requesterId: 'requester_id', targetId: 'target_id', requesterShiftId: 'requester_shift_id', targetShiftId: 'target_shift_id', validationWarnings: 'validation_warnings', createdAt: 'created_at', resolvedAt: 'resolved_at', resolvedBy: 'resolved_by', managerNote: 'manager_note', originalEmployeeId: 'original_employee_id', shiftId: 'shift_id', pickupEmployeeId: 'pickup_employee_id', pickupStatus: 'pickup_status', openShiftId: 'open_shift_id', employeeId: 'employee_id' };
  return Object.fromEntries(Object.entries(update).map(([key, value]) => [names[key] ?? key, value]));
}
/** Seed only the base records needed to start a new Firebase project. */
export async function ensureFirebaseBaseData(): Promise<void> {
  if (IS_LOCAL_DEMO_MODE || USE_SUPABASE) return;

  const { getDb } = await import('../lib/firebase');
  const { collection, doc, getDocs, query, setDoc, where } = await import('firebase/firestore');
  const db = getDb();
  const employeeSnapshot = await getDocs(collection(db, 'employees'));
  if (employeeSnapshot.empty) {
    await Promise.all(MOCK_EMPLOYEES.map(employee =>
      setDoc(doc(db, 'employees', employee.id), employee)
    ));
  }

  const activeScheduleSnapshot = await getDocs(query(
    collection(db, 'schedulePeriods'),
    where('isActive', '==', true)
  ));
  if (activeScheduleSnapshot.empty) {
    await setDoc(doc(db, 'schedulePeriods', MOCK_SCHEDULE.id), MOCK_SCHEDULE);
  }
}

// ─── Employees ────────────────────────────────────────────────────────────────

export async function getEmployees(): Promise<Employee[]> {
  if (IS_LOCAL_DEMO_MODE) return [..._employees];
  if (USE_SUPABASE) {
    const supabase = getSupabase();
    // Account creation time is the permanent organization order used for fair
    // availability pairs. Manager roster display order must not change it.
    const { data: profiles, error: profileError } = await supabase.from('users').select('employee_id').eq('role', 'employee').eq('is_approved', true).eq('registration_status', 'approved').order('created_at');
    if (profileError) throw profileError;
    const ids = (profiles ?? []).map((profile: any) => profile.employee_id).filter(Boolean);
    if (!ids.length) return [];
    const { data, error } = await supabase.from('employees').select('*').eq('active', true).in('id', ids);
    if (error) throw error;
    const byId = new Map((data ?? []).map(employee => [employee.id, employeeFromRow(employee)]));
    return ids.flatMap(id => { const employee = byId.get(id); return employee ? [employee] : []; });
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, getDocs } = await import('firebase/firestore');
  const snap = await getDocs(collection(getDb(), 'employees'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

function nextDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function indiaTodayKey(): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Approved employees included in one manager-created schedule roster, in manager order. */
export async function getScheduleEmployees(scheduleId: string): Promise<Employee[]> {
  if (IS_LOCAL_DEMO_MODE) return [..._employees];
  if (USE_SUPABASE) {
    const supabase = getSupabase();
    const { data: members, error: memberError } = await supabase.from('schedule_period_employees').select('employee_id, position, availability_submitted_at, availability_deadline_override, availability_wave, availability_approved_at').eq('schedule_id', scheduleId).order('position');
    if (memberError) throw memberError;
    const ids = (members ?? []).map((member: any) => member.employee_id);
    if (!ids.length) return [];
    // The manager's saved period roster is authoritative here. Do not lose
    // roster members because an old account-profile flag is missing.
    const { data: rosterRows, error: rosterError } = await supabase.from('employees').select('*').in('id', ids);
    if (rosterError) throw rosterError;
    const byId = new Map((rosterRows ?? []).map(employee => {
      const mapped = employeeFromRow(employee);
      return [mapped.id, mapped];
    }));
    const submittedAt = new Map((members ?? []).map((member: any) => [member.employee_id, member.availability_submitted_at]));
    const lateOverrides = new Map((members ?? []).map((member: any) => [member.employee_id, member.availability_deadline_override]));
    const waves = new Map((members ?? []).map((member: any) => [member.employee_id, member.availability_wave]));
    const approvedAt = new Map((members ?? []).map((member: any) => [member.employee_id, member.availability_approved_at]));
    return ids.flatMap(id => { const employee = byId.get(id); return employee ? [{ ...employee, availabilitySubmittedAt: submittedAt.get(id) ?? undefined, availabilityDeadlineOverride: lateOverrides.get(id) ?? false, availabilityWave: waves.get(id) ?? 1, availabilityApprovedAt: approvedAt.get(id) ?? undefined }] : []; });
  }
  return getEmployees();
}

async function refreshScheduleAvailabilityWaves(scheduleId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  const supabase = getSupabase();
  const [{ data: schedule, error: scheduleError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from('schedule_periods').select('availability_priority').eq('id', scheduleId).single(),
    supabase.from('schedule_period_employees').select('employee_id, availability_submitted_at, availability_approved_at').eq('schedule_id', scheduleId),
  ]);
  if (scheduleError) throw scheduleError;
  if (membersError) throw membersError;
  const memberIds = (members ?? []).map((member: any) => member.employee_id);
  if (!memberIds.length) return;
  // A live period with submissions/approvals is frozen: never re-pair people
  // or alter their queue while they are working through availability.
  if ((members ?? []).some((member: any) => member.availability_submitted_at || member.availability_approved_at)) return;
  // Pair identities are permanent and deliberately ignore manager roster order.
  const { data: rows, error: employeeError } = await supabase.from('employees').select('*').in('id', memberIds);
  if (employeeError) throw employeeError;
  const organization = (rows ?? []).map(employeeFromRow).sort((left, right) => `${String(left.availabilityPairIndex ?? Number.MAX_SAFE_INTEGER).padStart(12, '0')}|${left.joinDate ?? ''}|${left.id}`.localeCompare(`${String(right.availabilityPairIndex ?? Number.MAX_SAFE_INTEGER).padStart(12, '0')}|${right.joinDate ?? ''}|${right.id}`));
  const grouped = new Map<number, Employee[]>();
  organization.forEach((employee, fallbackIndex) => { const pairIndex = employee.availabilityPairIndex ?? Math.floor(fallbackIndex / 2); const pair = grouped.get(pairIndex) ?? []; pair.push(employee); grouped.set(pairIndex, pair); });
  const pairs = [...grouped.entries()].sort(([left], [right]) => left - right).map(([, pair]) => pair);
  if (!pairs.length) return;
  const priority = Number((schedule as any).availability_priority ?? 0) % pairs.length;
  const rotatedPairs = Array.from({ length: pairs.length }, (_, index) => pairs[(priority + index) % pairs.length]);
  for (const [waveIndex, pair] of rotatedPairs.entries()) {
    for (const employee of pair) {
      const { error } = await supabase.from('schedule_period_employees').update({ availability_wave: waveIndex + 1 }).eq('schedule_id', scheduleId).eq('employee_id', employee.id);
      if (error) throw error;
    }
  }
}
export async function addEmployeeToSchedule(scheduleId: string, employeeId: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE || !USE_SUPABASE) return;
  const supabase = getSupabase();
  const { data: members, error: readError } = await supabase.from('schedule_period_employees').select('position').eq('schedule_id', scheduleId).order('position', { ascending: false }).limit(1);
  if (readError) throw readError;
  const position = ((members?.[0] as any)?.position ?? -1) + 1;
  const { error } = await supabase.from('schedule_period_employees').insert({ schedule_id: scheduleId, employee_id: employeeId, position });
  if (error) throw error;
  await refreshScheduleAvailabilityWaves(scheduleId);
}

export async function removeEmployeeFromSchedule(scheduleId: string, employeeId: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE || !USE_SUPABASE) return;
  const supabase = getSupabase();
  // A removed employee must not leave hidden OFF days or availability that blocks
  // a later period-date correction or appears when they are added again.
  const { error: availabilityError } = await supabase.from('availability')
    .delete().eq('schedule_id', scheduleId).eq('employee_id', employeeId);
  if (availabilityError) throw availabilityError;
  const { error } = await supabase.from('schedule_period_employees')
    .delete().eq('schedule_id', scheduleId).eq('employee_id', employeeId);
  if (error) throw error;
  await refreshScheduleAvailabilityWaves(scheduleId);
}

export async function grantLateAvailabilityAccess(scheduleId: string, employeeId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('schedule_period_employees').update({ availability_deadline_override: true, availability_submitted_at: null }).eq('schedule_id', scheduleId).eq('employee_id', employeeId);
  if (error) throw error;
  const { error: availabilityError } = await supabase.from('availability').update({ approval_status: 'resubmit', manager_note: 'Manager granted late availability access.' }).eq('schedule_id', scheduleId).eq('employee_id', employeeId).neq('status', 'off');
  if (availabilityError) throw availabilityError;
}
export async function submitEmployeeAvailability(scheduleId: string, employeeId: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE || !USE_SUPABASE) return;
  const { error } = await getSupabase().from('schedule_period_employees').update({ availability_submitted_at: new Date().toISOString() }).eq('schedule_id', scheduleId).eq('employee_id', employeeId).is('availability_submitted_at', null);
  if (error) throw error;
}

async function clearEmployeeAvailabilitySubmission(scheduleId: string, employeeId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  const { error } = await getSupabase().from('schedule_period_employees').update({ availability_submitted_at: null }).eq('schedule_id', scheduleId).eq('employee_id', employeeId);
  if (error) throw error;
}
export async function setScheduleEmployeeOrder(scheduleId: string, employeeIds: string[]): Promise<void> {
  if (IS_LOCAL_DEMO_MODE || !USE_SUPABASE) return;
  const supabase = getSupabase();
  for (const [position, employeeId] of employeeIds.entries()) {
    const { error } = await supabase.from('schedule_period_employees').update({ position }).eq('schedule_id', scheduleId).eq('employee_id', employeeId);
    if (error) throw error;
  }
  await refreshScheduleAvailabilityWaves(scheduleId);
}
export async function getActiveSchedule(): Promise<SchedulePeriod | null> {
  if (IS_LOCAL_DEMO_MODE) return { ..._schedule };
  if (USE_SUPABASE) {
    const today = indiaTodayKey();
    const { data, error } = await getSupabase().from('schedule_periods').select('*').eq('is_active', true).lte('start_date', today).gte('end_date', today).order('start_date', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? scheduleFromRow(data) : null;
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs } = await import('firebase/firestore');
  const q = query(collection(getDb(), 'schedulePeriods'), where('isActive', '==', true));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as SchedulePeriod;
}

/** The upcoming period employees should prepare availability for. */
export async function getPlanningSchedule(): Promise<SchedulePeriod | null> {
  if (IS_LOCAL_DEMO_MODE) return { ..._schedule };
  if (USE_SUPABASE) {
    const today = indiaTodayKey();
    const { data, error } = await getSupabase().from('schedule_periods').select('*').eq('is_active', true).gt('start_date', today).order('start_date').limit(1).maybeSingle();
    if (error) throw error;
    return data ? scheduleFromRow(data) : getActiveSchedule();
  }
  return getActiveSchedule();
}
export async function getSchedulePeriods(): Promise<SchedulePeriod[]> {
  if (IS_LOCAL_DEMO_MODE) return [{ ..._schedule }];
  if (USE_SUPABASE) {
    const { data, error } = await getSupabase().from('schedule_periods').select('*').eq('is_active', true).order('start_date');
    if (error) throw error;
    return (data ?? []).map(scheduleFromRow);
  }
  return [];
}

/** Change a period before any manager OFF days or employee availability has been entered. */
export async function updateSchedulePeriodDates(scheduleId: string, startDate: string): Promise<SchedulePeriod> {
  const minimumStart = new Date(indiaTodayKey() + 'T00:00:00Z');
  minimumStart.setUTCDate(minimumStart.getUTCDate() + 5);
  if (startDate < minimumStart.toISOString().slice(0, 10)) {
    throw new Error(`A period must start at least five days from today (${minimumStart.toISOString().slice(0, 10)}).`);
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 22);
  const endDate = end.toISOString().slice(0, 10);
  const deadline = new Date(start);
  deadline.setUTCDate(deadline.getUTCDate() - 5);
  deadline.setUTCHours(18, 29, 59, 999);
  const label = `${startDate} to ${endDate}`;

  if (IS_LOCAL_DEMO_MODE) {
    if (_schedule.restDaysPublished || _availability.some(item => item.scheduleId === scheduleId)) {
      throw new Error('Period dates can only be changed before assigning manager OFF days.');
    }
    _schedule = { ..._schedule, startDate, endDate, label, availabilityDeadline: deadline.toISOString() };
    persistDemoStore();
    return { ..._schedule };
  }
  if (!USE_SUPABASE) throw new Error('Editing periods requires Supabase.');

  const supabase = getSupabase();
  const { data: existing, error: existingError } = await supabase.from('schedule_periods')
    .select('rest_days_published').eq('id', scheduleId).single();
  if (existingError) throw existingError;
  if (existing.rest_days_published) throw new Error('Unpublish and clear this period before changing its dates.');

  const { data: roster, error: rosterError } = await supabase.from('schedule_period_employees')
    .select('employee_id').eq('schedule_id', scheduleId).limit(1);
  if (rosterError) throw rosterError;

  const { data: entries, error: entriesError } = await supabase.from('availability')
    .select('id').eq('schedule_id', scheduleId).limit(1);
  if (entriesError) throw entriesError;
  // The visible roster contains only active, manager-approved real employee accounts.
  // Legacy or removed accounts can leave invisible membership rows in Supabase.
  const activeEmployeeIds = new Set((await getEmployees()).map(employee => employee.id));
  const visibleRoster = (roster ?? []).filter((member: any) => activeEmployeeIds.has(member.employee_id));
  if (!visibleRoster.length && ((roster?.length ?? 0) > 0 || entries?.length)) {
    // No active employee remains. Remove old hidden roster/availability data so
    // the manager can correct an unstarted period.
    const { error: cleanupAvailabilityError } = await supabase.from('availability').delete().eq('schedule_id', scheduleId);
    if (cleanupAvailabilityError) throw cleanupAvailabilityError;
    const { error: cleanupRosterError } = await supabase.from('schedule_period_employees').delete().eq('schedule_id', scheduleId);
    if (cleanupRosterError) throw cleanupRosterError;
  } else if (entries?.length) {
    throw new Error('Period dates can only be changed before assigning manager OFF days or receiving availability.');
  }

  const { data: overlap, error: overlapError } = await supabase.from('schedule_periods')
    .select('id').eq('is_active', true).neq('id', scheduleId).lte('start_date', endDate).gte('end_date', startDate).limit(1).maybeSingle();
  if (overlapError) throw overlapError;
  if (overlap) throw new Error('These dates overlap another schedule period.');

  const { data, error } = await supabase.from('schedule_periods').update({
    start_date: startDate, end_date: endDate, label, availability_deadline: deadline.toISOString()
  }).eq('id', scheduleId).select().single();
  if (error) throw error;
  return scheduleFromRow(data);
}
/** Delete an unstarted future period and its cascading period-only data. */
export async function deleteFutureSchedulePeriod(scheduleId: string): Promise<string | undefined> {
  if (IS_LOCAL_DEMO_MODE) throw new Error('Deleting periods requires Supabase.');
  if (!USE_SUPABASE) throw new Error('Deleting periods requires Supabase.');
  const supabase = getSupabase();
  const { data: period, error: readError } = await supabase.from('schedule_periods')
    .select('start_date, end_date, source_schedule_id').eq('id', scheduleId).single();
  if (readError) throw readError;
  if (period.end_date < indiaTodayKey()) throw new Error('Past periods are retained as records and cannot be deleted.');
  const { error } = await supabase.from('schedule_periods').delete().eq('id', scheduleId);
  if (error) throw error;
  return period.source_schedule_id ?? undefined;
}
export async function createSchedulePeriod(startDate: string, createdBy: string, copyOffFrom?: SchedulePeriod, priorityFrom?: SchedulePeriod): Promise<SchedulePeriod> {
  const minimumStart = new Date(indiaTodayKey() + 'T00:00:00Z'); minimumStart.setUTCDate(minimumStart.getUTCDate() + 5); if (startDate < minimumStart.toISOString().slice(0, 10)) throw new Error('A period must start at least five days from today (' + minimumStart.toISOString().slice(0, 10) + ') so employees have time to submit availability.'); const start = new Date(startDate + 'T00:00:00Z'); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 22);
  const deadline = new Date(start); deadline.setUTCDate(deadline.getUTCDate() - 5); deadline.setUTCHours(18,29,59,999);
  const data: SchedulePeriod = { id: newId('sched'), startDate, endDate: end.toISOString().slice(0,10), label: startDate + ' to ' + end.toISOString().slice(0,10), isActive: true, createdAt: new Date().toISOString(), createdBy, restDaysPublished: Boolean(copyOffFrom?.restDaysPublished), availabilityDeadline: deadline.toISOString(), sourceScheduleId: copyOffFrom?.id, availabilityPriority: 0 };
  if (IS_LOCAL_DEMO_MODE) { _schedule=data; _availability=[]; persistDemoStore(); return data; }
  if (USE_SUPABASE) { const supabase=getSupabase(); const { data: lastPeriod } = await supabase.from('schedule_periods').select('availability_priority').order('start_date', { ascending: false }).limit(1).maybeSingle(); data.availabilityPriority = Number(priorityFrom?.availabilityPriority ?? (lastPeriod as any)?.availability_priority ?? -1) + 1; const { data: overlap, error: overlapError } = await supabase.from('schedule_periods').select('id').eq('is_active', true).lte('start_date', data.endDate).gte('end_date', data.startDate).limit(1).maybeSingle(); if (overlapError) throw overlapError; if (overlap) throw new Error('This period overlaps an existing schedule period. Choose the next day after its end date.'); const {data: row,error}=await supabase.from('schedule_periods').insert({id:data.id,start_date:data.startDate,end_date:data.endDate,label:data.label,is_active:true,created_at:data.createdAt,created_by:createdBy,rest_days_published:data.restDaysPublished,availability_deadline:data.availabilityDeadline,source_schedule_id:data.sourceScheduleId ?? null,availability_priority:data.availabilityPriority ?? 0}).select().single(); if(error) throw error; if(copyOffFrom) {
const { data: priorRoster, error: priorRosterError } = await supabase.from('schedule_period_employees').select('employee_id, position').eq('schedule_id', copyOffFrom.id).order('position');
if (priorRosterError) throw priorRosterError;
if ((priorRoster ?? []).length) {
  const { error: rosterCopyError } = await supabase.from('schedule_period_employees').insert((priorRoster ?? []).map((member: any) => ({ schedule_id: data.id, employee_id: member.employee_id, position: member.position })));
  if (rosterCopyError) throw rosterCopyError;
  await refreshScheduleAvailabilityWaves(data.id);
}
const { data: prior, error: priorError } = await supabase.from('availability').select('employee_id, date').eq('schedule_id', copyOffFrom.id).eq('status', 'off');
if (priorError) throw priorError;
const sourceOffsByEmployee = new Map<string, string[]>();
for (const item of prior ?? []) {
  const values = sourceOffsByEmployee.get(item.employee_id) ?? [];
  values.push(item.date);
  sourceOffsByEmployee.set(item.employee_id, values);
}
const copied = (priorRoster ?? []).flatMap((member: any) =>
  buildContinuedOffCycle(copyOffFrom!.startDate, sourceOffsByEmployee.get(member.employee_id) ?? [], data.startDate).map(date =>
    availabilityToRow({ employeeId: member.employee_id, scheduleId: data.id, date, status: 'off', note: 'Repeated 6-work-day OFF cycle', submittedAt: new Date().toISOString() })
  )
);
if (copied.length) { const { error: copyError } = await supabase.from('availability').insert(copied); if (copyError) throw copyError; } } return scheduleFromRow(row); }
  throw new Error('Creating periods requires Supabase.');
}

export async function reopenManagerRestDays(scheduleId: string, employeeId?: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE || !USE_SUPABASE) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('schedule_periods').update({ rest_days_published: false }).eq('id', scheduleId);
  if (error) throw error;
  if (employeeId) {
    const { error: availabilityError } = await supabase.from('availability').update({ approval_status: 'resubmit', manager_note: 'Manager updated assigned rest days. Please review and submit again.' }).eq('schedule_id', scheduleId).eq('employee_id', employeeId).neq('status', 'off');
    if (availabilityError) throw availabilityError;
    await clearEmployeeAvailabilitySubmission(scheduleId, employeeId);
  }
}
export async function publishRestDays(scheduleId: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) {
    if (_schedule.id === scheduleId) _schedule = { ..._schedule, restDaysPublished: true };
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('schedule_periods').update({ rest_days_published: true }).eq('id', scheduleId);
    if (error) throw error;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { doc, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(getDb(), 'schedulePeriods', scheduleId), { restDaysPublished: true });
}

// ─── Assignments ──────────────────────────────────────────────────────────────

export async function getAssignments(scheduleId?: string): Promise<ShiftAssignment[]> {
  if (IS_LOCAL_DEMO_MODE) return [..._assignments];
  if (USE_SUPABASE) {
    let query = getSupabase().from('shift_assignments').select('*');
    if (scheduleId) query = query.eq('schedule_id', scheduleId);
    const { data, error } = await query.order('date');
    if (error) throw error;
    return (data ?? []).map(assignmentFromRow);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs } = await import('firebase/firestore');
  const col = collection(getDb(), 'shiftAssignments');
  const q = scheduleId ? query(col, where('scheduleId', '==', scheduleId)) : col;
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment));
}

export async function addAssignment(data: Omit<ShiftAssignment, 'id'>): Promise<ShiftAssignment> {
  const existingAssignments = await getAssignments(data.scheduleId);
  if (hasNightToDayConflict(existingAssignments, data.employeeId, data.date, data.shiftType)) throw new Error('An employee cannot work a Day shift immediately after a Night shift.');
  const newItem = { ...data, id: newId('sa') };
  if (IS_LOCAL_DEMO_MODE) { _assignments.push(newItem); persistDemoStore(); return newItem; }
  if (USE_SUPABASE) {
    const row = assignmentToRow(data, newItem.id);
    const { data: inserted, error } = await getSupabase().from('shift_assignments').insert(row).select().single();
    if (error) throw error;
    return assignmentFromRow(inserted);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, addDoc } = await import('firebase/firestore');
  const ref = await addDoc(collection(getDb(), 'shiftAssignments'), data);
  return { ...data, id: ref.id };
}

export async function removeAssignment(id: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) { _assignments = _assignments.filter(a => a.id !== id); persistDemoStore(); return; }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('shift_assignments').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { doc, deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(getDb(), 'shiftAssignments', id));
}

// ─── Availability ─────────────────────────────────────────────────────────────

export async function getAvailability(scheduleId?: string): Promise<Availability[]> {
  if (IS_LOCAL_DEMO_MODE) return [..._availability];
  if (USE_SUPABASE) {
    let query = getSupabase().from('availability').select('*');
    if (scheduleId) query = query.eq('schedule_id', scheduleId);
    const { data, error } = await query.order('date');
    if (error) throw error;
    return (data ?? []).map(availabilityFromRow);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs } = await import('firebase/firestore');
  const col = collection(getDb(), 'availability');
  const q = scheduleId ? query(col, where('scheduleId', '==', scheduleId)) : col;
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Availability));
}

export async function diagnoseAvailabilityEdit(scheduleId: string, date: string, status: 'day' | 'evening' | 'night'): Promise<{ reason?: string } | null> {
  if (!USE_SUPABASE) return null;
  const { data, error } = await getSupabase().rpc('availability_edit_diagnostic', {
    p_schedule_id: scheduleId,
    p_date: date,
    p_status: status,
  });
  if (error) throw error;
  return data as { reason?: string } | null;
}
export async function setAvailability(data: Omit<Availability, 'id'>): Promise<Availability> {
  const newItem = { ...data, id: newId('av') };
  if (IS_LOCAL_DEMO_MODE) {
    const existing = _availability.findIndex(
      a => a.employeeId === data.employeeId && a.date === data.date
    );
    if (existing >= 0) { _availability[existing] = newItem; }
    else { _availability.push(newItem); }
    persistDemoStore();
    return newItem;
  }
  if (USE_SUPABASE) {
    // Employee shift choices use one validated RPC, avoiding opaque RLS 403s.
    if (data.status !== 'off') {
      const { data: row, error } = await getSupabase().rpc('save_my_availability', {
        p_schedule_id: data.scheduleId,
        p_date: data.date,
        p_status: data.status,
        p_note: data.note ?? null,
      });
      if (error) throw error;
      return availabilityFromRow(row);
    }
    // Manager-assigned OFF days retain the manager-only table policy.
    const supabase = getSupabase();
    const { data: existing, error: lookupError } = await supabase.from('availability').select('id').eq('employee_id', data.employeeId).eq('schedule_id', data.scheduleId).eq('date', data.date).maybeSingle();
    if (lookupError) throw lookupError;
    const row = availabilityToRow(data, existing?.id ?? newItem.id);
    const result = existing
      ? await supabase.from('availability').update(row).eq('id', existing.id).select().single()
      : await supabase.from('availability').insert(row).select().single();
    if (result.error) throw result.error;
    return availabilityFromRow(result.data);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, addDoc, query, where, getDocs, updateDoc, doc } = await import('firebase/firestore');
  const col = collection(getDb(), 'availability');
  const q = query(col, where('employeeId', '==', data.employeeId), where('date', '==', data.date));
  const snap = await getDocs(q);
  if (!snap.empty) {
    await updateDoc(doc(getDb(), 'availability', snap.docs[0].id), { ...data });
    return { ...data, id: snap.docs[0].id };
  }
  const ref = await addDoc(col, data);
  return { ...data, id: ref.id };
}

export async function clearAvailabilityChoice(id: string): Promise<void> {
  if (USE_SUPABASE && !IS_LOCAL_DEMO_MODE) {
    const { error } = await getSupabase().rpc('clear_my_availability', { p_availability_id: id });
    if (error) throw error;
    return;
  }
  await removeAvailability(id);
}

export async function removeAvailability(id: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) { _availability = _availability.filter(a => a.id !== id); persistDemoStore(); return; }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('availability').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { doc, deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(getDb(), 'availability', id));
}

export async function approveEmployeeAvailability(employeeId: string, scheduleId: string): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) {
    const employeeAvailability = _availability.filter(a => a.employeeId === employeeId && a.scheduleId === scheduleId);
    const shiftChoices = employeeAvailability.filter(a => a.status !== 'off');
    if (shiftChoices.length !== 18) throw new Error('Employee must submit one shift choice for every working day before approval.');
    if (shiftChoices.some(choice => choice.status === 'night' && shiftChoices.some(next => next.status === 'day' && next.date === nextDateKey(choice.date)))) throw new Error('Cannot approve: an employee cannot work a Day shift immediately after a Night shift.');
    _availability = _availability.map(a => a.employeeId === employeeId && a.scheduleId === scheduleId && a.status !== 'off'
      ? { ...a, approvalStatus: 'approved' as const } : a);
    _assignments = _assignments.filter(a => !(a.employeeId === employeeId && a.scheduleId === scheduleId));
    _assignments.push(...shiftChoices.map(choice => ({
      id: newId('sa'), scheduleId, date: choice.date, shiftType: choice.status as 'day' | 'evening' | 'night',
      employeeId, hours: 8, status: 'scheduled' as const,
    })));
    persistDemoStore();
    return;
  }

  if (USE_SUPABASE) {
    const plan = await prepareAvailabilityPlan(scheduleId, employeeId);
    await applyAvailabilityPlan(plan);
    return;
  }

  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs, writeBatch, doc, addDoc } = await import('firebase/firestore');
  const db = getDb();
  const availabilitySnap = await getDocs(query(collection(db, 'availability'), where('employeeId', '==', employeeId), where('scheduleId', '==', scheduleId)));
  const shiftChoices = availabilitySnap.docs.map(item => ({ id: item.id, ...item.data() } as Availability)).filter(item => item.status !== 'off');
  if (shiftChoices.length !== 18) throw new Error('Employee must submit one shift choice for every working day before approval.');
  const batch = writeBatch(db);
  availabilitySnap.docs.forEach(item => {
    if (item.data().status !== 'off') batch.update(doc(db, 'availability', item.id), { approvalStatus: 'approved' });
  });
  await batch.commit();
  await Promise.all(shiftChoices.map(choice => addDoc(collection(db, 'shiftAssignments'), {
    scheduleId, date: choice.date, shiftType: choice.status, employeeId, hours: 8, status: 'scheduled',
  })));
}

export async function rejectEmployeeAvailability(
  employeeId: string, scheduleId: string, managerNote: string
): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) {
    _availability = _availability.map(item =>
      item.employeeId === employeeId && item.scheduleId === scheduleId
        ? { ...item, approvalStatus: 'rejected' as const, managerNote }
        : item
    );
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('availability').update({ approval_status: 'rejected', manager_note: managerNote }).eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (error) throw error;
    await clearEmployeeAvailabilitySubmission(scheduleId, employeeId);
    const { error: rosterResetError } = await getSupabase().from('schedule_period_employees').update({ availability_approved_at: null }).eq('schedule_id', scheduleId).eq('employee_id', employeeId);
    if (rosterResetError) throw rosterResetError;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs, writeBatch, doc } = await import('firebase/firestore');
  const db = getDb();
  const snapshot = await getDocs(query(collection(db, 'availability'), where('employeeId', '==', employeeId), where('scheduleId', '==', scheduleId)));
  const batch = writeBatch(db);
  snapshot.docs.forEach(item => batch.update(doc(db, 'availability', item.id), { approvalStatus: 'rejected', managerNote }));
  await batch.commit();
}

export async function requestAvailabilityResubmission(
  employeeId: string, scheduleId: string, managerNote: string
): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) {
    _availability = _availability.filter(item =>
      !(item.employeeId === employeeId && item.scheduleId === scheduleId && item.status !== 'off')
    ).map(item =>
      item.employeeId === employeeId && item.scheduleId === scheduleId
        ? { ...item, approvalStatus: 'resubmit' as const, managerNote }
        : item
    );
    _assignments = _assignments.filter(item => !(item.employeeId === employeeId && item.scheduleId === scheduleId));
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const supabase = getSupabase();
    // Clear employee choices while keeping the manager-assigned rest days.
    const { error: resetError } = await supabase.from('availability').delete().eq('employee_id', employeeId).eq('schedule_id', scheduleId).neq('status', 'off');
    if (resetError) throw resetError;
    const { error: availabilityError } = await supabase.from('availability').update({ approval_status: 'resubmit', manager_note: managerNote }).eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (availabilityError) throw availabilityError;
    const { error: assignmentError } = await supabase.from('shift_assignments').delete().eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (assignmentError) throw assignmentError;
    await clearEmployeeAvailabilitySubmission(scheduleId, employeeId);
    const { error: rosterResetError } = await getSupabase().from('schedule_period_employees').update({ availability_approved_at: null }).eq('schedule_id', scheduleId).eq('employee_id', employeeId);
    if (rosterResetError) throw rosterResetError;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs, writeBatch, doc, deleteDoc } = await import('firebase/firestore');
  const db = getDb();
  const snapshot = await getDocs(query(collection(db, 'availability'), where('employeeId', '==', employeeId), where('scheduleId', '==', scheduleId)));
  const batch = writeBatch(db);
  snapshot.docs.forEach(item => {
    if (item.data().status === 'off') batch.update(doc(db, 'availability', item.id), { approvalStatus: 'resubmit', managerNote });
    else batch.delete(doc(db, 'availability', item.id));
  });
  await batch.commit();
  const assignmentSnapshot = await getDocs(query(collection(db, 'shiftAssignments'), where('employeeId', '==', employeeId), where('scheduleId', '==', scheduleId)));
  await Promise.all(assignmentSnapshot.docs.map(item => deleteDoc(doc(db, 'shiftAssignments', item.id))));
}

// ─── Swap Requests ────────────────────────────────────────────────────────────

export async function getSwapRequests(): Promise<SwapRequest[]> {
  if (IS_LOCAL_DEMO_MODE) return [..._swapRequests];
  if (USE_SUPABASE) {
    const { data, error } = await getSupabase().from('swap_requests').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(swapFromRow);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, getDocs } = await import('firebase/firestore');
  const snap = await getDocs(collection(getDb(), 'swapRequests'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as SwapRequest));
}

export async function createSwapRequest(data: Omit<SwapRequest, 'id'>): Promise<SwapRequest> {
  const newItem = { ...data, id: newId('swap') };
  if (IS_LOCAL_DEMO_MODE) { _swapRequests.push(newItem); persistDemoStore(); return newItem; }
  if (USE_SUPABASE) {
    const { data: inserted, error } = await getSupabase().from('swap_requests').insert(swapToRow(data, newItem.id)).select().single();
    if (error) throw error;
    return swapFromRow(inserted);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, addDoc } = await import('firebase/firestore');
  const ref = await addDoc(collection(getDb(), 'swapRequests'), data);
  return { ...data, id: ref.id };
}

export async function updateSwapRequest(id: string, update: Partial<SwapRequest>): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) {
    const idx = _swapRequests.findIndex(s => s.id === id);
    if (idx >= 0) _swapRequests[idx] = { ..._swapRequests[idx], ...update };
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('swap_requests').update(toSnakeCaseUpdate(update)).eq('id', id);
    if (error) throw error;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { doc, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(getDb(), 'swapRequests', id), update);
}

export async function resolveSwapRequest(
  id: string, status: RequestStatus, managerNote: string, resolvedBy: string
): Promise<void> {
  const now = new Date().toISOString();
  if (USE_SUPABASE && status === 'approved') {
    const supabase = getSupabase();
    const { data: row, error: requestError } = await supabase.from('swap_requests').select('*').eq('id', id).single();
    if (requestError) throw requestError;
    const request = swapFromRow(row);
    const { data: assignments, error: assignmentError } = await supabase.from('shift_assignments').select('id, employee_id').in('id', [request.requesterShiftId, request.targetShiftId]);
    if (assignmentError) throw assignmentError;
    const requesterAssignment = (assignments ?? []).find(item => item.id === request.requesterShiftId);
    const targetAssignment = (assignments ?? []).find(item => item.id === request.targetShiftId);
    if (!requesterAssignment || !targetAssignment) throw new Error('Cannot approve swap: one or both assignments no longer exist.');
    const { error: firstUpdateError } = await supabase.from('shift_assignments').update({ employee_id: targetAssignment.employee_id }).eq('id', requesterAssignment.id);
    if (firstUpdateError) throw firstUpdateError;
    const { error: secondUpdateError } = await supabase.from('shift_assignments').update({ employee_id: requesterAssignment.employee_id }).eq('id', targetAssignment.id);
    if (secondUpdateError) throw secondUpdateError;
    await updateSwapRequest(id, { status, managerNote, resolvedBy, resolvedAt: now });
    return;
  }
  await updateSwapRequest(id, { status, managerNote, resolvedBy, resolvedAt: now });
  // If approved, perform the actual swap in assignments
  if (IS_LOCAL_DEMO_MODE && status === 'approved') {
    const req = _swapRequests.find(s => s.id === id);
    if (req) {
      const ra = _assignments.find(a => a.id === req.requesterShiftId);
      const ta = _assignments.find(a => a.id === req.targetShiftId);
      if (ra && ta) {
        const tempEmp = ra.employeeId;
        ra.employeeId = ta.employeeId;
        ta.employeeId = tempEmp;
        persistDemoStore();
      }
    }
  }
}

// ─── Open Shift Pool ──────────────────────────────────────────────────────────

export async function getOpenShifts(): Promise<OpenShiftRequest[]> {
  if (IS_LOCAL_DEMO_MODE) return [..._openShifts];
  if (USE_SUPABASE) {
    const { data, error } = await getSupabase().from('open_shift_requests').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(openShiftFromRow);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, getDocs } = await import('firebase/firestore');
  const snap = await getDocs(collection(getDb(), 'openShiftRequests'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OpenShiftRequest));
}

export async function createOpenShift(data: Omit<OpenShiftRequest, 'id'>): Promise<OpenShiftRequest> {
  const assignments = await getAssignments();
  const releasedShift = assignments.find(assignment => assignment.id === data.shiftId);
  if (!releasedShift) throw new Error('This shift assignment no longer exists.');
  const staffingCount = assignments.filter(assignment => assignment.date === releasedShift.date && assignment.shiftType === releasedShift.shiftType).length;
  if (staffingCount > 2) {
    throw new Error('This shift already has more than two scheduled employees. Notify your manager; do not place it in the open pool.');
  }
  const newItem = { ...data, id: newId('open') };
  if (IS_LOCAL_DEMO_MODE) { _openShifts.push(newItem); persistDemoStore(); return newItem; }
  if (USE_SUPABASE) {
    const { data: inserted, error } = await getSupabase().from('open_shift_requests').insert(openShiftToRow(data, newItem.id)).select().single();
    if (error) throw error;
    return openShiftFromRow(inserted);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, addDoc } = await import('firebase/firestore');
  const ref = await addDoc(collection(getDb(), 'openShiftRequests'), data);
  return { ...data, id: ref.id };
}

export async function updateOpenShift(id: string, update: Partial<OpenShiftRequest>): Promise<void> {
  if (IS_LOCAL_DEMO_MODE) {
    const idx = _openShifts.findIndex(s => s.id === id);
    if (idx >= 0) _openShifts[idx] = { ..._openShifts[idx], ...update };
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('open_shift_requests').update(toSnakeCaseUpdate(update)).eq('id', id);
    if (error) throw error;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { doc, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(getDb(), 'openShiftRequests', id), update);
}

export async function withdrawOpenShift(openShiftId: string, originalEmployeeId: string): Promise<void> {
  const openShift = (await getOpenShifts()).find(shift => shift.id === openShiftId);
  if (!openShift || openShift.originalEmployeeId !== originalEmployeeId || !['open', 'requested'].includes(openShift.status)) {
    throw new Error('This open shift can no longer be withdrawn.');
  }
  const now = new Date().toISOString();
  const withdrawalNote = 'Open shift was withdrawn by the original employee.';
  if (IS_LOCAL_DEMO_MODE) {
    Object.assign(_openShifts.find(shift => shift.id === openShiftId)!, { status: 'cancelled', resolvedAt: now, managerNote: withdrawalNote });
    _openShiftPickupRequests.filter(request => request.openShiftId === openShiftId && request.status === 'pending')
      .forEach(request => Object.assign(request, { status: 'rejected' as const, resolvedAt: now, managerNote: withdrawalNote }));
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().rpc('withdraw_open_shift', { p_open_shift_id: openShiftId });
    if (error) throw error;
    return;
  }
  const requests = await getOpenShiftPickupRequests(openShiftId);
  const { doc, updateDoc } = await import('firebase/firestore');
  const { getDb } = await import('../lib/firebase');
  await updateDoc(doc(getDb(), 'openShiftRequests', openShiftId), { status: 'cancelled', resolvedAt: now, managerNote: withdrawalNote });
  await Promise.all(requests.filter(request => request.status === 'pending').map(request =>
    updateDoc(doc(getDb(), 'openShiftPickupRequests', request.id), { status: 'rejected', resolvedAt: now, managerNote: withdrawalNote })
  ));
}

export async function getOpenShiftPickupRequests(openShiftId?: string): Promise<OpenShiftPickupRequest[]> {
  if (IS_LOCAL_DEMO_MODE) return _openShiftPickupRequests.filter(request => !openShiftId || request.openShiftId === openShiftId);
  if (USE_SUPABASE) {
    let query = getSupabase().from('open_shift_pickup_requests').select('*').order('created_at');
    if (openShiftId) query = query.eq('open_shift_id', openShiftId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(openShiftPickupFromRow);
  }
  const { collection, getDocs, query, where } = await import('firebase/firestore');
  const { getDb } = await import('../lib/firebase');
  const col = collection(getDb(), 'openShiftPickupRequests');
  const snap = openShiftId ? await getDocs(query(col, where('openShiftId', '==', openShiftId))) : await getDocs(col);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as OpenShiftPickupRequest));
}

export async function requestOpenShiftPickup(
  openShiftId: string, pickupEmployeeId: string, validationWarnings: string[] = []
): Promise<void> {
  const existing = (await getOpenShiftPickupRequests(openShiftId)).find(request => request.employeeId === pickupEmployeeId);
  if (existing) throw new Error('You have already requested to pick up this shift.');
  const data: Omit<OpenShiftPickupRequest, 'id'> = { openShiftId, employeeId: pickupEmployeeId, status: 'pending', createdAt: new Date().toISOString(), validationWarnings };
  const newItem = { ...data, id: newId('pickup') };
  if (IS_LOCAL_DEMO_MODE) {
    _openShiftPickupRequests.push(newItem);
    persistDemoStore();
    return;
  }
  if (USE_SUPABASE) {
    const { error } = await getSupabase().from('open_shift_pickup_requests').insert(openShiftPickupToRow(data, newItem.id));
    if (error) throw error;
    return;
  }
  const { collection, addDoc } = await import('firebase/firestore');
  const { getDb } = await import('../lib/firebase');
  await addDoc(collection(getDb(), 'openShiftPickupRequests'), data);
}

export async function resolveOpenShiftPickupRequest(
  pickupRequestId: string, approved: boolean, resolvedBy: string, managerNote = ''
): Promise<void> {
  const now = new Date().toISOString();
  const allApplications = await getOpenShiftPickupRequests();
  const application = allApplications.find(request => request.id === pickupRequestId);
  if (!application || application.status !== 'pending') throw new Error('This pickup application is no longer awaiting review.');
  const openShift = (await getOpenShifts()).find(shift => shift.id === application.openShiftId);
  if (!openShift || openShift.status === 'filled') throw new Error('This open shift has already been filled.');
  const decision = { status: approved ? 'approved' as const : 'rejected' as const, resolvedAt: now, resolvedBy, managerNote };

  if (IS_LOCAL_DEMO_MODE) {
    const target = _openShiftPickupRequests.find(request => request.id === pickupRequestId)!;
    Object.assign(target, decision);
    if (approved) {
      const open = _openShifts.find(shift => shift.id === application.openShiftId)!;
      Object.assign(open, { pickupEmployeeId: application.employeeId, pickupStatus: 'approved', status: 'filled', resolvedAt: now, resolvedBy, managerNote });
      const assignment = _assignments.find(item => item.id === open.shiftId);
      if (assignment) { assignment.employeeId = application.employeeId; assignment.status = 'covered'; }
      _openShiftPickupRequests.filter(request => request.openShiftId === application.openShiftId && request.id !== pickupRequestId && request.status === 'pending')
        .forEach(request => Object.assign(request, { status: 'rejected' as const, resolvedAt: now, resolvedBy, managerNote: 'Shift assigned to another applicant.' }));
    }
    persistDemoStore();
    return;
  }

  if (USE_SUPABASE) {
    const supabase = getSupabase();
    if (approved) {
      const { data: claimed, error: claimError } = await supabase.from('open_shift_requests')
        .update({ pickup_employee_id: application.employeeId, pickup_status: 'approved', status: 'filled', resolved_at: now, resolved_by: resolvedBy, manager_note: managerNote })
        .eq('id', application.openShiftId).in('status', ['open', 'requested']).select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) throw new Error('This open shift has already been filled.');
      const { error: assignmentError } = await supabase.from('shift_assignments').update({ employee_id: application.employeeId, status: 'covered' }).eq('id', openShift.shiftId);
      if (assignmentError) throw assignmentError;
      const { error: otherError } = await supabase.from('open_shift_pickup_requests').update({ status: 'rejected', resolved_at: now, resolved_by: resolvedBy, manager_note: 'Shift assigned to another applicant.' }).eq('open_shift_id', application.openShiftId).eq('status', 'pending').neq('id', pickupRequestId);
      if (otherError) throw otherError;
    }
    const { error } = await supabase.from('open_shift_pickup_requests').update({ status: decision.status, resolved_at: now, resolved_by: resolvedBy, manager_note: managerNote }).eq('id', pickupRequestId);
    if (error) throw error;
    return;
  }

  const { doc, updateDoc } = await import('firebase/firestore');
  const { getDb } = await import('../lib/firebase');
  await updateDoc(doc(getDb(), 'openShiftPickupRequests', pickupRequestId), decision);
  if (approved) {
    await updateOpenShift(application.openShiftId, { pickupEmployeeId: application.employeeId, pickupStatus: 'approved', status: 'filled', resolvedAt: now, resolvedBy, managerNote });
    await Promise.all(allApplications
      .filter(request => request.openShiftId === application.openShiftId && request.id !== pickupRequestId && request.status === 'pending')
      .map(request => updateDoc(doc(getDb(), 'openShiftPickupRequests', request.id), { status: 'rejected', resolvedAt: now, resolvedBy, managerNote: 'Shift assigned to another applicant.' })));
    const { doc: assignmentDoc, updateDoc: updateAssignment } = await import('firebase/firestore');
    await updateAssignment(assignmentDoc(getDb(), 'shiftAssignments', openShift.shiftId), { employeeId: application.employeeId, status: 'covered' });
  }
}

export async function getApprovedEmployees(): Promise<Employee[]> {
  if (!USE_SUPABASE) return [];
  const supabase = getSupabase();
  const { data: profiles, error: profileError } = await supabase.from('users').select('id,name,email,employee_id').eq('role', 'employee').eq('is_approved', true).eq('registration_status', 'approved').order('created_at');
  if (profileError) throw profileError;
  return (profiles ?? []).map((profile: any) => ({ id: profile.employee_id, name: profile.name, email: profile.email, uid: profile.id, active: true }));
}

export async function revokeEmployeeAccess(uid: string, employeeId: string): Promise<void> {
  if (!USE_SUPABASE) return;
  const supabase = getSupabase();
  const { error } = await supabase.from('users').update({ is_approved: false, registration_status: 'rejected' }).eq('id', uid);
  if (error) throw error;
  const { error: employeeError } = await supabase.from('employees').update({ active: false }).eq('id', employeeId);
  if (employeeError) throw employeeError;
}
export async function getPendingEmployees(): Promise<Employee[]> { if (!USE_SUPABASE) return []; const { data, error } = await getSupabase().from('users').select('id,name,email,employee_id').eq('role','employee').eq('is_real_signup',true).eq('registration_status','pending').order('created_at'); if(error) throw error; return (data??[]).map((u:any)=>({id:u.employee_id,name:u.name,email:u.email,uid:u.id,active:false})); }
export async function approveEmployeeAccount(uid: string, employeeId: string): Promise<void> { const s=getSupabase(); const {error}=await s.from('users').update({is_approved:true,registration_status:'approved'}).eq('id',uid);if(error)throw error;const {error:ee}=await s.from('employees').update({active:true}).eq('id',employeeId);if(ee)throw ee; }
export async function rejectEmployeeAccount(uid: string, employeeId: string): Promise<void> { const s=getSupabase(); const {error}=await s.from('users').update({is_approved:false,registration_status:'rejected'}).eq('id',uid);if(error)throw error;const {error:ee}=await s.from('employees').update({active:false}).eq('id',employeeId);if(ee)throw ee; }
