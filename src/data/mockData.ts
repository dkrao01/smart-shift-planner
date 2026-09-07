/**
 * Mock data for DEMO MODE (used when Firebase is not configured).
 * Provides a realistic 23-day schedule with intentional warnings.
 */

import { format, addDays } from 'date-fns';
import type {
  AppUser, Employee, SchedulePeriod, ShiftAssignment,
  Availability, SwapRequest, OpenShiftRequest
} from '../types';

// ─── Reference Start Date ─────────────────────────────────────────────────────
// Schedule starts from the first day of the current month
const TODAY = new Date();
const START = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);

function d(offset: number): string {
  return format(addDays(START, offset), 'yyyy-MM-dd');
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const MOCK_USERS: AppUser[] = [
  { uid: 'mgr-001', name: 'Subramaniam (Manager)', email: 'manager@shifts.demo', role: 'manager', employeeId: '' },
  { uid: 'emp-001', name: 'Harish',    email: 'ravi@shifts.demo',   role: 'employee', employeeId: 'E001' },
  { uid: 'emp-002', name: 'Surya',     email: 'kumar@shifts.demo',  role: 'employee', employeeId: 'E002' },
  { uid: 'emp-003', name: 'Dileep',    email: 'suresh@shifts.demo', role: 'employee', employeeId: 'E003' },
  { uid: 'emp-004', name: 'Venkatesh', email: 'mahesh@shifts.demo', role: 'employee', employeeId: 'E004' },
  { uid: 'emp-005', name: 'Prasad',    email: 'ramesh@shifts.demo',  role: 'employee', employeeId: 'E005' },
  { uid: 'emp-006', name: 'D K Rao',   email: 'prasad@shifts.demo',  role: 'employee', employeeId: 'E006' },
  { uid: 'emp-007', name: 'S.G.S.N',   email: 'naresh@shifts.demo',  role: 'employee', employeeId: 'E007' },
  { uid: 'emp-008', name: 'Theja',     email: 'venkat@shifts.demo',  role: 'employee', employeeId: 'E008' },
];

// ─── Employees ────────────────────────────────────────────────────────────────

export const MOCK_EMPLOYEES: Employee[] = [
  { id: 'E001', name: 'Harish',    email: 'ravi@shifts.demo',   uid: 'emp-001', active: true },
  { id: 'E002', name: 'Surya',     email: 'kumar@shifts.demo',  uid: 'emp-002', active: true },
  { id: 'E003', name: 'Dileep',    email: 'suresh@shifts.demo', uid: 'emp-003', active: true },
  { id: 'E004', name: 'Venkatesh', email: 'mahesh@shifts.demo', uid: 'emp-004', active: true },
  { id: 'E005', name: 'Prasad',    email: 'ramesh@shifts.demo',  uid: 'emp-005', active: true },
  { id: 'E006', name: 'D K Rao',   email: 'prasad@shifts.demo',  uid: 'emp-006', active: true },
  { id: 'E007', name: 'S.G.S.N',   email: 'naresh@shifts.demo',  uid: 'emp-007', active: true },
  { id: 'E008', name: 'Theja',     email: 'venkat@shifts.demo',  uid: 'emp-008', active: true },
];

// ─── Schedule Period ──────────────────────────────────────────────────────────

export const MOCK_SCHEDULE: SchedulePeriod = {
  id: 'sched-001',
  startDate: d(0),
  endDate: d(22),
  label: `${format(START, 'MMM d')} – ${format(addDays(START, 22), 'MMM d, yyyy')}`,
  isActive: true,
  createdAt: d(0),
  createdBy: 'mgr-001',
  restDaysPublished: false,
};

// ─── Helper: build shift assignment ──────────────────────────────────────────

let _idSeq = 1;
function sa(
  dateOffset: number,
  shiftType: 'day' | 'evening' | 'night',
  employeeId: string,
  hours = 8
): ShiftAssignment {
  return {
    id: `sa-${String(_idSeq++).padStart(4, '0')}`,
    scheduleId: 'sched-001',
    date: d(dateOffset),
    shiftType,
    employeeId,
    hours,
    status: 'scheduled',
  };
}

/**
 * 23-day schedule.
 * Days 0–5   = Cycle 1 working days (cycleDays 1–6)
 * Days 6–7   = Cycle 1 rest days    (cycleDays 7–8)
 * Days 8–13  = Cycle 2 working days (cycleDays 1–6)
 * Days 14–15 = Cycle 2 rest days    (cycleDays 7–8)
 * Days 16–21 = Cycle 3 working days (cycleDays 1–6)
 * Day 22     = Cycle 3 rest day     (cycleDay 7)
 *
 * Shift rotation pattern (simplified for demo):
 *  - Day Shift    → Ravi, Kumar  (+Suresh on some days for 3-person coverage)
 *  - Evening Shift→ Mahesh, Ramesh (+Prasad rotations)
 *  - Night Shift  → Naresh, Venkat (+Anil rotations)
 *  - Rajesh covers extra shifts / causes intentional warnings
 *
 * Intentional warnings included:
 *  1. Day 4 evening shift has 2 employees (minimum coverage satisfied)
 *  2. Anil is over 48h in Cycle 1
 *  3. Rajesh skipped most night shifts (fairness imbalance)
 */
const LEGACY_ASSIGNMENTS: ShiftAssignment[] = [
  // ── CYCLE 1 – Working Days (offsets 0–5) ──────────────────────────────────

  // Day 0
  sa(0, 'day',     'E001'), sa(0, 'day',     'E002'),
  sa(0, 'evening', 'E004'), sa(0, 'evening', 'E005'),
  sa(0, 'night',   'E007'), sa(0, 'night',   'E008'),

  // Day 1
  sa(1, 'day',     'E001'), sa(1, 'day',     'E003'),
  sa(1, 'evening', 'E004'), sa(1, 'evening', 'E006'),
  sa(1, 'night',   'E007'), sa(1, 'night',   'E009'),

  // Day 2
  sa(2, 'day',     'E002'), sa(2, 'day',     'E003'),
  sa(2, 'evening', 'E005'), sa(2, 'evening', 'E006'),
  sa(2, 'night',   'E008'), sa(2, 'night',   'E009'),

  // Day 3
  sa(3, 'day',     'E001'), sa(3, 'day',     'E002'),
  sa(3, 'evening', 'E004'), sa(3, 'evening', 'E005'),
  sa(3, 'night',   'E007'), sa(3, 'night',   'E010'),

  // Day 4 — Evening coverage is kept at the 2-person minimum
  sa(4, 'day',     'E001'), sa(4, 'day',     'E003'),
  sa(4, 'evening', 'E006'), sa(4, 'evening', 'E005'),
  sa(4, 'night',   'E008'), sa(4, 'night',   'E009'),

  // Day 5 — Anil (E009) doing a 16h shift → over-hours warning
  sa(5, 'day',     'E002'), sa(5, 'day',     'E003'),
  sa(5, 'evening', 'E004'), sa(5, 'evening', 'E006'),
  sa(5, 'night',   'E009', 16), sa(5, 'night', 'E010'), // Anil 16h → total 40+16=48 + previous shifts

  // Days 6–7: Cycle 1 REST days → no assignments

  // ── CYCLE 2 – Working Days (offsets 8–13) ────────────────────────────────

  // Day 8
  sa(8, 'day',     'E001'), sa(8, 'day',     'E002'),
  sa(8, 'evening', 'E005'), sa(8, 'evening', 'E006'),
  sa(8, 'night',   'E007'), sa(8, 'night',   'E008'),

  // Day 9
  sa(9, 'day',     'E003'), sa(9, 'day',     'E004'),
  sa(9, 'evening', 'E005'), sa(9, 'evening', 'E006'),
  sa(9, 'night',   'E009'), sa(9, 'night',   'E010'),

  // Day 10
  sa(10, 'day',     'E001'), sa(10, 'day',     'E003'),
  sa(10, 'evening', 'E004'), sa(10, 'evening', 'E005'),
  sa(10, 'night',   'E007'), sa(10, 'night',   'E008'),

  // Day 11
  sa(11, 'day',     'E002'), sa(11, 'day',     'E004'),
  sa(11, 'evening', 'E006'), sa(11, 'evening', 'E010'),
  sa(11, 'night',   'E009'), sa(11, 'night',   'E007'),

  // Day 12
  sa(12, 'day',     'E001'), sa(12, 'day',     'E002'),
  sa(12, 'evening', 'E003'), sa(12, 'evening', 'E005'),
  sa(12, 'night',   'E008'), sa(12, 'night',   'E010'),

  // Day 13
  sa(13, 'day',     'E003'), sa(13, 'day',     'E004'),
  sa(13, 'evening', 'E005'), sa(13, 'evening', 'E006'),
  sa(13, 'night',   'E007'), sa(13, 'night',   'E009'),

  // Days 14–15: Cycle 2 REST days → no assignments

  // Days 16–22: Cycle 3 is left mostly unassigned for manager planning demo
];

function managerOffOffsets(employeeIndex: number): number[] {
  return Array.from({ length: 5 }, (_, offsetIndex) => (employeeIndex * 2 + offsetIndex * 4) % 23);
}

// Demo rotation: each employee works one shift on each working day, rotating
// through Day, Evening, and Night exactly six times in the 23-day period.
export const MOCK_ASSIGNMENTS: ShiftAssignment[] = [];
/* (() => {
  const employees = MOCK_EMPLOYEES.map(employee => employee.id);
  const shiftTypes: Array<'day' | 'evening' | 'night'> = ['day', 'evening', 'night'];
  let sequence = 1;
  return employees.flatMap((employeeId, employeeIndex) => {
    const workOffsets = Array.from({ length: 23 }, (_, offset) => offset);
    return workOffsets.map((dayOffset, workIndex) => ({
      id: `sa-${String(sequence++).padStart(4, '0')}`,
      scheduleId: 'sched-001',
      date: d(dayOffset),
      shiftType: shiftTypes[workIndex % shiftTypes.length],
      employeeId,
      hours: 8,
      status: 'scheduled' as const,
    }));
  });
})(); */

// ─── Availability Records ─────────────────────────────────────────────────────

export const MOCK_AVAILABILITY: Availability[] = [];

// ─── Swap Requests ────────────────────────────────────────────────────────────

export const MOCK_SWAP_REQUESTS: SwapRequest[] = [
  {
    id: 'swap-001',
    requesterId: 'E003',      // Suresh
    targetId: 'E002',          // Kumar
    requesterShiftId: 'sa-0041', // Suresh shift on day 5
    targetShiftId: 'sa-0023',    // Kumar shift on day 5
    reason: 'Family event. Can take Kumar\'s shift on the same date instead.',
    status: 'pending',
    validationWarnings: [],
    createdAt: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"),
  },
  {
    id: 'swap-002',
    requesterId: 'E005',      // Ramesh
    targetId: 'E007',          // Naresh
    requesterShiftId: 'sa-0042', // Ramesh shift
    targetShiftId: 'sa-0061',    // Naresh shift
    reason: 'Requesting to swap shifts on the same date.',
    status: 'approved',
    validationWarnings: [],
    createdAt: format(addDays(new Date(), -2), "yyyy-MM-dd'T'HH:mm:ss"),
    resolvedAt: format(addDays(new Date(), -1), "yyyy-MM-dd'T'HH:mm:ss"),
    resolvedBy: 'mgr-001',
    managerNote: 'Approved. Both employees confirmed.',
  },
  {
    id: 'swap-003',
    requesterId: 'E001',    // Ravi
    targetId: 'E002',        // Kumar
    requesterShiftId: 'sa-0001',
    targetShiftId: 'sa-0002',
    reason: 'Need to swap day 0 day shifts due to transport issue.',
    status: 'rejected',
    validationWarnings: ['Minimum 2 employees per shift would be violated'],
    createdAt: format(addDays(new Date(), -3), "yyyy-MM-dd'T'HH:mm:ss"),
    resolvedAt: format(addDays(new Date(), -2), "yyyy-MM-dd'T'HH:mm:ss"),
    resolvedBy: 'mgr-001',
    managerNote: 'Cannot approve - shift coverage drops below minimum.',
  },
];

// ─── Open Shift Requests ──────────────────────────────────────────────────────

export const MOCK_OPEN_SHIFTS: OpenShiftRequest[] = [
  {
    id: 'open-001',
    originalEmployeeId: 'E006', // Prasad
    shiftId: 'sa-0016',         // Prasad evening day 1
    pickupEmployeeId: 'E008',   // Venkat wants to pick up
    pickupStatus: 'pending',
    status: 'requested',
    reason: 'Sudden illness, cannot attend evening shift on day 1.',
    validationWarnings: [],
    createdAt: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"),
  },
  {
    id: 'open-002',
    originalEmployeeId: 'E004', // Mahesh
    shiftId: 'sa-0009',         // Mahesh evening day 1
    status: 'open',
    reason: 'Emergency leave. Need someone to cover.',
    validationWarnings: ['This shift already has only 2 assigned. Removing will cause shortage.'],
    createdAt: format(addDays(new Date(), -1), "yyyy-MM-dd'T'HH:mm:ss"),
  },
];

// ─── Derived: cycle map for date → cycle info ─────────────────────────────────

export interface CycleInfo {
  cycleNumber: number; // 1 or 2
  cycleDay: number;    // 1–8
  isWorkDay: boolean;
}

export function getCycleInfo(dateOffset: number): CycleInfo {
  const cycleNumber = dateOffset < 8 ? 1 : 2;
  const posInCycle = dateOffset % 8; // 0–7
  const cycleDay = posInCycle + 1;   // 1–8
  const isWorkDay = cycleDay <= 6;
  return { cycleNumber, cycleDay, isWorkDay };
}

export function getDateOffset(date: string): number {
  const target = new Date(date);
  const start = new Date(MOCK_SCHEDULE.startDate);
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}
