-- Prevent unauthenticated callers from invoking privileged RPCs.
-- Existing authenticated and service_role grants remain intact.
do $migration$
declare
  function_record record;
begin
  for function_record in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      function_record.signature
    );
  end loop;
end
$migration$;

-- Do not automatically expose future functions to unauthenticated callers.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

-- These trigger functions only need PostgreSQL built-ins. Pinning their
-- search path prevents object-shadowing attacks without changing behavior.
alter function public.set_admin_datasets_updated_at()
  set search_path = pg_catalog, public;

alter function public.set_admin_uploads_updated_at()
  set search_path = pg_catalog, public;

alter function public.set_marketplace_updated_at()
  set search_path = pg_catalog, public;
