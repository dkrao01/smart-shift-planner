-- Managers may update a schedule period while it is still unpublished.
-- The app also refuses date changes once any OFF days or availability exist.
drop policy if exists schedule_periods_manager_update_unpublished on public.schedule_periods;
create policy schedule_periods_manager_update_unpublished on public.schedule_periods
  for update to authenticated
  using (public.current_user_role() = 'manager' and rest_days_published = false)
  with check (public.current_user_role() = 'manager');