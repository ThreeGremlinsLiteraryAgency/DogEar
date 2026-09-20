create or replace function public.create_forum_thread(
  p_club_id bigint,
  p_title text,
  p_body text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  new_thread_id bigint;
begin
  if caller_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_active_club_member(p_club_id, caller_id) then
    raise exception 'Only active club members can create discussions.';
  end if;

  if clean_title = '' or char_length(clean_title) > 180 then
    raise exception 'Discussion titles must be between 1 and 180 characters.';
  end if;

  if clean_body = '' or char_length(clean_body) > 20000 then
    raise exception 'Opening posts must be between 1 and 20,000 characters.';
  end if;

  insert into public.forum_threads (
    club_id,
    author_id,
    title,
    is_pinned,
    is_locked,
    is_hidden
  ) values (
    p_club_id,
    caller_id,
    clean_title,
    false,
    false,
    false
  )
  returning id into new_thread_id;

  insert into public.forum_posts (
    thread_id,
    author_id,
    body,
    is_hidden
  ) values (
    new_thread_id,
    caller_id,
    clean_body,
    false
  );

  return new_thread_id;
end;
$$;

revoke all on function public.create_forum_thread(bigint, text, text) from public;
revoke all on function public.create_forum_thread(bigint, text, text) from anon;
grant execute on function public.create_forum_thread(bigint, text, text) to authenticated;
