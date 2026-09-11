export const SHIFTS = ['day', 'evening', 'night'] as const;
export type PlannedShift = typeof SHIFTS[number];
export interface PlannedChoice { employeeId: string; date: string; status: PlannedShift }
export interface FeasibilityInput {
  dates: string[];
  employees: { id: string; name: string }[];
  restDays: { employeeId: string; date: string }[];
  fixed: PlannedChoice[];
  preferences: PlannedChoice[];
}
export type FeasibilityResult =
  | { status: 'feasible'; choices: PlannedChoice[] }
  | { status: 'infeasible' | 'timeout' | 'invalid'; reason: string };

// A finite-domain search over the whole roster, not independent employee checks.
// Bits 1/2/4 represent shifts; 8 represents an immutable manager OFF.
const bits = [1, 2, 4];
const sizes = [0, 1, 1, 2, 1, 2, 2, 3, 0];
const size = (mask: number) => sizes[mask];
export function solveAvailability(input: FeasibilityInput, budgetMs = 8000): FeasibilityResult {
  const { dates, employees } = input;
  const width = dates.length;
  const length = width * employees.length;
  const started = Date.now();
  let timedOut = false;
  let branched = false;
  let reason = 'The remaining employees cannot all complete 6 Day, 6 Evening and 6 Night choices with the current fixed shifts.';
  if (width !== 23 || !employees.length || new Set(dates).size !== width || new Set(employees.map(e => e.id)).size !== employees.length
    || dates.some((date, i) => i > 0 && Date.parse(date) - Date.parse(dates[i - 1]) !== 86400000)) {
    return { status: 'invalid', reason: 'A complete 23-day period and a unique employee roster are required.' };
  }
  const indexOf = (item: { employeeId: string; date: string }) => {
    const employee = employees.findIndex(e => e.id === item.employeeId);
    const day = dates.indexOf(item.date);
    return employee < 0 || day < 0 ? -1 : employee * width + day;
  };
  const initial = new Uint8Array(length).fill(7);
  const preferred = new Uint8Array(length);
  const offCounts = dates.map(() => 0);
  const sequenceCache = new Map<string, Uint8Array | null>();
  for (const rest of input.restDays) {
    const index = indexOf(rest);
    if (index < 0 || initial[index] === 8) return { status: 'invalid', reason: 'Rest days contain an unknown employee, date or duplicate.' };
    initial[index] = 8;
    offCounts[index % width]++;
  }
  for (let employee = 0; employee < employees.length; employee++) {
    if (Array.from(initial.slice(employee * width, (employee + 1) * width)).filter(v => v === 8).length !== 5) {
      return { status: 'invalid', reason: `${employees[employee].name} needs exactly 5 manager-assigned rest days before checking availability.` };
    }
  }
  for (const choice of input.preferences) {
    const index = indexOf(choice);
    if (index >= 0) preferred[index] = bits[SHIFTS.indexOf(choice.status)] ?? 0;
  }
  for (const choice of input.fixed) {
    const index = indexOf(choice);
    const bit = bits[SHIFTS.indexOf(choice.status)];
    if (index < 0 || !bit || !(initial[index] & bit)) return { status: 'invalid', reason: 'Fixed shifts conflict with rest days or with another assignment.' };
    initial[index] = bit;
  }

  function propagate(domains: Uint8Array): boolean {
    let changed = true;
    const restrict = (index: number, mask: number) => {
      const next = domains[index] & mask;
      if (next !== domains[index]) { domains[index] = next; changed = true; }
      return next !== 0;
    };
    while (changed) {
      if (Date.now() - started >= budgetMs) { timedOut = true; return false; }
      changed = false;
      for (let employee = 0; employee < employees.length; employee++) {
        const start = employee * width;
        for (let day = 0; day < width - 1; day++) {
          const a = start + day, b = a + 1;
          if ((domains[a] === 4 && !restrict(b, 14)) || (domains[b] === 1 && !restrict(a, 11))) {
            reason = `${employees[employee].name} would be forced into Night on ${dates[day]} followed by Day on ${dates[day + 1]}.`;
            return false;
          }
        }
        // Subset cardinality propagation also catches two shift types competing
        // for too few dates, even when each type separately appears possible.
        for (let subset = 1; subset < 7; subset++) {
          const required = size(subset) * 6;
          let inside = 0, possible = 0;
          for (let day = 0; day < width; day++) {
            const mask = domains[start + day];
            if (mask === 8) continue;
            if (mask & subset) possible++;
            if ((mask & subset) === mask) inside++;
          }
          if (inside > required || possible < required) {
            reason = `${employees[employee].name} cannot reach exactly 6 choices of each shift with the available dates.`;
            return false;
          }
          for (let day = 0; day < width; day++) {
            const index = start + day, mask = domains[index];
            if (mask === 8) continue;
            if (inside === required && (mask & subset) !== mask && !restrict(index, 7 ^ subset)) return false;
            if (possible === required && (mask & subset) && !restrict(index, subset)) return false;
          }
        }
      }
      for (let day = 0; day < width; day++) {
        for (let subset = 1; subset <= 7; subset++) {
          const capacity = size(subset) * 2 + (offCounts[day] === 1 ? 1 : 0);
          let inside = 0;
          for (let employee = 0; employee < employees.length; employee++) {
            const mask = domains[employee * width + day];
            if (mask !== 8 && (mask & subset) === mask) inside++;
          }
          if (inside > capacity) { reason = `There are not enough compatible shift slots on ${dates[day]}.`; return false; }
          if (inside === capacity) {
            for (let employee = 0; employee < employees.length; employee++) {
              const index = employee * width + day, mask = domains[index];
              if (mask !== 8 && (mask & subset) !== mask && !restrict(index, 7 ^ subset)) return false;
            }
          }
        }
      }
      // Forward/backward path consistency checks each employee's entire
      // sequence, including quotas, before exploring another shared slot.
      for (let employee = 0; employee < employees.length; employee++) {
        const start = employee * width;
        const cacheKey = domains.slice(start, start + width).join('');
        if (sequenceCache.has(cacheKey)) {
          const cached = sequenceCache.get(cacheKey);
          if (!cached) {
            reason = `${employees[employee].name} has no valid sequence satisfying 6/6/6 totals and the Night to Day restriction.`;
            return false;
          }
          for (let day = 0; day < width; day++) if (!restrict(start + day, cached[day])) return false;
          continue;
        }
        const reachable = Array.from({ length: width + 1 }, () => new Uint8Array(98));
        reachable[0][0] = 1;
        let work = 0;
        const workBefore = [0];
        const nextState = (state: number, bit: number, worked: number) => {
          const dayCount = Math.floor(state / 14), eveningCount = Math.floor(state / 2) % 7, lastNight = state % 2;
          if (bit === 8) return state - lastNight;
          if ((bit === 1 && (lastNight || dayCount === 6)) || (bit === 2 && eveningCount === 6)
            || (bit === 4 && worked - dayCount - eveningCount >= 6)) return -1;
          return ((dayCount + Number(bit === 1)) * 7 + eveningCount + Number(bit === 2)) * 2 + Number(bit === 4);
        };
        for (let day = 0; day < width; day++) {
          const mask = domains[start + day];
          for (let state = 0; state < 98; state++) if (reachable[day][state]) {
            for (const bit of mask === 8 ? [8] : bits) if (mask & bit) {
              const next = nextState(state, bit, work);
              if (next >= 0) reachable[day + 1][next] = 1;
            }
          }
          if (mask !== 8) work++;
          workBefore.push(work);
        }
        let suffix = new Uint8Array(98);
        suffix[96] = reachable[width][96]; suffix[97] = reachable[width][97];
        if (!suffix[96] && !suffix[97]) {
          sequenceCache.set(cacheKey, null);
          reason = `${employees[employee].name} has no valid sequence satisfying 6/6/6 totals and the Night to Day restriction.`;
          return false;
        }
        for (let day = width - 1; day >= 0; day--) {
          const mask = domains[start + day], previous = new Uint8Array(98);
          let support = 0;
          for (let state = 0; state < 98; state++) if (reachable[day][state]) {
            for (const bit of mask === 8 ? [8] : bits) if (mask & bit) {
              const next = nextState(state, bit, workBefore[day]);
              if (next >= 0 && suffix[next]) { previous[state] = 1; support |= bit; }
            }
          }
          if (!restrict(start + day, support)) return false;
          suffix = previous;
        }
        if (sequenceCache.size > 5000) sequenceCache.clear();
        sequenceCache.set(cacheKey, domains.slice(start, start + width));
      }
    }
    return true;
  }

  function search(domains: Uint8Array): Uint8Array | null {
    if (!propagate(domains)) return null;
    let selected = -1, bestScore = Infinity;
    for (let index = 0; index < length; index++) {
      const count = size(domains[index]);
      if (count <= 1) continue;
      const row = Math.floor(index / width) * width;
      let unsettled = 0;
      for (let d = 0; d < width; d++) if (size(domains[row + d]) > 1) unsettled++;
      const score = count * 1000 + (index % width) * 25 + unsettled;
      if (score < bestScore) { bestScore = score; selected = index; }
    }
    if (selected < 0) return domains;
    branched = true;
    const candidates = bits.filter(bit => domains[selected] & bit).sort((a, b) =>
      Number(b === preferred[selected]) - Number(a === preferred[selected]));
    for (const bit of candidates) {
      const next = domains.slice();
      next[selected] = bit;
      const result = search(next);
      if (result) return result;
      if (timedOut) return null;
    }
    return null;
  }
  const solution = search(initial);
  if (!solution) return timedOut
    ? { status: 'timeout', reason: 'The schedule check reached its time limit. No changes were made; feasibility has not been established. Try again or revise the choices.' }
    : { status: 'infeasible', reason: branched
      ? 'No complete team arrangement fits the current fixed choices, shift capacities, 6/6/6 totals and Night to Day restriction. Find a correction to review compatible changes.'
      : reason };
  return {
    status: 'feasible',
    choices: Array.from(solution).flatMap((mask, index) => mask === 8 ? [] : [{
      employeeId: employees[Math.floor(index / width)].id,
      date: dates[index % width], status: SHIFTS[bits.indexOf(mask)],
    }]),
  };
}
