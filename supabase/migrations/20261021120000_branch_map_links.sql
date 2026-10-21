alter table public.branches
  add column if not exists map_url text;

alter table public.branches
  drop constraint if exists branches_map_url_https_check;

alter table public.branches
  add constraint branches_map_url_https_check
  check (map_url is null or map_url ~ '^https://');

notify pgrst, 'reload schema';
