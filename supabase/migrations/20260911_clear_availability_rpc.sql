-- Allow employees to leave an editable working day undecided.
-- Uses the same period access rules as save_my_availability.
create or replace function public.clear_my_availability(p_availability_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.availability;
begin
  select * into v_entry
  from public.availability
  where id = p_availability_id
    and employee_id = public.current_employee_id()
  for update;

  if not found then
    raise exception 'This availability choice could not be found for your account.';
  end if;

  if v_entry.status = 'off' then
    raise exception 'Manager-assigned rest days cannot be cleared.';
  end if;

  if v_entry.approval_status = 'approved'
    or not coalesce(public.employee_can_edit_period_availability(v_entry.schedule_id, v_entry.employee_id), false) then
    raise exception 'Your availability cannot be changed right now.';
  end if;

  delete from public.availability where id = v_entry.id;
end;
$$;

revoke all on function public.clear_my_availability(text) from public;
grant execute on function public.clear_my_availability(text) to authenticated;
