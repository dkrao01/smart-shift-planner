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
import { USE_SUPABASE, getSupabase } from '../lib/supabase';
import type {
  Employee, SchedulePeriod, ShiftAssignment,
  Availability, SwapRequest, OpenShiftRequest, RequestStatus
} from '../types';
import {
  MOCK_EMPLOYEES, MOCK_SCHEDULE, MOCK_ASSIGNMENTS,
  MOCK_AVAILABILITY, MOCK_SWAP_REQUESTS, MOCK_OPEN_SHIFTS
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

let _idCounter = 9000;
function newId(prefix: string) { return `${prefix}-${++_idCounter}`; }

type SupabaseRow = Record<string, any>;

function employeeFromRow(row: SupabaseRow): Employee {
  return { id: row.id, name: row.name, email: row.email, uid: row.uid ?? undefined, active: row.active, joinDate: row.join_date ?? undefined };
}

function scheduleFromRow(row: SupabaseRow): SchedulePeriod {
  return { id: row.id, startDate: row.start_date, endDate: row.end_date, label: row.label, isActive: row.is_active, createdAt: row.created_at, createdBy: row.created_by ?? '', restDaysPublished: row.rest_days_published };
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

function assignmentToRow(data: Omit<ShiftAssignment, 'id'>, id = newId('sa')) {
  return { id, schedule_id: data.scheduleId, date: data.date, shift_type: data.shiftType, employee_id: data.employeeId, hours: data.hours, status: data.status, notes: data.notes ?? null };
}

function availabilityToRow(data: Omit<Availability, 'id'>, id = newId('av')) {
  return { id, employee_id: data.employeeId, schedule_id: data.scheduleId, date: data.date, status: data.status, note: data.note ?? null, submitted_at: data.submittedAt, approval_status: data.approvalStatus ?? 'pending', manager_note: data.managerNote ?? null };
}

function swapToRow(data: Omit<SwapRequest, 'id'>, id = newId('swap')) {
  return { id, requester_id: data.requesterId, target_id: data.targetId, requester_shift_id: data.requesterShiftId, target_shift_id: data.targetShiftId, reason: data.reason, status: data.status, validation_warnings: data.validationWarnings, created_at: data.createdAt, resolved_at: data.resolvedAt ?? null, resolved_by: data.resolvedBy ?? null, manager_note: data.managerNote ?? null };
}

function openShiftToRow(data: Omit<OpenShiftRequest, 'id'>, id = newId('open')) {
  return { id, original_employee_id: data.originalEmployeeId, shift_id: data.shiftId, pickup_employee_id: data.pickupEmployeeId ?? null, pickup_status: data.pickupStatus ?? null, status: data.status, reason: data.reason, validation_warnings: data.validationWarnings, created_at: data.createdAt, resolved_at: data.resolvedAt ?? null, resolved_by: data.resolvedBy ?? null, manager_note: data.managerNote ?? null };
}

function toSnakeCaseUpdate(update: Record<string, any>) {
  const names: Record<string, string> = { requesterId: 'requester_id', targetId: 'target_id', requesterShiftId: 'requester_shift_id', targetShiftId: 'target_shift_id', validationWarnings: 'validation_warnings', createdAt: 'created_at', resolvedAt: 'resolved_at', resolvedBy: 'resolved_by', managerNote: 'manager_note', originalEmployeeId: 'original_employee_id', shiftId: 'shift_id', pickupEmployeeId: 'pickup_employee_id', pickupStatus: 'pickup_status' };
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
    const { data, error } = await getSupabase().from('employees').select('*').order('name');
    if (error) throw error;
    return (data ?? []).map(employeeFromRow);
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, getDocs } = await import('firebase/firestore');
  const snap = await getDocs(collection(getDb(), 'employees'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export async function getActiveSchedule(): Promise<SchedulePeriod | null> {
  if (IS_LOCAL_DEMO_MODE) return { ..._schedule };
  if (USE_SUPABASE) {
    const { data, error } = await getSupabase().from('schedule_periods').select('*').eq('is_active', true).limit(1).maybeSingle();
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
    const supabase = getSupabase();
    const { data: rows, error: availabilityError } = await supabase.from('availability').select('*').eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (availabilityError) throw availabilityError;
    const employeeAvailability = (rows ?? []).map(availabilityFromRow);
    const shiftChoices = employeeAvailability.filter(item => item.status !== 'off');
    if (shiftChoices.length !== 18) throw new Error('Employee must submit one shift choice for every working day before approval.');
    const { error: approvalError } = await supabase.from('availability').update({ approval_status: 'approved' }).eq('employee_id', employeeId).eq('schedule_id', scheduleId).neq('status', 'off');
    if (approvalError) throw approvalError;
    const { error: deleteError } = await supabase.from('shift_assignments').delete().eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (deleteError) throw deleteError;
    const assignments = shiftChoices.map(choice => assignmentToRow({ scheduleId, date: choice.date, shiftType: choice.status as 'day' | 'evening' | 'night', employeeId, hours: 8, status: 'scheduled' }));
    const { error: insertError } = await supabase.from('shift_assignments').insert(assignments);
    if (insertError) throw insertError;
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
    _availability = _availability.map(item =>
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
    const { error: availabilityError } = await supabase.from('availability').update({ approval_status: 'resubmit', manager_note: managerNote }).eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (availabilityError) throw availabilityError;
    const { error: assignmentError } = await supabase.from('shift_assignments').delete().eq('employee_id', employeeId).eq('schedule_id', scheduleId);
    if (assignmentError) throw assignmentError;
    return;
  }
  const { getDb } = await import('../lib/firebase');
  const { collection, query, where, getDocs, writeBatch, doc, deleteDoc } = await import('firebase/firestore');
  const db = getDb();
  const snapshot = await getDocs(query(collection(db, 'availability'), where('employeeId', '==', employeeId), where('scheduleId', '==', scheduleId)));
  const batch = writeBatch(db);
  snapshot.docs.forEach(item => batch.update(doc(db, 'availability', item.id), { approvalStatus: 'resubmit', managerNote }));
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

export async function requestOpenShiftPickup(
  openShiftId: string, pickupEmployeeId: string
): Promise<void> {
  await updateOpenShift(openShiftId, { pickupEmployeeId, pickupStatus: 'pending', status: 'requested' });
}

export async function resolveOpenShiftPickup(
  id: string, approved: boolean, resolvedBy: string, managerNote = ''
): Promise<void> {
  const now = new Date().toISOString();
  const update: Partial<OpenShiftRequest> = {
    pickupStatus: approved ? 'approved' : 'rejected',
    status: approved ? 'filled' : 'rejected',
    resolvedAt: now,
    resolvedBy,
    managerNote,
  };
  await updateOpenShift(id, update);
  // If approved, update the assignment
  if (USE_SUPABASE && approved) {
    const { data: row, error: requestError } = await getSupabase().from('open_shift_requests').select('*').eq('id', id).single();
    if (requestError) throw requestError;
    const request = openShiftFromRow(row);
    if (request.pickupEmployeeId) {
      const { error } = await getSupabase().from('shift_assignments').update({ employee_id: request.pickupEmployeeId, status: 'covered' }).eq('id', request.shiftId);
      if (error) throw error;
    }
  }
  if (IS_LOCAL_DEMO_MODE && approved) {
    const req = _openShifts.find(s => s.id === id);
    if (req?.pickupEmployeeId) {
      const a = _assignments.find(a => a.id === req.shiftId);
      if (a) a.employeeId = req.pickupEmployeeId;
      persistDemoStore();
    }
  }
}
