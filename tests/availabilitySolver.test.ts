import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solveAvailability, SHIFTS, type FeasibilityInput, type PlannedChoice } from '../src/utils/availabilitySolver';

const dates = Array.from({ length: 23 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
function fixture(count = 8): FeasibilityInput {
  const employees = Array.from({ length: count }, (_, i) => ({ id: `e${i}`, name: `Employee ${i}` }));
  return { dates, employees, restDays: employees.flatMap((e, i) => Array.from({ length: 5 }, (_, j) => ({ employeeId: e.id, date: dates[(i * 3 + j) % 23] }))), fixed: [], preferences: [] };
}
function validate(input: FeasibilityInput, choices: PlannedChoice[]) {
  assert.equal(choices.length, input.employees.length * 18);
  assert.equal(new Set(choices.map(c => `${c.employeeId}|${c.date}`)).size, choices.length);
  for (const employee of input.employees) {
    const own = choices.filter(c => c.employeeId === employee.id);
    for (const shift of SHIFTS) assert.equal(own.filter(c => c.status === shift).length, 6);
    for (let d = 0; d < 22; d++) assert.ok(!(own.some(c => c.date === dates[d] && c.status === 'night') && own.some(c => c.date === dates[d + 1] && c.status === 'day')));
  }
  for (const rest of input.restDays) assert.ok(!choices.some(c => c.employeeId === rest.employeeId && c.date === rest.date));
  for (const fixed of input.fixed) assert.ok(choices.some(c => c.employeeId === fixed.employeeId && c.date === fixed.date && c.status === fixed.status));
  for (const date of dates) {
    const off = input.restDays.filter(c => c.date === date).length;
    const counts = SHIFTS.map(shift => choices.filter(c => c.date === date && c.status === shift).length);
    assert.ok(counts.every(c => c <= (off === 1 ? 3 : 2)));
    assert.ok(counts.filter(c => c > 2).length <= (off === 1 ? 1 : 0));
  }
}
test('finds a complete valid arrangement for eight employees', () => {
  const input = fixture();
  const result = solveAvailability(input);
  assert.equal(result.status, 'feasible', JSON.stringify(result));
  if (result.status === 'feasible') validate(input, result.choices);
});
test('preserves five approved employees while jointly completing the others', () => {
  const input = fixture();
  const baseline = solveAvailability(input);
  assert.equal(baseline.status, 'feasible');
  if (baseline.status !== 'feasible') return;
  input.fixed = baseline.choices.filter(c => ['e0', 'e1', 'e2', 'e3', 'e4'].includes(c.employeeId));
  const result = solveAvailability(input);
  assert.equal(result.status, 'feasible');
  if (result.status === 'feasible') validate(input, result.choices);
});
test('detects the forced Night then Day deadlock on adjacent dates', () => {
  const input = fixture(6);
  // Six workers fit daily capacity. Only the Night -> Day rule makes
  // the two remaining employees' forced choices impossible.
  input.restDays = input.employees.flatMap(e => [18, 19, 20, 21, 22].map(day => ({ employeeId: e.id, date: dates[day] })));
  input.fixed = [
    ...['e0', 'e1'].map(employeeId => ({ employeeId, date: dates[2], status: 'day' as const })),
    ...['e2', 'e3'].map(employeeId => ({ employeeId, date: dates[2], status: 'evening' as const })),
    ...['e0', 'e1'].map(employeeId => ({ employeeId, date: dates[3], status: 'night' as const })),
    ...['e2', 'e3'].map(employeeId => ({ employeeId, date: dates[3], status: 'evening' as const })),
  ];
  const result = solveAvailability(input);
  assert.equal(result.status, 'infeasible');
  if (result.status === 'infeasible') assert.match(result.reason, /Night|sequence/);
});
test('rejects a seventh shift of one type', () => {
  const input = fixture(1);
  input.fixed = dates.slice(5, 12).map(date => ({ employeeId: 'e0', date, status: 'day' }));
  assert.equal(solveAvailability(input).status, 'infeasible');
});
test('allows only one third-person shift on a date with one rest day', () => {
  const input = fixture();
  const date = dates.find(date => input.restDays.filter(r => r.date === date).length === 1)!;
  const workers = input.employees.filter(e => !input.restDays.some(r => r.employeeId === e.id && r.date === date));
  input.fixed = workers.slice(0, 6).map((e, i) => ({ employeeId: e.id, date, status: i < 3 ? 'day' : 'evening' }));
  assert.equal(solveAvailability(input).status, 'infeasible');
});
test('rejects a fixed choice on a rest day', () => {
  const input = fixture();
  input.fixed = [{ ...input.restDays[0], status: 'day' }];
  assert.equal(solveAvailability(input).status, 'invalid');
});
test('rest days break the Night to Day adjacency restriction', () => {
  const input = fixture(1);
  input.restDays = [1, 19, 20, 21, 22].map(day => ({ employeeId: 'e0', date: dates[day] }));
  input.fixed = [{ employeeId: 'e0', date: dates[0], status: 'night' }, { employeeId: 'e0', date: dates[2], status: 'day' }];
  const result = solveAvailability(input);
  assert.equal(result.status, 'feasible');
  if (result.status === 'feasible') validate(input, result.choices);
});
test('does not report an exhausted search as an impossible schedule', () => {
  assert.equal(solveAvailability(fixture(), 0).status, 'timeout');
});
test('rejects an incomplete rest-day plan', () => {
  const input = fixture(); input.restDays.pop();
  assert.equal(solveAvailability(input).status, 'invalid');
});
