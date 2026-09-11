-- Returns the exact reason an employee cannot save an availability choice.
create or replace function public.availability_edit_diagnostic(
  p_schedule_id text,
  p_date date,
  p_status public.availability_status
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with member as (
    select m.employee_id, m.availability_submitted_at, m.availability_approved_at,
           m.availability_deadline_override, m.availability_wave,
           s.rest_days_published, s.availability_deadline
    from public.schedule_period_employees m
    join public.schedule_periods s on s.id = m.schedule_id
    where m.schedule_id = p_schedule_id
      and m.employee_id = public.current_employee_id()
  ), opening as (
    select min(availability_wave) as wave
    from public.schedule_period_employees
    where schedule_id = p_schedule_id and availability_approved_at is null
  )
  select jsonb_build_object(
    'reason', case
      when not exists (select 1 from member) then 'Your login is not in this period roster.'
      when (select availability_approved_at is not null from member) then 'Your availability is already approved and fixed.'
      when (select availability_submitted_at is not null from member) then 'Your complete availability was already submitted for manager review.'
      when not (select rest_days_published from member) then 'Manager rest days are not published.'
      when (select availability_deadline is not null and now() > availability_deadline and not availability_deadline_override from member) then 'The availability deadline has passed.'
      when not ((select availability_deadline_override from member) or (select availability_wave from member) = (select wave from opening)) then 'Your pair is waiting for an earlier pair to be approved.'
      when not public.availability_shift_has_capacity(p_schedule_id, public.current_employee_id(), p_date, p_status) then 'This shift is already filled.'
      else 'The database policy rejected this choice unexpectedly.'
    end,
    'employee_id', public.current_employee_id(),
    'employee_wave', (select availability_wave from member),
    'open_wave', (select wave from opening),
    'can_edit', public.employee_can_edit_period_availability(p_schedule_id, public.current_employee_id()),
    'has_capacity', public.availability_shift_has_capacity(p_schedule_id, public.current_employee_id(), p_date, p_status)
  )
$$;