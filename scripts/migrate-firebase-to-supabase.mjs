import fs from 'node:fs';
import process from 'node:process';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

const required = ['MIGRATION_FIREBASE_SERVICE_ACCOUNT', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MIGRATION_UID_MAP'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}. Put it in .env.migration, not chat.`);
}

const serviceAccount = JSON.parse(fs.readFileSync(process.env.MIGRATION_FIREBASE_SERVICE_ACCOUNT, 'utf8'));
const uidMap = JSON.parse(fs.readFileSync(process.env.MIGRATION_UID_MAP, 'utf8'));
const firebaseApp = getApps().length > 0
  ? getApps()[0]
  : initializeApp({ credential: cert(serviceAccount) });
const firestore = getFirestore(firebaseApp);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function value(input) {
  if (input === undefined) return null;
  if (input?.toDate instanceof Function) return input.toDate().toISOString();
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) return input.map(value);
  if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item)]));
  return input;
}

const rawUsers = await readCollection('users');
const legacyUidAliases = new Map();
const managerUser = rawUsers.find(user => user.role === 'manager');
if (managerUser) legacyUidAliases.set('mgr-001', managerUser.id);
for (const user of rawUsers) {
  if (user.employeeId) legacyUidAliases.set(`emp-${user.employeeId.slice(1).padStart(3, '0')}`, user.id);
}

function mappedUid(firebaseUid, fieldName) {
  if (!firebaseUid) return null;
  const mapped = uidMap[firebaseUid] || uidMap[legacyUidAliases.get(firebaseUid)] || uidMap[firebaseUid];
  if (!mapped) throw new Error(`No Supabase Auth UID mapping for ${fieldName}: ${firebaseUid}`);
  return mapped;
}

async function readCollection(name) {
  const snapshot = await firestore.collection(name).get();
  return snapshot.docs.map(document => ({ id: document.id, ...value(document.data()) }));
}

async function upsert(table, rows) {
  if (rows.length === 0) {
    console.log(`${table}: 0 rows`);
    return;
  }
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: ${rows.length} rows imported`);
}

const users = rawUsers.map(row => ({
  id: mappedUid(row.id, 'users document'),
  name: row.name,
  email: row.email,
  role: String(row.role).toLowerCase(),
  employee_id: row.employeeId || null,
}));
const employees = (await readCollection('employees')).map(row => ({
  id: row.id,
  name: row.name,
  email: row.email,
  uid: mappedUid(row.uid, `employees/${row.id}.uid`),
  active: row.active ?? true,
  join_date: row.joinDate || null,
}));
const schedules = (await readCollection('schedulePeriods')).map(row => ({
  id: row.id,
  start_date: row.startDate,
  end_date: row.endDate,
  label: row.label,
  is_active: row.isActive,
  created_at: row.createdAt,
  created_by: mappedUid(row.createdBy, `schedulePeriods/${row.id}.createdBy`),
  rest_days_published: row.restDaysPublished ?? false,
}));
const assignments = (await readCollection('shiftAssignments')).map(row => ({
  id: row.id,
  schedule_id: row.scheduleId,
  date: row.date,
  shift_type: row.shiftType,
  employee_id: row.employeeId,
  hours: row.hours,
  status: row.status,
  notes: row.notes || null,
}));
const availability = (await readCollection('availability')).map(row => ({
  id: row.id,
  employee_id: row.employeeId,
  schedule_id: row.scheduleId,
  date: row.date,
  status: row.status,
  note: row.note || null,
  submitted_at: row.submittedAt,
  approval_status: row.approvalStatus || 'pending',
  manager_note: row.managerNote || null,
}));
const swaps = (await readCollection('swapRequests')).map(row => ({
  id: row.id,
  requester_id: row.requesterId,
  target_id: row.targetId,
  requester_shift_id: row.requesterShiftId,
  target_shift_id: row.targetShiftId,
  reason: row.reason,
  status: row.status,
  validation_warnings: row.validationWarnings || [],
  created_at: row.createdAt,
  resolved_at: row.resolvedAt || null,
  resolved_by: mappedUid(row.resolvedBy, `swapRequests/${row.id}.resolvedBy`),
  manager_note: row.managerNote || null,
}));
const openShifts = (await readCollection('openShiftRequests')).map(row => ({
  id: row.id,
  original_employee_id: row.originalEmployeeId,
  shift_id: row.shiftId,
  pickup_employee_id: row.pickupEmployeeId || null,
  pickup_status: row.pickupStatus || null,
  status: row.status,
  reason: row.reason,
  validation_warnings: row.validationWarnings || [],
  created_at: row.createdAt,
  resolved_at: row.resolvedAt || null,
  resolved_by: mappedUid(row.resolvedBy, `openShiftRequests/${row.id}.resolvedBy`),
  manager_note: row.managerNote || null,
}));

// Foreign-key order matters: parents first, then dependent records.
await upsert('users', users);
await upsert('employees', employees);
await upsert('schedule_periods', schedules);
await upsert('shift_assignments', assignments);
await upsert('availability', availability);
await upsert('swap_requests', swaps);
await upsert('open_shift_requests', openShifts);
console.log('Migration complete. Firebase was only read; no Firebase data was changed.');
