alter table public.profiles
  add column if not exists paper_doll_config jsonb;

comment on column public.profiles.paper_doll_config is
  'Selected Paper Gremlin avatar options. The rendered SVG remains in avatar_url for public display.';

update public.profiles
set paper_doll_config = (
  substring(
    convert_from(
      decode(split_part(avatar_url, ',', 2), 'base64'),
      'UTF8'
    )
    from '<metadata data-kind="paper-gremlin-avatar">([^<]+)</metadata>'
  )
)::jsonb
where paper_doll_config is null
  and avatar_url like 'data:image/svg+xml;base64,%'
  and convert_from(
    decode(split_part(avatar_url, ',', 2), 'base64'),
    'UTF8'
  ) like '%<metadata data-kind="paper-gremlin-avatar">%';

create or replace function public.get_my_paper_doll_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select p.paper_doll_config
  from public.profiles p
  where p.id = auth.uid();
$$;

create or replace function public.update_my_profile_v2(
  new_avatar_url text,
  new_bio text,
  new_display_name text,
  new_username text,
  new_paper_doll_config jsonb
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  cleaned_username text;
  updated_profile public.profiles;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'You must be signed in to update your profile.';
  end if;

  cleaned_username := lower(trim(coalesce(new_username, '')));

  if cleaned_username = '' then
    raise exception 'Username is required.';
  end if;

  if cleaned_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username may contain only letters, numbers, and underscores.';
  end if;

  if new_paper_doll_config is not null
     and jsonb_typeof(new_paper_doll_config) <> 'object' then
    raise exception 'Paper doll configuration must be an object.';
  end if;

  if exists (
    select 1
    from public.profiles
    where lower(username) = cleaned_username
      and id <> current_user_id
  ) then
    raise exception 'That username is already taken.';
  end if;

  insert into public.profiles (
    id,
    username,
    display_name,
    avatar_url,
    bio,
    paper_doll_config
  )
  values (
    current_user_id,
    cleaned_username,
    nullif(trim(new_display_name), ''),
    nullif(trim(new_avatar_url), ''),
    nullif(trim(new_bio), ''),
    new_paper_doll_config
  )
  on conflict (id)
  do update set
    username = excluded.username,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    bio = excluded.bio,
    paper_doll_config = excluded.paper_doll_config
  returning * into updated_profile;

  return updated_profile;
end;
$$;

revoke all on function public.get_my_paper_doll_config() from public;
revoke all on function public.update_my_profile_v2(text, text, text, text, jsonb) from public;

grant execute on function public.get_my_paper_doll_config() to authenticated;
grant execute on function public.update_my_profile_v2(text, text, text, text, jsonb) to authenticated;
