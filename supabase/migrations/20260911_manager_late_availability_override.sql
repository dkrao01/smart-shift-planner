-- Manager may grant a specific missed employee a late-availability exception.
alter table public.schedule_period_employees
  add column if not exists availability_deadline_override boolean not null default false;

drop policy if exists availability_employee_insert_before_deadline on public.availability;
create policy availability_employee_insert_before_deadline on public.availability
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night') and approval_status = 'pending'
    and exists (select 1 from public.schedule_period_employees m join public.schedule_periods s on s.id = m.schedule_id where m.schedule_id = availability.schedule_id and m.employee_id = availability.employee_id and m.availability_submitted_at is null and (s.rest_days_published = true) and (s.availability_deadline is null or now() <= s.availability_deadline or m.availability_deadline_override = true))
  );

drop policy if exists availability_employee_update_before_deadline on public.availability;
create policy availability_employee_update_before_deadline on public.availability
  for update to authenticated
  using (employee_id = public.current_employee_id() and status in ('day', 'evening', 'night') and approval_status <> 'approved')
  with check (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night') and approval_status = 'pending'
    and exists (select 1 from public.schedule_period_employees m join public.schedule_periods s on s.id = m.schedule_id where m.schedule_id = availability.schedule_id and m.employee_id = availability.employee_id and m.availability_submitted_at is null and (s.rest_days_published = true) and (s.availability_deadline is null or now() <= s.availability_deadline or m.availability_deadline_override = true))
  );