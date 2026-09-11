-- Run this once in the Supabase SQL Editor for existing projects.
create table if not exists public.open_shift_pickup_requests (
  id text primary key,
  open_shift_id text not null references public.open_shift_requests(id) on delete cascade,
  employee_id text not null references public.employees(id) on delete cascade,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  manager_note text,
  validation_warnings jsonb not null default '[]'::jsonb,
  unique (open_shift_id, employee_id)
);

alter table public.open_shift_pickup_requests
  add column if not exists validation_warnings jsonb not null default '[]'::jsonb;

create index if not exists open_shift_pickup_requests_open_shift_idx
  on public.open_shift_pickup_requests(open_shift_id, created_at);

alter table public.open_shift_pickup_requests enable row level security;

drop policy if exists open_shift_pickups_authenticated_read on public.open_shift_pickup_requests;
create policy open_shift_pickups_authenticated_read on public.open_shift_pickup_requests
  for select to authenticated using (true);

drop policy if exists open_shift_pickups_employee_insert on public.open_shift_pickup_requests;
create policy open_shift_pickups_employee_insert on public.open_shift_pickup_requests
  for insert to authenticated with check (employee_id = public.current_employee_id());

drop policy if exists open_shift_pickups_manager_write on public.open_shift_pickup_requests;
create policy open_shift_pickups_manager_write on public.open_shift_pickup_requests
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

-- Lets only the employee who posted an unfilled shift withdraw it, while also
-- closing outstanding pickup applications in the same database operation.
create or replace function public.withdraw_open_shift(p_open_shift_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  shift_request public.open_shift_requests%rowtype;
begin
  select * into shift_request from public.open_shift_requests
    where id = p_open_shift_id for update;
  if not found
    or shift_request.original_employee_id <> public.current_employee_id()
    or shift_request.status not in ('open', 'requested') then
    raise exception 'Open shift cannot be withdrawn';
  end if;

  update public.open_shift_requests
    set status = 'cancelled', resolved_at = now(), manager_note = 'Open shift was withdrawn by the original employee.'
    where id = p_open_shift_id;
  update public.open_shift_pickup_requests
    set status = 'rejected', resolved_at = now(), manager_note = 'Open shift was withdrawn by the original employee.'
    where open_shift_id = p_open_shift_id and status = 'pending';
end;
$$;

grant execute on function public.withdraw_open_shift(text) to authenticated;

-- Preserve applications created with the previous one-applicant design.
insert into public.open_shift_pickup_requests (id, open_shift_id, employee_id, status, created_at, resolved_at, resolved_by, manager_note)
select 'legacy-pickup-' || id, id, pickup_employee_id, coalesce(pickup_status, 'pending'), created_at, resolved_at, resolved_by, manager_note
from public.open_shift_requests
where pickup_employee_id is not null
on conflict (open_shift_id, employee_id) do nothing;
