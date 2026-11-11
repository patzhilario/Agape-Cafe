-- Read-only checks. Run while the Sign Up request is still waiting.
-- Nonempty blocking_pids identifies a database lock that Auth is waiting for.
select
  pid,
  state,
  wait_event_type,
  wait_event,
  pg_blocking_pids(pid) as blocking_pids,
  round(extract(epoch from (clock_timestamp() - xact_start))::numeric, 1)
    as transaction_seconds
from pg_stat_activity
where usename = 'supabase_auth_admin'
  and state <> 'idle'
order by xact_start nulls last;

-- List signup-related custom triggers without exposing function bodies or secrets.
select
  table_schema.nspname as table_schema,
  relation.relname as table_name,
  trigger.tgname as trigger_name,
  function_schema.nspname as function_schema,
  handler.proname as function_name
from pg_trigger as trigger
join pg_class as relation on relation.oid = trigger.tgrelid
join pg_namespace as table_schema on table_schema.oid = relation.relnamespace
join pg_proc as handler on handler.oid = trigger.tgfoid
join pg_namespace as function_schema on function_schema.oid = handler.pronamespace
where not trigger.tgisinternal
  and (
    (table_schema.nspname = 'auth' and relation.relname = 'users')
    or (table_schema.nspname = 'public'
      and relation.relname in ('profiles', 'user_roles'))
    or (table_schema.nspname = 'app_private' and relation.relname = 'pending_user_access')
  )
order by table_schema.nspname, relation.relname, trigger.tgname;
