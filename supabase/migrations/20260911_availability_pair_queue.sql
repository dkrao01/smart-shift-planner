-- Controlled availability queue: fixed approved-employee pairs rotate each period.
-- Only the current pair may submit; the next pair opens after manager approval.
alter table public.schedule_periods
  add column if not exists availability_priority integer not null default 0;
alter table public.schedule_period_employees
  add column if not exists availability_wave integer not null default 1,
  add column if not exists availability_approved_at timestamptz;

-- Approved-account creation order is the fixed organization order for pairs. Manager roster order never affects it.
with ranked_periods as (
  select id, row_number() over (order by start_date, created_at) - 1 as priority
  from public.schedule_periods
)
update public.schedule_periods s
set availability_priority = ranked_periods.priority
from ranked_periods
where s.id = ranked_periods.id and s.availability_priority = 0;

with member_order as (
  select m.schedule_id, m.employee_id,
         ((row_number() over (partition by m.schedule_id order by coalesce(e.join_date, '9999-12-31'::date), e.id) - 1) / 2)::integer as pair_index
  from public.schedule_period_employees m
  join public.employees e on e.id = m.employee_id
), pair_counts as (
  select schedule_id, greatest(count(distinct pair_index), 1)::integer as total
  from member_order
  group by schedule_id
), ranked_members as (
  select o.schedule_id, o.employee_id,
         dense_rank() over (
           partition by o.schedule_id
           order by mod(o.pair_index - mod(s.availability_priority, p.total) + p.total, p.total)
         ) as wave
  from member_order o
  join public.schedule_periods s on s.id = o.schedule_id
  join pair_counts p on p.schedule_id = o.schedule_id
)
update public.schedule_period_employees m
set availability_wave = ranked_members.wave
from ranked_members
where m.schedule_id = ranked_members.schedule_id
  and m.employee_id = ranked_members.employee_id;
-- Employees may submit only while their pair is the first pair awaiting approval.
drop policy if exists schedule_period_employee_submit on public.schedule_period_employees;
create policy schedule_period_employee_submit on public.schedule_period_employees
  for update to authenticated
  using (
    employee_id = public.current_employee_id()
    and availability_submitted_at is null
    and availability_approved_at is null
    and (
      availability_deadline_override = true
      or availability_wave = (
        select min(m2.availability_wave)
        from public.schedule_period_employees m2
        where m2.schedule_id = schedule_period_employees.schedule_id
          and m2.availability_approved_at is null
      )
    )
  )
  with check (employee_id = public.current_employee_id() and availability_submitted_at is not null);

-- Enforce both the pair queue and the maximum two approved employees per date/shift.
drop policy if exists availability_employee_insert_before_deadline on public.availability;
create policy availability_employee_insert_before_deadline on public.availability
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night') and approval_status = 'pending'
    and exists (
      select 1
      from public.schedule_period_employees m
      join public.schedule_periods s on s.id = m.schedule_id
      where m.schedule_id = availability.schedule_id
        and m.employee_id = availability.employee_id
        and m.availability_submitted_at is null
        and m.availability_approved_at is null
        and s.rest_days_published = true
        and (s.availability_deadline is null or now() <= s.availability_deadline or m.availability_deadline_override = true)
        and (
          m.availability_deadline_override = true
          or m.availability_wave = (
            select min(m2.availability_wave)
            from public.schedule_period_employees m2
            where m2.schedule_id = m.schedule_id and m2.availability_approved_at is null
          )
        )
    )
    and (
      -- Usually every shift is limited to two employees. When exactly one
      -- manager-assigned OFF exists on that date, permit one 3-person shift:
      -- 3+2+2, never 3+3+1.
      (
        (select count(*) from public.availability off_day
         where off_day.schedule_id = availability.schedule_id
           and off_day.date = availability.date
           and off_day.status = 'off') = 1
        and (select count(*) from public.availability a
             where a.schedule_id = availability.schedule_id
               and a.date = availability.date
               and a.status = availability.status
               and a.approval_status = 'approved'
               and a.employee_id <> availability.employee_id) < 3
        and not exists (
          select 1 from public.availability other_shift
          where other_shift.schedule_id = availability.schedule_id
            and other_shift.date = availability.date
            and other_shift.status <> availability.status
            and other_shift.status in ('day', 'evening', 'night')
            and other_shift.approval_status = 'approved'
          group by other_shift.status
          having count(*) >= 3
        )
      )
      or (
        (select count(*) from public.availability off_day
         where off_day.schedule_id = availability.schedule_id
           and off_day.date = availability.date
           and off_day.status = 'off') <> 1
        and (select count(*) from public.availability a
             where a.schedule_id = availability.schedule_id
               and a.date = availability.date
               and a.status = availability.status
               and a.approval_status = 'approved'
               and a.employee_id <> availability.employee_id) < 2
      )
    )
  );

drop policy if exists availability_employee_update_before_deadline on public.availability;
create policy availability_employee_update_before_deadline on public.availability
  for update to authenticated
  using (employee_id = public.current_employee_id() and status in ('day', 'evening', 'night') and approval_status <> 'approved')
  with check (
    employee_id = public.current_employee_id()
    and status in ('day', 'evening', 'night') and approval_status = 'pending'
    and exists (
      select 1
      from public.schedule_period_employees m
      join public.schedule_periods s on s.id = m.schedule_id
      where m.schedule_id = availability.schedule_id
        and m.employee_id = availability.employee_id
        and m.availability_submitted_at is null
        and m.availability_approved_at is null
        and s.rest_days_published = true
        and (s.availability_deadline is null or now() <= s.availability_deadline or m.availability_deadline_override = true)
        and (
          m.availability_deadline_override = true
          or m.availability_wave = (
            select min(m2.availability_wave)
            from public.schedule_period_employees m2
            where m2.schedule_id = m.schedule_id and m2.availability_approved_at is null
          )
        )
    )
    and (
      -- Usually every shift is limited to two employees. When exactly one
      -- manager-assigned OFF exists on that date, permit one 3-person shift:
      -- 3+2+2, never 3+3+1.
      (
        (select count(*) from public.availability off_day
         where off_day.schedule_id = availability.schedule_id
           and off_day.date = availability.date
           and off_day.status = 'off') = 1
        and (select count(*) from public.availability a
             where a.schedule_id = availability.schedule_id
               and a.date = availability.date
               and a.status = availability.status
               and a.approval_status = 'approved'
               and a.employee_id <> availability.employee_id) < 3
        and not exists (
          select 1 from public.availability other_shift
          where other_shift.schedule_id = availability.schedule_id
            and other_shift.date = availability.date
            and other_shift.status <> availability.status
            and other_shift.status in ('day', 'evening', 'night')
            and other_shift.approval_status = 'approved'
          group by other_shift.status
          having count(*) >= 3
        )
      )
      or (
        (select count(*) from public.availability off_day
         where off_day.schedule_id = availability.schedule_id
           and off_day.date = availability.date
           and off_day.status = 'off') <> 1
        and (select count(*) from public.availability a
             where a.schedule_id = availability.schedule_id
               and a.date = availability.date
               and a.status = availability.status
               and a.approval_status = 'approved'
               and a.employee_id <> availability.employee_id) < 2
      )
    )
  );