-- Apply after the availability pair-queue migration.
-- The browser finds a complete arrangement. PostgreSQL independently validates
-- that arrangement and atomically approves against the unchanged snapshot.
create or replace function public.availability_planning_snapshot(p_schedule_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'manager'::public.user_role then
    raise exception 'Only managers can plan approvals.';
  end if;
  if not exists (select 1 from public.schedule_periods where id = p_schedule_id) then
    raise exception 'Schedule period not found.';
  end if;
  return jsonb_build_object(
    'schedule', (select to_jsonb(s) from public.schedule_periods s where s.id = p_schedule_id),
    'roster', (select coalesce(jsonb_agg(to_jsonb(m) order by m.employee_id), '[]'::jsonb) from public.schedule_period_employees m where m.schedule_id = p_schedule_id),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by e.id), '[]'::jsonb) from public.employees e where exists (select 1 from public.schedule_period_employees m where m.schedule_id = p_schedule_id and m.employee_id = e.id)),
    'availability', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from public.availability a where a.schedule_id = p_schedule_id),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from public.shift_assignments a where a.schedule_id = p_schedule_id)
  );
end;
$$;

create or replace function public.approve_feasible_availability(
  p_schedule_id text,
  p_employee_id text,
  p_expected_snapshot jsonb,
  p_completion jsonb,
  p_allow_changes boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule public.schedule_periods;
  v_write_ids text[];
  v_employee_id text;
  v_choice record;
  v_roster_count integer;
begin
  if public.current_user_role() is distinct from 'manager'::public.user_role then
    raise exception 'Only managers can approve availability.';
  end if;
  -- These short write locks also serialize with legacy table updates and
  -- employee save/clear RPCs, which do not use advisory locks. Search runs
  -- outside the transaction; only validation and writes hold these locks.
  lock table public.schedule_periods, public.schedule_period_employees,
    public.availability, public.shift_assignments in share row exclusive mode;
  if p_expected_snapshot is distinct from public.availability_planning_snapshot(p_schedule_id) then
    raise exception 'Availability changed while this plan was being checked. Please check again.';
  end if;
  select * into v_schedule from public.schedule_periods where id = p_schedule_id;
  if v_schedule.rest_days_published is not true or v_schedule.end_date - v_schedule.start_date <> 22 then
    raise exception 'Publish a complete 23-day rest-day plan first.';
  end if;
  if v_schedule.start_date <= (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Automatic planning is only available before the period starts.';
  end if;
  select count(*) into v_roster_count from public.schedule_period_employees where schedule_id = p_schedule_id;
  if v_roster_count = 0 then raise exception 'The period has no employees.'; end if;
  if p_employee_id is not null and not exists (
    select 1 from public.schedule_period_employees where schedule_id = p_schedule_id and employee_id = p_employee_id
  ) then raise exception 'This employee is not in the period roster.'; end if;
  if p_employee_id is null and p_allow_changes is not true then
    raise exception 'Select an employee to approve.';
  end if;
  if p_employee_id is not null and (
    select count(*) from public.availability
    where schedule_id = p_schedule_id and employee_id = p_employee_id and status in ('day', 'evening', 'night')
  ) <> 18 then raise exception 'Employee must complete all 18 working-day choices before approval.'; end if;

  if jsonb_typeof(p_completion) is distinct from 'array' or jsonb_array_length(p_completion) <> v_roster_count * 18 then
    raise exception 'The proposed arrangement must include every employee and working day.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_completion) as c("employeeId" text, date date, status text)
    where c."employeeId" is null or c.date is null or c.status is null
      or c.status not in ('day', 'evening', 'night')
      or c.date not between v_schedule.start_date and v_schedule.end_date
      or not exists (select 1 from public.schedule_period_employees m where m.schedule_id = p_schedule_id and m.employee_id = c."employeeId")
  ) or exists (
    select 1 from jsonb_to_recordset(p_completion) as c("employeeId" text, date date)
    group by c."employeeId", c.date having count(*) <> 1
  ) then raise exception 'The arrangement contains invalid or duplicate choices.'; end if;
  if exists (
    select 1 from public.schedule_period_employees m
    where m.schedule_id = p_schedule_id and (
      select count(*) from public.availability a where a.schedule_id = p_schedule_id and a.employee_id = m.employee_id
        and a.status = 'off' and a.date between v_schedule.start_date and v_schedule.end_date
    ) <> 5
  ) then raise exception 'Each employee needs exactly 5 manager-assigned rest days.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_completion) as c("employeeId" text, date date)
    join public.availability a on a.schedule_id = p_schedule_id and a.employee_id = c."employeeId" and a.date = c.date and a.status = 'off'
  ) then raise exception 'The arrangement changes a manager-assigned rest day.'; end if;
  if exists (
    select 1 from public.schedule_period_employees m cross join (values ('day'), ('evening'), ('night')) as s(status)
    where m.schedule_id = p_schedule_id and (
      select count(*) from jsonb_to_recordset(p_completion) as c("employeeId" text, status text)
      where c."employeeId" = m.employee_id and c.status = s.status
    ) <> 6
  ) then raise exception 'Every employee must have exactly 6 Day, 6 Evening and 6 Night shifts.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_completion) as a("employeeId" text, date date, status text)
    join jsonb_to_recordset(p_completion) as b("employeeId" text, date date, status text)
      on a."employeeId" = b."employeeId" and b.date = a.date + 1
    where a.status = 'night' and b.status = 'day'
  ) then raise exception 'The arrangement contains a Night followed by Day.'; end if;
  if exists (
    with counts as (
      select c.date, c.status, count(*) as total
      from jsonb_to_recordset(p_completion) as c(date date, status text) group by c.date, c.status
    ), daily as (
      select date, max(total) as largest, count(*) filter (where total > 2) as triples from counts group by date
    )
    select 1 from daily d
    where d.largest > case when (select count(*) from public.availability a where a.schedule_id = p_schedule_id and a.date = d.date and a.status = 'off') = 1 then 3 else 2 end
      or d.triples > 1
  ) then raise exception 'The arrangement exceeds daily shift capacity.'; end if;

  -- Existing assignments are authoritative. Reject legacy rows outside the
  -- roster instead of silently excluding them from the capacity proof.
  if exists (
    select 1 from public.shift_assignments a where a.schedule_id = p_schedule_id and (
      a.date not between v_schedule.start_date and v_schedule.end_date or not exists (
        select 1 from public.schedule_period_employees m where m.schedule_id = p_schedule_id and m.employee_id = a.employee_id
      )
    )
  ) or exists (
    select 1 from public.shift_assignments where schedule_id = p_schedule_id group by employee_id, date having count(*) > 1
  ) then raise exception 'Existing assignments contain duplicate dates or employees outside this roster. Repair those records first.'; end if;
  select coalesce(array_agg(m.employee_id), array[]::text[]) into v_write_ids
  from public.schedule_period_employees m where m.schedule_id = p_schedule_id and (
    m.employee_id = p_employee_id or m.availability_approved_at is not null
    or exists (select 1 from public.availability a where a.schedule_id = p_schedule_id and a.employee_id = m.employee_id and a.status <> 'off' and a.approval_status = 'approved')
    or exists (select 1 from public.shift_assignments a where a.schedule_id = p_schedule_id and a.employee_id = m.employee_id)
  );
  if p_allow_changes is not true and (
    exists (
      select 1 from public.availability a where a.schedule_id = p_schedule_id and a.status <> 'off'
        and (a.employee_id = p_employee_id or a.approval_status = 'approved') and not exists (
          select 1 from jsonb_to_recordset(p_completion) as c("employeeId" text, date date, status text)
          where c."employeeId" = a.employee_id and c.date = a.date and c.status = a.status::text
        )
    ) or exists (
      select 1 from public.shift_assignments a where a.schedule_id = p_schedule_id and not exists (
        select 1 from jsonb_to_recordset(p_completion) as c("employeeId" text, date date, status text)
        where c."employeeId" = a.employee_id and c.date = a.date and c.status = a.shift_type
      )
    )
  ) then raise exception 'Approval would change existing choices. Review a correction first.'; end if;
  -- Keep assignment IDs and linked request history. Do not move a shift with
  -- a pending request or a non-scheduled state during automatic correction.
  if exists (
    select 1 from public.shift_assignments a
    join jsonb_to_recordset(p_completion) as c("employeeId" text, date date, status text)
      on c."employeeId" = a.employee_id and c.date = a.date
    where a.schedule_id = p_schedule_id and a.shift_type <> c.status and (
      a.status <> 'scheduled'
      or exists (select 1 from public.swap_requests r where (r.requester_shift_id = a.id or r.target_shift_id = a.id) and r.status = 'pending')
      or exists (select 1 from public.open_shift_requests r where r.shift_id = a.id)
    )
  ) then raise exception 'A proposed change affects a shift with an open-shift or pending swap request. Resolve that request first.'; end if;

  foreach v_employee_id in array v_write_ids loop
    for v_choice in select * from jsonb_to_recordset(p_completion) as c("employeeId" text, date date, status text) where c."employeeId" = v_employee_id loop
      insert into public.availability (id, employee_id, schedule_id, date, status, approval_status, manager_note)
      values ('av_' || gen_random_uuid()::text, v_employee_id, p_schedule_id, v_choice.date, v_choice.status::public.availability_status, 'approved', 'Manager approved a feasible team arrangement.')
      on conflict (employee_id, schedule_id, date) do update
        set status = excluded.status, approval_status = 'approved',
          manager_note = case when public.availability.status <> excluded.status then 'Manager adjusted this choice to avoid a scheduling deadlock.' else public.availability.manager_note end;
      update public.shift_assignments set shift_type = v_choice.status
      where schedule_id = p_schedule_id and employee_id = v_employee_id and date = v_choice.date;
      if not found then
        insert into public.shift_assignments (id, employee_id, schedule_id, date, shift_type, hours, status)
        values ('sa_' || gen_random_uuid()::text, v_employee_id, p_schedule_id, v_choice.date, v_choice.status, 8, 'scheduled');
      end if;
    end loop;
    update public.schedule_period_employees set availability_approved_at = coalesce(availability_approved_at, now())
    where schedule_id = p_schedule_id and employee_id = v_employee_id;
  end loop;
end;
$$;

revoke all on function public.availability_planning_snapshot(text) from public;
revoke all on function public.approve_feasible_availability(text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.availability_planning_snapshot(text) to authenticated;
grant execute on function public.approve_feasible_availability(text, text, jsonb, jsonb, boolean) to authenticated;
