-- One reliable, validated save path for employee availability.
-- It deliberately bypasses table RLS after checking every availability rule,
-- so a valid employee choice cannot fail with an unexplained HTTP 403.
-- Only approved choices reserve capacity across the whole roster. Pending
-- choices reserve capacity only while their own pair is currently picking.
-- This safely ignores stale pending test drafts from earlier pairs.
create or replace function public.availability_shift_has_capacity(
  p_schedule_id text,
  p_employee_id text,
  p_date date,
  p_status public.availability_status
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_pair as (
    select availability_pair_index as pair_index
    from public.employees
    where id = p_employee_id
  ), off_days as (
    select count(*) as total
    from public.availability
    where schedule_id = p_schedule_id and date = p_date and status = 'off'
  ), reserved as (
    select status, sum(total)::integer as total
    from (
      -- Approved capacity is the published Schedule, not old availability rows.
      select sa.shift_type::public.availability_status as status, count(*)::integer as total
      from public.shift_assignments sa
      where sa.schedule_id = p_schedule_id
        and sa.date = p_date
        and sa.shift_type in ('day', 'evening', 'night')
        and sa.employee_id <> p_employee_id
      group by sa.shift_type
      union all
      -- Pending capacity is reserved only by the employee's permanent duo.
      select a.status, count(*)::integer as total
      from public.availability a
      join public.employees e on e.id = a.employee_id
      cross join current_pair cp
      where a.schedule_id = p_schedule_id
        and a.date = p_date
        and a.status in ('day', 'evening', 'night')
        and a.employee_id <> p_employee_id
        and a.approval_status = 'pending'
        and e.availability_pair_index = cp.pair_index
      group by a.status
    ) reservations
    group by status  ), same_shift as (
    select coalesce((select total from reserved where status = p_status), 0) as total
  )
  select case
    -- One manager OFF permits 3+2+2. If another shift already has the
    -- one permitted third person, this shift still has its normal two slots.
    when (select total from off_days) = 1 then
      (select total from same_shift) < case
        when exists (select 1 from reserved where status <> p_status and total >= 3) then 2
        else 3
      end
    else (select total from same_shift) < 2
  end
$$;

create or replace function public.save_my_availability(
  p_schedule_id text,
  p_date date,
  p_status public.availability_status,
  p_note text default null
)
returns public.availability
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id text := public.current_employee_id();
  v_result public.availability;
  v_reserved_count integer;
begin
  if v_employee_id is null then
    raise exception 'Your login is not linked to an employee account.';
  end if;

  if p_status not in ('day', 'evening', 'night') then
    raise exception 'Choose Day, Evening, or Night.';
  end if;

  if exists (
    select 1 from public.availability
    where schedule_id = p_schedule_id
      and employee_id = v_employee_id
      and date = p_date
      and status = 'off'
  ) then
    raise exception 'This is your manager-assigned rest day.';
  end if;

  if not public.employee_can_edit_period_availability(p_schedule_id, v_employee_id) then
    raise exception '%', coalesce(
      (public.availability_edit_diagnostic(p_schedule_id, p_date, p_status)->>'reason'),
      'Your availability cannot be changed right now.'
    );
  end if;

  if not public.availability_shift_has_capacity(p_schedule_id, v_employee_id, p_date, p_status) then
    select coalesce(sum(total), 0)::integer into v_reserved_count
    from (
      select count(*)::integer as total
      from public.shift_assignments sa
      where sa.schedule_id = p_schedule_id
        and sa.date = p_date
        and sa.shift_type = p_status::text
        and sa.employee_id <> v_employee_id
      union all
      select count(*)::integer as total
      from public.availability a
      join public.employees e on e.id = a.employee_id
      join public.employees current_employee on current_employee.id = v_employee_id
      where a.schedule_id = p_schedule_id
        and a.date = p_date
        and a.status = p_status
        and a.employee_id <> v_employee_id
        and a.approval_status = 'pending'
        and e.availability_pair_index = current_employee.availability_pair_index
    ) reservations;    raise exception 'This shift is already filled: % scheduled or active-pair choices already reserve it.', v_reserved_count;
  end if;

  if p_status = 'day' and exists (
    select 1 from public.availability
    where schedule_id = p_schedule_id
      and employee_id = v_employee_id
      and date = p_date - 1
      and status = 'night'
  ) then
    raise exception 'You cannot choose Day immediately after a Night shift.';
  end if;

  if p_status = 'night' and exists (
    select 1 from public.availability
    where schedule_id = p_schedule_id
      and employee_id = v_employee_id
      and date = p_date + 1
      and status = 'day'
  ) then
    raise exception 'You cannot choose Night when the next day is a Day shift.';
  end if;

  insert into public.availability (
    id, employee_id, schedule_id, date, status, note, submitted_at, approval_status
  ) values (
    'av_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20),
    v_employee_id, p_schedule_id, p_date, p_status, nullif(p_note, ''), now(), 'pending'
  )
  on conflict (employee_id, schedule_id, date) do update
    set status = excluded.status,
        note = excluded.note,
        submitted_at = excluded.submitted_at,
        approval_status = 'pending'
    where public.availability.approval_status <> 'approved'
      and public.availability.status <> 'off'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'This availability is already fixed and cannot be changed.';
  end if;

  return v_result;
end;
$$;

grant execute on function public.save_my_availability(text, date, public.availability_status, text) to authenticated;
