alter function public.is_site_admin(uuid) rename to is_listed_site_admin;

create function public.is_site_admin(check_user_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select public.is_listed_site_admin(check_user_id) $$;

revoke execute on function public.is_site_admin(uuid) from public, anon;
grant execute on function public.is_site_admin(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
