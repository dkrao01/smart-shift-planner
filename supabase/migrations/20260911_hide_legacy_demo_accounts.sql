-- One-time production cutover: hide legacy/demo employee profiles.
-- Existing pending demo profiles are marked rejected (not deleted). Future signups are marked real.
alter table public.users add column if not exists is_real_signup boolean not null default false;

update public.users
set is_approved = false, registration_status = 'rejected', is_real_signup = false
where role = 'employee' and registration_status = 'pending';

update public.employees e
set active = false
from public.users u
where u.employee_id = e.id and u.role = 'employee' and u.is_real_signup = false;

create or replace function public.handle_employee_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  employee_code text := 'EMP-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
  display_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  resolved_employee_id text;
begin
  select id into resolved_employee_id from public.employees where lower(email) = lower(new.email) limit 1;
  if resolved_employee_id is null then
    resolved_employee_id := employee_code;
    insert into public.employees (id, name, email, uid, active) values (resolved_employee_id, display_name, new.email, new.id, false);
  else
    update public.employees set uid = new.id, name = display_name, active = false where id = resolved_employee_id;
  end if;
  insert into public.users (id, name, email, role, employee_id, is_approved, registration_status, is_real_signup)
  values (new.id, display_name, new.email, 'employee', resolved_employee_id, false, 'pending', true)
  on conflict (id) do update set name = excluded.name, email = excluded.email, role = 'employee', employee_id = excluded.employee_id, is_approved = false, registration_status = 'pending', is_real_signup = true;
  return new;
end;
$$;