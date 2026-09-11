import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { PlannedChoice } from '../src/utils/availabilitySolver';

test('PostgreSQL validates and commits feasible approvals atomically', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create type public.user_role as enum ('manager', 'employee');
      create type public.availability_status as enum ('day', 'evening', 'night', 'off');
      create type public.approval_status as enum ('pending', 'approved', 'rejected', 'resubmit');
      create type public.shift_status as enum ('scheduled', 'open', 'covered', 'absent');
      create function public.current_user_role() returns public.user_role language sql as
        $$ select coalesce(current_setting('app.role', true), 'manager')::public.user_role $$;
      create table public.schedule_periods (id text primary key, start_date date, end_date date, rest_days_published boolean);
      create table public.employees (id text primary key, name text);
      create table public.schedule_period_employees (schedule_id text, employee_id text, availability_approved_at timestamptz, primary key (schedule_id, employee_id));
      create table public.availability (id text primary key, employee_id text, schedule_id text, date date,
        status public.availability_status, approval_status public.approval_status default 'pending', note text, manager_note text,
        unique (employee_id, schedule_id, date));
      create table public.shift_assignments (id text primary key, schedule_id text, employee_id text, date date, shift_type text, hours numeric, status public.shift_status);
      create table public.swap_requests (requester_shift_id text, target_shift_id text, status text);
      create table public.open_shift_requests (shift_id text);
      insert into public.schedule_periods values ('s', '2099-10-01', '2099-10-23', true), ('other', '2099-11-01', '2099-11-23', true);
      insert into public.employees select 'e' || n, 'Employee ' || n from generate_series(0,5) n;
      insert into public.schedule_period_employees select 's', id, case when id = 'e1' then now() else null end from public.employees;
      insert into public.availability (id,employee_id,schedule_id,date,status,approval_status)
        select 'off_' || e.id || '_' || d, e.id, 's', '2099-10-01'::date + d, 'off', 'pending'
        from public.employees e cross join generate_series(18,22) d;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260911_feasible_availability_approval.sql', import.meta.url), 'utf8'));
    const patterns = [['day', 'night', 'evening'], ['evening', 'day', 'night'], ['night', 'evening', 'day']] as const;
    const completion: PlannedChoice[] = Array.from({ length: 6 }, (_, e) => Array.from({ length: 18 }, (_, day) => ({
      employeeId: `e${e}`, date: `2099-10-${String(day + 1).padStart(2, '0')}`,
      status: patterns[Math.floor(e / 2)][Math.floor(day / 6)],
    }))).flat();
    for (const c of completion) {
      await db.query('insert into public.availability (id,employee_id,schedule_id,date,status,approval_status) values ($1,$2,$3,$4,$5,$6)',
        [`av_${c.employeeId}_${c.date}`, c.employeeId, 's', c.date, c.status, c.employeeId === 'e1' ? 'approved' : 'pending']);
      if (c.employeeId === 'e1') await db.query('insert into public.shift_assignments values ($1,$2,$3,$4,$5,8,$6)',
        [`sa_${c.date}`, 's', c.employeeId, c.date, c.status, 'scheduled']);
    }
    const snapshot = async () => (await db.query<{ value: unknown }>('select public.availability_planning_snapshot($1) as value', ['s'])).rows[0].value;
    const original = await snapshot();
    const apply = (choices: PlannedChoice[], expected: unknown = original, repair = false, employee: string | null = 'e0') =>
      db.query('select public.approve_feasible_availability($1,$2,$3::jsonb,$4::jsonb,$5)', ['s', employee, JSON.stringify(expected), JSON.stringify(choices), repair]);
    await t.test('rejects employee access to snapshot and approval', async () => {
      await db.exec("set app.role = 'employee'");
      await assert.rejects(snapshot, /Only managers/);
      await assert.rejects(() => apply(completion), /Only managers/);
      await db.exec("set app.role = 'manager'");
    });
    await t.test('rejects stale previews without changing approval', async () => {
      await db.exec("update public.availability set note = 'new draft' where id = 'av_e0_2099-10-01'");
      await assert.rejects(() => apply(completion), /changed while/);
      await db.exec("update public.availability set note = null where id = 'av_e0_2099-10-01'");
      assert.deepEqual(await snapshot(), original);
    });
    await t.test('rejects missing, duplicate and rest-day choices', async () => {
      await assert.rejects(() => apply(completion.slice(1)), /every employee/);
      await assert.rejects(() => apply(completion.map((c, i) => i === 0 ? completion[1] : c)), /duplicate/);
      await assert.rejects(() => apply(completion.map((c, i) => i === 0 ? { ...c, date: '2099-10-23' } : c)), /rest day/);
    });
    await t.test('rejects invalid quotas and Night to Day sequences', async () => {
      await assert.rejects(() => apply(completion.map((c, i) => i === 0 ? { ...c, status: 'evening' } : c)), /exactly 6/);
      const bad = completion.map(c => ({ ...c }));
      [bad[0].status, bad[6].status] = [bad[6].status, bad[0].status];
      await assert.rejects(() => apply(bad), /Night followed by Day/);
    });
    await t.test('rejects daily overcapacity even if each employee is valid', async () => {
      const bad = completion.map(c => c.employeeId === 'e2' ? { ...c, status: patterns[0][Math.floor((Number(c.date.slice(-2)) - 1) / 6)] } : c);
      await assert.rejects(() => apply(bad), /capacity/);
    });
    // Swapping whole schedules keeps quotas, capacity and adjacency valid.
    const repair = completion.map(c => c.employeeId === 'e1' || c.employeeId === 'e2' ? {
      ...c, status: completion.find(other => other.employeeId === (c.employeeId === 'e1' ? 'e2' : 'e1') && other.date === c.date)!.status,
    } : c);
    await t.test('requires explicit correction review to change approved shifts', async () => {
      await assert.rejects(() => apply(repair), /Review a correction/);
    });
    await t.test('rolls back the entire approval if a later write fails', async () => {
      await db.exec(`create function fail_approval_test() returns trigger language plpgsql as $$
        begin if new.employee_id = 'e1' then raise exception 'Injected write failure'; end if; return new; end $$;
        create trigger fail_approval_test before update on public.availability for each row execute function fail_approval_test();`);
      const before = await snapshot();
      await assert.rejects(() => apply(completion), /Injected write failure/);
      assert.deepEqual(await snapshot(), before);
      await db.exec('drop trigger fail_approval_test on public.availability; drop function fail_approval_test();');
    });
    await t.test('valid approval keeps assignment IDs and leaves other drafts untouched', async () => {
      await apply(completion);
      const state = await snapshot() as any;
      assert.equal(state.assignments.length, 36);
      assert.ok(state.assignments.some((a: any) => a.id === 'sa_2099-10-01'));
      assert.ok(state.availability.filter((a: any) => a.employee_id === 'e2').every((a: any) => a.approval_status === 'pending'));
      assert.ok(state.roster.find((m: any) => m.employee_id === 'e0').availability_approved_at);
      assert.equal((await db.query('select * from public.shift_assignments where schedule_id = $1', ['other'])).rows.length, 0);
    });
    await t.test('correction respects linked pending requests and makes no partial changes', async () => {
      await db.exec("insert into public.swap_requests values ('sa_2099-10-01', 'x', 'pending')");
      const before = await snapshot();
      await assert.rejects(() => apply(repair, before, true, null), /pending swap/);
      assert.deepEqual(await snapshot(), before);
      await db.exec('delete from public.swap_requests');
    });
    await t.test('correction changes approved shifts without approving other employees', async () => {
      await apply(repair, await snapshot(), true, null);
      const state = await snapshot() as any;
      assert.equal(state.assignments.find((a: any) => a.id === 'sa_2099-10-01').shift_type, 'evening');
      assert.equal(state.roster.find((m: any) => m.employee_id === 'e2').availability_approved_at, null);
      assert.equal(state.availability.find((a: any) => a.id === 'av_e2_2099-10-01').status, 'evening');
      assert.equal(state.assignments.length, 36);
    });
  } finally { await db.close(); }
});
