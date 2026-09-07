-- Smart Shift Planner Supabase schema
-- Run this once in Supabase SQL Editor.
-- Firebase remains the source of truth until the application cutover is complete.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('manager', 'employee');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.availability_status as enum ('day', 'evening', 'night', 'off');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected', 'resubmit');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shift_status as enum ('scheduled', 'open', 'covered', 'absent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.open_shift_status as enum ('open', 'requested', 'filled', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role public.user_role not null,
  employee_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id text primary key,
  name text not null,
  email text not null unique,
  uid uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  join_date date
);

create table if not exists public.schedule_periods (
  id text primary key,
  start_date date not null,
  end_date date not null,
  label text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  rest_days_published boolean not null default false,
  constraint schedule_period_dates_valid check (end_date >= start_date)
);

create table if not exists public.shift_assignments (
  id text primary key,
  schedule_id text not null references public.schedule_periods(id) on delete cascade,
  date date not null,
  shift_type text not null check (shift_type in ('day', 'evening', 'night')),
  employee_id text not null references public.employees(id) on delete cascade,
  hours numeric not null check (hours > 0),
  status public.shift_status not null default 'scheduled',
  notes text
);

create table if not exists public.availability (
  id text primary key,
  employee_id text not null references public.employees(id) on delete cascade,
  schedule_id text not null references public.schedule_periods(id) on delete cascade,
  date date not null,
  status public.availability_status not null,
  note text,
  submitted_at timestamptz not null default now(),
  approval_status public.approval_status not null default 'pending',
  manager_note text,
  unique (employee_id, schedule_id, date)
);

create table if not exists public.swap_requests (
  id text primary key,
  requester_id text not null references public.employees(id) on delete cascade,
  target_id text not null references public.employees(id) on delete cascade,
  requester_shift_id text not null references public.shift_assignments(id) on delete cascade,
  target_shift_id text not null references public.shift_assignments(id) on delete cascade,
  reason text not null,
  status public.request_status not null default 'pending',
  validation_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  manager_note text
);

create table if not exists public.open_shift_requests (
  id text primary key,
  original_employee_id text not null references public.employees(id) on delete cascade,
  shift_id text not null references public.shift_assignments(id) on delete cascade,
  pickup_employee_id text references public.employees(id) on delete set null,
  pickup_status public.request_status,
  status public.open_shift_status not null default 'open',
  reason text not null,
  validation_warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  manager_note text
);

create index if not exists shift_assignments_schedule_date_idx on public.shift_assignments(schedule_id, date);
create index if not exists shift_assignments_employee_schedule_idx on public.shift_assignments(employee_id, schedule_id);
create index if not exists availability_employee_schedule_idx on public.availability(employee_id, schedule_id);
create index if not exists availability_schedule_date_idx on public.availability(schedule_id, date);
create index if not exists swap_requests_status_idx on public.swap_requests(status);
create index if not exists open_shift_requests_status_idx on public.open_shift_requests(status);

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.current_employee_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select employee_id from public.users where id = auth.uid()
$$;

alter table public.users enable row level security;
alter table public.employees enable row level security;
alter table public.schedule_periods enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.availability enable row level security;
alter table public.swap_requests enable row level security;
alter table public.open_shift_requests enable row level security;

drop policy if exists users_self_or_manager on public.users;
create policy users_self_or_manager on public.users
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'manager');

drop policy if exists employees_authenticated_read on public.employees;
create policy employees_authenticated_read on public.employees
  for select to authenticated using (true);

drop policy if exists employees_manager_write on public.employees;
create policy employees_manager_write on public.employees
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists schedules_authenticated_read on public.schedule_periods;
create policy schedules_authenticated_read on public.schedule_periods
  for select to authenticated using (true);

drop policy if exists schedules_manager_write on public.schedule_periods;
create policy schedules_manager_write on public.schedule_periods
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists assignments_authenticated_read on public.shift_assignments;
create policy assignments_authenticated_read on public.shift_assignments
  for select to authenticated using (true);

drop policy if exists assignments_manager_write on public.shift_assignments;
create policy assignments_manager_write on public.shift_assignments
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists availability_authenticated_read on public.availability;
create policy availability_authenticated_read on public.availability
  for select to authenticated using (true);

drop policy if exists availability_employee_insert on public.availability;
create policy availability_employee_insert on public.availability
  for insert to authenticated
  with check (employee_id = public.current_employee_id() and approval_status = 'pending');

drop policy if exists availability_employee_update on public.availability;
create policy availability_employee_update on public.availability
  for update to authenticated
  using (employee_id = public.current_employee_id() and approval_status <> 'approved')
  with check (employee_id = public.current_employee_id() and approval_status = 'pending');

drop policy if exists availability_manager_write on public.availability;
create policy availability_manager_write on public.availability
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists swaps_authenticated_read on public.swap_requests;
create policy swaps_authenticated_read on public.swap_requests
  for select to authenticated using (true);

drop policy if exists swaps_employee_insert on public.swap_requests;
create policy swaps_employee_insert on public.swap_requests
  for insert to authenticated with check (requester_id = public.current_employee_id());

drop policy if exists swaps_manager_write on public.swap_requests;
create policy swaps_manager_write on public.swap_requests
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');

drop policy if exists open_shifts_authenticated_read on public.open_shift_requests;
create policy open_shifts_authenticated_read on public.open_shift_requests
  for select to authenticated using (true);

drop policy if exists open_shifts_employee_insert on public.open_shift_requests;
create policy open_shifts_employee_insert on public.open_shift_requests
  for insert to authenticated with check (original_employee_id = public.current_employee_id());

drop policy if exists open_shifts_manager_write on public.open_shift_requests;
create policy open_shifts_manager_write on public.open_shift_requests
  for all to authenticated using (public.current_user_role() = 'manager') with check (public.current_user_role() = 'manager');
