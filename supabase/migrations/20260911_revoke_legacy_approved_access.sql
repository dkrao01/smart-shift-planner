-- Revoke portal access from every legacy/demo employee profile, including any accidentally approved earlier.
update public.users
set is_approved = false, registration_status = 'rejected'
where role = 'employee' and is_real_signup = false;

update public.employees e
set active = false
from public.users u
where u.employee_id = e.id and u.role = 'employee' and u.is_real_signup = false;