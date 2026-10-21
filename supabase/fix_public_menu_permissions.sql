-- Allow anonymous PostgREST requests to evaluate public-read policies.
-- has_role() returns false when there is no active authenticated account.
grant execute on function public.has_role(public.app_role) to anon, authenticated;
