-- ONE-TIME CLEANUP: permanently remove legacy/demo employee accounts.
-- Preserves managers and all accounts created through the real employee signup flow.
-- A profile is a removable legacy demo account only when role = employee and
-- is_real_signup = false.

-- Remove legacy employee records first. Related demo availability, roster rows,
-- assignments, swaps, and pickup records cascade according to the existing FKs.
delete from public.employees
where id in (
  select employee_id
  from public.users
  where role = 'employee' and is_real_signup = false and employee_id is not null
);

-- This removes the matching public.users profile by its ON DELETE CASCADE and,
-- importantly, frees the email address in Supabase Auth for a genuine signup.
delete from auth.users
where id in (
  select id
  from public.users
  where role = 'employee' and is_real_signup = false
);