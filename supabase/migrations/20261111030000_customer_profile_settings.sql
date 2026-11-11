-- Existing profile RLS limits updates to the signed-in account and Admins.
grant update (username, first_name, last_name, middle_initial)
on public.profiles to authenticated;

notify pgrst, 'reload schema';
