// ─── User & Auth ───────────────────────────────────────────────────────────────

export type UserRole = 'manager' | 'employee';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  employeeId: string;
  isApproved?: boolean;
  registrationStatus?: 'pending' | 'approved' | 'rejected';
  isRealSignup?: boolean;
}

// ─── Employee ──────────────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  name: string;
  email: string;
  uid?: string;
  active: boolean;
  availabilitySubmittedAt?: string;
  availabilityDeadlineOverride?: boolean;
  availabilityWave?: number;
  availabilityApprovedAt?: string;
  joinDate?: string;
  // Permanent pair identity used for availability-order fairness.
  availabilityPairIndex?: number;
}

// ─── Shifts ────────────────────────────────────────────────────────────────────

export type ShiftType = 'day' | 'evening' | 'night';
export type ShiftStatus = 'scheduled' | 'open' | 'covered' | 'absent';

export const SHIFT_LABELS: Record<ShiftType, string> = {
  day: 'Day',
  evening: 'Evening',
  night: 'Night',
};

export const SHIFT_TIMES: Record<ShiftType, string> = {
  day: '06:00–14:00',
  evening: '14:00–22:00',
  night: '22:00–06:00',
};

export const SHIFT_COLORS: Record<ShiftType, string> = {
  day: 'bg-amber-100 text-amber-800 border-amber-200',
  evening: 'bg-blue-100 text-blue-800 border-blue-200',
  night: 'bg-indigo-100 text-indigo-800 border-indigo-200',
};

// ─── Shift Assignment ──────────────────────────────────────────────────────────

export interface ShiftAssignment {
  id: string;
  scheduleId: string;
  date: string; // YYYY-MM-DD
  shiftType: ShiftType;
  employeeId: string;
  hours: number; // 8, 12, or 16
  status: ShiftStatus;
  notes?: string;
}

// ─── Schedule ──────────────────────────────────────────────────────────────────

export interface SchedulePeriod {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;     // e.g. "Period Jan 1–23"
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  restDaysPublished?: boolean;
  availabilityDeadline?: string;
  sourceScheduleId?: string;
  availabilityPriority?: number;
}

export interface ScheduleDay {
  date: string;         // YYYY-MM-DD
  cycleDay: number;     // 1–8 within cycles 1 and 2, 1–7 within cycle 3
  cycleNumber: number;  // 1, 2, or 3 within the 23-day period
  isWorkDay: boolean;   // false for the rest days at the end of each cycle
  dayAssignments: ShiftAssignment[];
  eveningAssignments: ShiftAssignment[];
  nightAssignments: ShiftAssignment[];
}

// ─── Availability ──────────────────────────────────────────────────────────────

export type AvailabilityStatus = 'day' | 'evening' | 'night' | 'off';

export interface Availability {
  id: string;
  employeeId: string;
  scheduleId: string;
  date: string;
  status: AvailabilityStatus;
  note?: string;
  submittedAt: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'resubmit';
  managerNote?: string;
}

// ─── Swap Requests ─────────────────────────────────────────────────────────────

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface SwapRequest {
  id: string;
  requesterId: string;       // employee who wants to swap
  targetId: string;          // employee they want to swap with
  requesterShiftId: string;  // requester's shift
  targetShiftId: string;     // target's shift
  reason: string;
  status: RequestStatus;
  validationWarnings: string[];
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  managerNote?: string;
}

// ─── Open Shift Pool ──────────────────────────────────────────────────────────

export type OpenShiftStatus = 'open' | 'requested' | 'filled' | 'rejected' | 'cancelled';

export interface OpenShiftRequest {
  id: string;
  originalEmployeeId: string;
  shiftId: string;
  pickupEmployeeId?: string;
  pickupStatus?: RequestStatus;
  status: OpenShiftStatus;
  reason: string;
  validationWarnings: string[];
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  managerNote?: string;
}

/** An employee's individual application to cover an open shift. */
export interface OpenShiftPickupRequest {
  id: string;
  openShiftId: string;
  employeeId: string;
  status: RequestStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  managerNote?: string;
  validationWarnings: string[];
}

// ─── Analytics & Summaries ────────────────────────────────────────────────────

export interface CycleSummary {
  employeeId: string;
  employeeName: string;
  cycleNumber: 1 | 2 | 3;
  totalHours: number;
  dayHours: number;
  eveningHours: number;
  nightHours: number;
  workDays: number;
  isUnder: boolean; // < 48
  isOver: boolean;  // > 48
}

export interface FairnessSummary {
  employeeId: string;
  employeeName: string;
  dayHours: number;
  eveningHours: number;
  nightHours: number;
  dayNeeded: number;    // 48 - dayHours (clamped at 0)
  eveningNeeded: number;
  nightNeeded: number;
  hasWarning: boolean;
}

export interface DashboardSummary {
  totalShifts: number;
  shiftsWithShortage: number;
  pendingSwapRequests: number;
  pendingOpenShiftRequests: number;
  employeesBelowHours: number;
  employeesAboveHours: number;
  employeesWithFairnessWarnings: number;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type WarningSeverity = 'error' | 'warning' | 'info';
export type WarningType = 'shortage' | 'hours_under' | 'hours_over' | 'fairness' | 'overlap' | 'cycle';

export interface ValidationWarning {
  type: WarningType;
  message: string;
  severity: WarningSeverity;
  employeeId?: string;
  date?: string;
  shiftType?: ShiftType;
}
