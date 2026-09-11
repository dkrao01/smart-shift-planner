-- Permanent availability-pair identity.
-- A manager may reorder a period roster, create/delete future periods, or use
-- a custom date range. None of those actions may change who belongs together.
alter table public.employees
  add column if not exists availability_pair_index integer;

-- Assign each currently approved employee to a permanent pair once, using the
-- existing approved employee order. Existing values are never changed.
with approved_employees as (
  select e.id,
         ((row_number() over (order by u.created_at, u.id) - 1) / 2)::integer as pair_index
  from public.employees e
  join public.users u on u.employee_id = e.id
  where e.active = true
    and u.role = 'employee'
    and u.is_approved = true
    and u.registration_status = 'approved'
)
update public.employees e
set availability_pair_index = approved_employees.pair_index
from approved_employees
where e.id = approved_employees.id
  and e.availability_pair_index is null;

-- The application freezes a period's saved availability waves as soon as any
-- employee submits. This migration intentionally does not modify existing
-- period waves or availability records.