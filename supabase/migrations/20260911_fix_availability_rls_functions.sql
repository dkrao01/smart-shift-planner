-- Reliable availability RLS: security-definer checks avoid nested RLS false denials.

create or replace function public.employee_can_edit_period_availability(
  p_schedule_id text,
  p_employee_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_employee_id = public.current_employee_id()
    and exists (
      select 1
      from public.schedule_period_employees m
      join public.schedule_periods s on s.id = m.schedule_id
      where m.schedule_id = p_schedule_id
        and m.employee_id = p_employee_id
        and m.availability_submitted_at is null
        and m.availability_approved_at is null
        and s.rest_days_published = true
        and (s.availability_deadline is null or now() <= s.availability_deadline or m.availability_deadline_override = true)
        and (
          m.availability_deadline_override = true
          or m.availability_wave = (
            select min(m2.availability_wave)
            from public.schedule_period_employees m2
            where m2.schedule_id = p_schedule_id
              and m2.availability_approved_at is null
          )
        )
    )
$$;

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
  with counts as (
    select
      count(*) filter (where status = 'off') as off_count,
      count(*) filter (
        where status = p_status
          and approval_status in ('pending', 'approved')
          and employee_id <> p_employee_id
      ) as same_shift_count
    from public.availability
    where schedule_id = p_schedule_id and date = p_date
  )
  select case
    when (select off_count from counts) = 1 then
      (select same_shift_count from counts) < 3
      and not exists (
        select 1
        from public.availability other_shift
        where other_shift.schedule_id = p_schedule_id
          and other_shift.date = p_date
          and other_shift.status in ('day', 'evening', 'night')
          and other_shift.status <> p_status
          and other_shift.approval_status in ('pending', 'approved')
        group by other_shift.status
        having count(*) >= 3
      )
    else (select same_shift_count from counts) < 2
  end
$$;

drop policy if exists availability_employee_insert_before_deadline on public.availability;
create policy availability_employee_insert_before_deadline
  on public.availability for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night')
    and approval_status = 'pending'
    and public.employee_can_edit_period_availability(schedule_id, employee_id)
    and public.availability_shift_has_capacity(schedule_id, employee_id, date, status)
  );

drop policy if exists availability_employee_update_before_deadline on public.availability;
create policy availability_employee_update_before_deadline
  on public.availability for update to authenticated
  using (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night')
    and approval_status <> 'approved'
  )
  with check (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night')
    and approval_status = 'pending'
    and public.employee_can_edit_period_availability(schedule_id, employee_id)
    and public.availability_shift_has_capacity(schedule_id, employee_id, date, status)
  );