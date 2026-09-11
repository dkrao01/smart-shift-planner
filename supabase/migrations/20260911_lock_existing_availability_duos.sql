-- Correct permanent availability duos from the original period.
-- Priority rotates whole pairs only; teammates never change.
with reference_period as (
  select s.id, coalesce(s.availability_priority, 0) as priority
  from public.schedule_periods s
  where exists (select 1 from public.schedule_period_employees m where m.schedule_id = s.id)
  order by s.start_date, s.created_at
  limit 1
), pair_total as (
  select greatest(count(distinct m.availability_wave), 1)::integer as total
  from public.schedule_period_employees m
  join reference_period r on r.id = m.schedule_id
), original_pair_membership as (
  select m.employee_id,
         mod((m.availability_wave - 1) + r.priority, p.total) as pair_index
  from public.schedule_period_employees m
  join reference_period r on r.id = m.schedule_id
  cross join pair_total p
)
update public.employees e
set availability_pair_index = o.pair_index
from original_pair_membership o
where e.id = o.employee_id;

-- Recalculate queue waves only for periods where no employee has submitted.
-- Submitted/current periods retain their saved order and records unchanged.
with period_pairs as (
  select m.schedule_id, m.employee_id, e.availability_pair_index,
         s.availability_priority,
         dense_rank() over (
           partition by m.schedule_id
           order by mod(e.availability_pair_index - mod(s.availability_priority, 2147483647) + 2147483647, 2147483647)
         ) as new_wave
  from public.schedule_period_employees m
  join public.employees e on e.id = m.employee_id
  join public.schedule_periods s on s.id = m.schedule_id
  where not exists (
    select 1 from public.schedule_period_employees submitted
    where submitted.schedule_id = m.schedule_id
      and (submitted.availability_submitted_at is not null or submitted.availability_approved_at is not null)
  )
)
update public.schedule_period_employees m
set availability_wave = p.new_wave
from period_pairs p
where m.schedule_id = p.schedule_id
  and m.employee_id = p.employee_id;