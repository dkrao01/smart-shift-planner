import type {
  ShiftAssignment, ShiftType, Employee,
  CycleSummary, FairnessSummary, DashboardSummary,
  ValidationWarning
} from '../types';
import { getCycleDay } from './dateUtils';

const TARGET_CYCLE_HOURS = 48;
const FAIRNESS_TARGET = 48; // per shift type per 23-day period
type CycleNumber = 1 | 2 | 3;

// ─── Hours Calculations ───────────────────────────────────────────────────────

/** Total hours an employee works in a given set of assignments */
export function calculateEmployeeHours(assignments: ShiftAssignment[], employeeId: string): number {
  return assignments
    .filter(a => a.employeeId === employeeId)
    .reduce((sum, a) => sum + a.hours, 0);
}

/** Hours by shift type for an employee */
export function calculateShiftTypeHours(
  assignments: ShiftAssignment[],
  employeeId: string
): Record<ShiftType, number> {
  const result: Record<ShiftType, number> = { day: 0, evening: 0, night: 0 };
  assignments
    .filter(a => a.employeeId === employeeId)
    .forEach(a => { result[a.shiftType] += a.hours; });
  return result;
}

/** Hours in a specific cycle for the 23-day period. */
export function calculateEmployeeHoursByCycle(
  assignments: ShiftAssignment[],
  employeeId: string,
  scheduleStartDate: string,
  cycleNumber: CycleNumber
): number {
  return assignments
    .filter(a => {
      if (a.employeeId !== employeeId) return false;
      const offset = dayOffset(a.date, scheduleStartDate);
      const { cycleNumber: cn } = getCycleDay(offset);
      return cn === cycleNumber;
    })
    .reduce((sum, a) => sum + a.hours, 0);
}

function dayOffset(date: string, startDate: string): number {
  const d1 = new Date(date).getTime();
  const d0 = new Date(startDate).getTime();
  return Math.round((d1 - d0) / 86400000);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Check the 48h rule for each employee in one cycle. */
export function validate48HourRule(
  assignments: ShiftAssignment[],
  employees: Employee[],
  scheduleStartDate: string,
  cycleNumber: CycleNumber
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  employees.forEach(emp => {
    const hours = calculateEmployeeHoursByCycle(assignments, emp.id, scheduleStartDate, cycleNumber);
    if (hours < TARGET_CYCLE_HOURS) {
      warnings.push({
        type: 'hours_under',
        message: `${emp.name} has only ${hours}h in Cycle ${cycleNumber} (needs ${TARGET_CYCLE_HOURS}h)`,
        severity: 'warning',
        employeeId: emp.id,
      });
    } else if (hours > TARGET_CYCLE_HOURS) {
      warnings.push({
        type: 'hours_over',
        message: `${emp.name} has ${hours}h in Cycle ${cycleNumber} (exceeds ${TARGET_CYCLE_HOURS}h)`,
        severity: 'warning',
        employeeId: emp.id,
      });
    }
  });
  return warnings;
}

/** Check minimum 2 employees per shift per day */
export function validateShiftCoverage(
  assignments: ShiftAssignment[],
  scheduleStartDate: string
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const MIN_PER_SHIFT = 2;

  // Group by date + shiftType
  const map: Record<string, ShiftAssignment[]> = {};
  assignments.forEach(a => {
    const key = `${a.date}|${a.shiftType}`;
    if (!map[key]) map[key] = [];
    map[key].push(a);
  });

  Object.entries(map).forEach(([key, list]) => {
    const [date, shiftType] = key.split('|') as [string, ShiftType];
    const offset = dayOffset(date, scheduleStartDate);
    const { isWorkDay } = getCycleDay(offset);

    if (isWorkDay && list.length < MIN_PER_SHIFT) {
      warnings.push({
        type: 'shortage',
        message: `${shiftType.charAt(0).toUpperCase() + shiftType.slice(1)} shift on ${date} has only ${list.length} employee (needs ${MIN_PER_SHIFT})`,
        severity: 'error',
        date,
        shiftType,
      });
    }
  });

  return warnings;
}

/** Check if a swap would be valid */
export function validateSwapEligibility(
  assignments: ShiftAssignment[],
  employees: Employee[],
  requesterShiftId: string,
  targetShiftId: string,
  scheduleStartDate: string
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const reqShift = assignments.find(a => a.id === requesterShiftId);
  const tgtShift = assignments.find(a => a.id === targetShiftId);
  if (!reqShift || !tgtShift) {
    warnings.push({ type: 'overlap', message: 'One or both shifts not found.', severity: 'error' });
    return warnings;
  }

  if (reqShift.date !== tgtShift.date) {
    warnings.push({
      type: 'overlap',
      message: 'A shift can only be swapped with another employee working on the same date.',
      severity: 'error',
      date: reqShift.date,
    });
    return warnings;
  }

  if (reqShift.shiftType === tgtShift.shiftType) {
    warnings.push({
      type: 'overlap',
      message: 'A swap must change the shift type; swapping the same shift type has no effect.',
      severity: 'error',
      date: reqShift.date,
      shiftType: reqShift.shiftType,
    });
    return warnings;
  }

  if (!isAllowedSwapDirection(reqShift.shiftType, tgtShift.shiftType)) {
    warnings.push({
      type: 'overlap',
      message: `${reqShift.shiftType.charAt(0).toUpperCase() + reqShift.shiftType.slice(1)} shifts can only be swapped with ${allowedSwapLabels(reqShift.shiftType)} shifts.`,
      severity: 'error',
      date: reqShift.date,
      shiftType: reqShift.shiftType,
    });
    return warnings;
  }

  const simulated = assignments.map(assignment => {
    if (assignment.id === requesterShiftId) return { ...assignment, employeeId: tgtShift.employeeId };
    if (assignment.id === targetShiftId) return { ...assignment, employeeId: reqShift.employeeId };
    return assignment;
  });

  for (const employee of [reqShift.employeeId, tgtShift.employeeId]) {
    const employeeShifts = simulated
      .filter(a => a.employeeId === employee)
      .sort((a, b) => shiftStart(a) - shiftStart(b));
    for (let index = 1; index < employeeShifts.length; index += 1) {
      const previous = employeeShifts[index - 1];
      const current = employeeShifts[index];
      const restHours = (shiftStart(current) - shiftEnd(previous)) / (60 * 60 * 1000);
      if (restHours < 8) {
        warnings.push({
          type: 'overlap',
          message: `${employee === reqShift.employeeId ? 'Requester' : 'Target employee'} would have only ${Math.max(0, restHours).toFixed(1)}h before the next shift. At least 8h rest is required.`,
          severity: 'error',
        });
      }
    }
  }

  return warnings;
}

function shiftStart(assignment: ShiftAssignment): number {
  const date = new Date(`${assignment.date}T00:00:00Z`);
  date.setUTCHours(assignment.shiftType === 'day' ? 6 : assignment.shiftType === 'evening' ? 14 : 22);
  return date.getTime();
}

function shiftEnd(assignment: ShiftAssignment): number {
  return shiftStart(assignment) + assignment.hours * 60 * 60 * 1000;
}

function isAllowedSwapDirection(requesterType: ShiftType, targetType: ShiftType): boolean {
  if (requesterType === 'day') return targetType === 'evening';
  if (requesterType === 'night') return targetType === 'evening';
  return targetType === 'day' || targetType === 'night';
}

function allowedSwapLabels(requesterType: ShiftType): string {
  if (requesterType === 'day' || requesterType === 'night') return 'Evening';
  return 'Day or Night';
}

/** Employees working an allowed same-day shift for a manager assignment. */
export function getEligibleScheduleEmployees(
  assignments: ShiftAssignment[],
  employees: Employee[],
  date: string,
  targetShiftType: ShiftType
): Employee[] {
  const allowedSourceTypes: ShiftType[] = targetShiftType === 'evening'
    ? ['day', 'night']
    : ['evening'];
  const assignedToTarget = new Set(
    assignments.filter(a => a.date === date && a.shiftType === targetShiftType).map(a => a.employeeId)
  );
  const eligibleIds = new Set(
    assignments
      .filter(a => a.date === date && allowedSourceTypes.includes(a.shiftType))
      .map(a => a.employeeId)
  );
  return employees.filter(employee => eligibleIds.has(employee.id) && !assignedToTarget.has(employee.id));
}

export interface ScheduleEmployeeOption {
  employee: Employee;
  eligible: boolean;
  reason: 'off' | 'assigned' | 'unassigned';
  currentShift?: ShiftType;
}

/** Show every employee's date status while allowing only conflict-free additions. */
export function getScheduleEmployeeOptions(
  assignments: ShiftAssignment[],
  employees: Employee[],
  date: string,
  targetShiftType: ShiftType,
  offEmployeeIds: Set<string>
): ScheduleEmployeeOption[] {
  const allowedSourceTypes: ShiftType[] = targetShiftType === 'evening'
    ? ['day', 'night']
    : ['evening'];
  const assignedToTarget = new Set(
    assignments.filter(a => a.date === date && a.shiftType === targetShiftType).map(a => a.employeeId)
  );

  return employees.flatMap((employee): ScheduleEmployeeOption[] => {
    if (assignedToTarget.has(employee.id)) return [];
    const sameDayAssignments = assignments.filter(a => a.date === date && a.employeeId === employee.id);
    const sameDayAssignment = sameDayAssignments.find(a => allowedSourceTypes.includes(a.shiftType));
    if (offEmployeeIds.has(employee.id)) {
      return [{ employee, eligible: true, reason: 'off' as const, currentShift: sameDayAssignment?.shiftType }];
    }
    if (sameDayAssignment) {
      return [{ employee, eligible: true, reason: 'assigned' as const, currentShift: sameDayAssignment.shiftType }];
    }
    if (sameDayAssignments.length === 0) {
      return [{ employee, eligible: true, reason: 'unassigned' as const }];
    }
    return [];
  });
}

/** Return only target shifts that can be exchanged without schedule conflicts. */
export function getEligibleSwapOptions(
  assignments: ShiftAssignment[],
  employees: Employee[],
  requesterShiftId: string,
  scheduleStartDate: string
): Array<{ employee: Employee; shift: ShiftAssignment }> {
  const requesterShift = assignments.find(a => a.id === requesterShiftId);
  if (!requesterShift) return [];

  return employees
    .filter(employee => employee.id !== requesterShift.employeeId)
    .filter(employee => assignments.some(a => a.employeeId === employee.id))
    .flatMap(employee => assignments
      .filter(a => a.employeeId === employee.id)
      .filter(a => a.date === requesterShift.date)
      .filter(a => isAllowedSwapDirection(requesterShift.shiftType, a.shiftType))
      .filter(targetShift => validateSwapEligibility(
        assignments, employees, requesterShiftId, targetShift.id, scheduleStartDate
      ).length === 0)
      .map(shift => ({ employee, shift }))
    );
}

/** Check open shift pickup validity */
export function validateOpenShiftPickup(
  assignments: ShiftAssignment[],
  employees: Employee[],
  shiftId: string,
  pickupEmployeeId: string,
  scheduleStartDate: string
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const shift = assignments.find(a => a.id === shiftId);
  if (!shift) {
    warnings.push({ type: 'overlap', message: 'Shift not found.', severity: 'error' });
    return warnings;
  }

  // Check overlap
  const existing = assignments.filter(
    a => a.employeeId === pickupEmployeeId && a.date === shift.date
  );
  if (existing.length > 0) {
    warnings.push({ type: 'overlap', message: 'Employee already has a shift on this date.', severity: 'error' });
  }

  // Check 48h cycle
  const offset = dayOffset(shift.date, scheduleStartDate);
  const { cycleNumber } = getCycleDay(offset);
  const currentHours = calculateEmployeeHoursByCycle(assignments, pickupEmployeeId, scheduleStartDate, cycleNumber);
  if (currentHours + shift.hours > TARGET_CYCLE_HOURS) {
    warnings.push({ type: 'hours_over', message: `Picking up this shift would give ${pickupEmployeeId} ${currentHours + shift.hours}h in Cycle ${cycleNumber} (max ${TARGET_CYCLE_HOURS}h).`, severity: 'warning' });
  }

  return warnings;
}

// ─── Summaries ────────────────────────────────────────────────────────────────

export function getEmployeeCycleSummary(
  assignments: ShiftAssignment[],
  employees: Employee[],
  scheduleStartDate: string,
  cycleNumber: CycleNumber
): CycleSummary[] {
  return employees.map(emp => {
    const empAssignments = assignments.filter(a => {
      if (a.employeeId !== emp.id) return false;
      const offset = dayOffset(a.date, scheduleStartDate);
      const { cycleNumber: cn } = getCycleDay(offset);
      return cn === cycleNumber;
    });

    const totalHours = empAssignments.reduce((s, a) => s + a.hours, 0);
    const dayHours = empAssignments.filter(a => a.shiftType === 'day').reduce((s, a) => s + a.hours, 0);
    const eveningHours = empAssignments.filter(a => a.shiftType === 'evening').reduce((s, a) => s + a.hours, 0);
    const nightHours = empAssignments.filter(a => a.shiftType === 'night').reduce((s, a) => s + a.hours, 0);
    const workDays = new Set(empAssignments.map(a => a.date)).size;

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      cycleNumber,
      totalHours,
      dayHours,
      eveningHours,
      nightHours,
      workDays,
      isUnder: totalHours < TARGET_CYCLE_HOURS,
      isOver: totalHours > TARGET_CYCLE_HOURS,
    };
  });
}

export function getEmployeeFairnessSummary(
  assignments: ShiftAssignment[],
  employees: Employee[],
  scheduleStartDate?: string
): FairnessSummary[] {
  return employees.map(emp => {
    const periodAssignments = scheduleStartDate
      ? assignments.filter(a => {
        const offset = dayOffset(a.date, scheduleStartDate);
        return offset >= 0 && offset < 23;
      })
      : assignments;
    const { day, evening, night } = calculateShiftTypeHours(periodAssignments, emp.id);
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      dayHours: day,
      eveningHours: evening,
      nightHours: night,
      dayNeeded: Math.max(0, FAIRNESS_TARGET - day),
      eveningNeeded: Math.max(0, FAIRNESS_TARGET - evening),
      nightNeeded: Math.max(0, FAIRNESS_TARGET - night),
      hasWarning: day !== FAIRNESS_TARGET || evening !== FAIRNESS_TARGET || night !== FAIRNESS_TARGET,
    };
  });
}

export function getDashboardSummary(
  assignments: ShiftAssignment[],
  employees: Employee[],
  scheduleStartDate: string,
  pendingSwaps: number,
  pendingOpenShifts: number
): DashboardSummary {
  const coverageWarnings = validateShiftCoverage(assignments, scheduleStartDate);
  const c1 = validate48HourRule(assignments, employees, scheduleStartDate, 1);
  const c2 = validate48HourRule(assignments, employees, scheduleStartDate, 2);
  const c3 = validate48HourRule(assignments, employees, scheduleStartDate, 3);
  const fairness = getEmployeeFairnessSummary(assignments, employees, scheduleStartDate);

  const belowIds = new Set([...c1, ...c2, ...c3].filter(w => w.type === 'hours_under').map(w => w.employeeId!));
  const aboveIds = new Set([...c1, ...c2, ...c3].filter(w => w.type === 'hours_over').map(w => w.employeeId!));

  return {
    totalShifts: assignments.length,
    shiftsWithShortage: coverageWarnings.filter(w => w.type === 'shortage').length,
    pendingSwapRequests: pendingSwaps,
    pendingOpenShiftRequests: pendingOpenShifts,
    employeesBelowHours: belowIds.size,
    employeesAboveHours: aboveIds.size,
    employeesWithFairnessWarnings: fairness.filter(f => f.hasWarning).length,
  };
}

export function getFairnessWarnings(fairness: FairnessSummary[]): ValidationWarning[] {
  return fairness
    .filter(f => f.hasWarning)
    .flatMap(f => {
      const w: ValidationWarning[] = [];
      if (f.dayNeeded > 0) w.push({ type: 'fairness', message: `${f.employeeName} needs ${f.dayNeeded}h more Day shifts for rotation balance.`, severity: 'warning', employeeId: f.employeeId });
      if (f.eveningNeeded > 0) w.push({ type: 'fairness', message: `${f.employeeName} needs ${f.eveningNeeded}h more Evening shifts for rotation balance.`, severity: 'warning', employeeId: f.employeeId });
      if (f.nightNeeded > 0) w.push({ type: 'fairness', message: `${f.employeeName} needs ${f.nightNeeded}h more Night shifts for rotation balance.`, severity: 'warning', employeeId: f.employeeId });
      return w;
    });
}
