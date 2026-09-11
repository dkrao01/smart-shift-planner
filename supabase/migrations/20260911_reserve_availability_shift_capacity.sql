-- Correct availability-pair waves and reserve full shift capacity.
-- Safe to run after the earlier version of this file: it restores saved duos
-- from employees.availability_pair_index; it never removes availability data.
-- Run after 20260911_persist_availability_pair_identity.sql.

-- Restore permanent two-person duos and rotate only whole duos by period priority.
with member_pairs as (
  select m.schedule_id, m.employee_id, e.availability_pair_index as pair_index
  from public.schedule_period_employees m
  join public.employees e on e.id = m.employee_id
  where e.availability_pair_index is not null
), pair_counts as (
  select schedule_id, greatest(count(distinct pair_index), 1)::integer as total_pairs
  from member_pairs
  group by schedule_id
), corrected_waves as (
  select mp.schedule_id, mp.employee_id,
         dense_rank() over (
           partition by mp.schedule_id
           order by mod(mp.pair_index - mod(sp.availability_priority, pc.total_pairs) + pc.total_pairs, pc.total_pairs)
         ) as availability_wave
  from member_pairs mp
  join public.schedule_periods sp on sp.id = mp.schedule_id
  join pair_counts pc on pc.schedule_id = mp.schedule_id
)
update public.schedule_period_employees m
set availability_wave = corrected_waves.availability_wave
from corrected_waves
where m.schedule_id = corrected_waves.schedule_id
  and m.employee_id = corrected_waves.employee_id;

-- An incomplete draft must never remain marked as submitted or approved.
-- This repairs old test data without deleting the employee''s choices.
update public.schedule_period_employees m
set availability_submitted_at = null,
    availability_approved_at = null
where exists (
  select 1
  from public.availability a
  where a.schedule_id = m.schedule_id
    and a.employee_id = m.employee_id
  group by a.schedule_id, a.employee_id
  having count(*) filter (where a.status in ('day', 'evening', 'night')) <> 18
      or count(*) filter (where a.status = 'day') <> 6
      or count(*) filter (where a.status = 'evening') <> 6
      or count(*) filter (where a.status = 'night') <> 6
);

-- Pending and approved choices reserve a slot. Normal days allow 2 per shift.
-- On days with exactly one manager OFF, one shift may have 3 (3+2+2).
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
               and a.approval_status in ('pending', 'approved')
               and a.employee_id <> availability.employee_id) < 3
        and not exists (
          select 1 from public.availability other_shift
          where other_shift.schedule_id = availability.schedule_id
            and other_shift.date = availability.date
            and other_shift.status <> availability.status
            and other_shift.status in ('day', 'evening', 'night')
            and other_shift.approval_status in ('pending', 'approved')
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
               and a.approval_status in ('pending', 'approved')
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
               and a.approval_status in ('pending', 'approved')
               and a.employee_id <> availability.employee_id) < 3
        and not exists (
          select 1 from public.availability other_shift
          where other_shift.schedule_id = availability.schedule_id
            and other_shift.date = availability.date
            and other_shift.status <> availability.status
            and other_shift.status in ('day', 'evening', 'night')
            and other_shift.approval_status in ('pending', 'approved')
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
               and a.approval_status in ('pending', 'approved')
               and a.employee_id <> availability.employee_id) < 2
      )
    )
  );