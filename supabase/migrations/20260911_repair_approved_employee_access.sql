-- Repair legacy accounts approved before the is_approved flag was introduced.
-- Makes availability RLS recognize every manager-approved employee.
update public.users
set is_approved = true
where role = 'employee'
  and registration_status = 'approved'
  and is_approved = false;

create or replace function public.current_user_is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select role = 'manager'
        or is_approved = true
        or registration_status = 'approved'
    from public.users
    where id = auth.uid()
  ), false)
$$;