create function public.search_books_for_cover(p_query text)
returns table (id bigint, title text, authors text[], cover_url text, google_books_id text)
language sql stable security invoker set search_path = ''
as $$
  with query as (
    select replace(replace(replace(trim(left(p_query, 120)), '\', '\\'), '%', '\%'), '_', '\_') as term
  )
  select b.id, b.title, b.authors, b.cover_url, b.google_books_id
  from public.books b cross join query q
  where length(q.term) >= 2 and (
    b.title ilike '%' || q.term || '%'
    or array_to_string(b.authors, ', ') ilike '%' || q.term || '%'
    or b.isbn_13 = q.term or b.isbn_10 = q.term
  )
  order by (lower(b.title) = lower(trim(p_query))) desc, b.title, b.id
  limit 30
$$;

create function public.save_admin_book_cover(
  p_book_id bigint, p_expected_cover text, p_cover text,
  p_title text, p_authors text[], p_work_key text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  saved_id bigint;
  catalog_key text;
  book_title text := trim(p_title);
  book_cover text := nullif(trim(p_cover), '');
begin
  if not exists (
    select 1 from public.admin_users a where a.user_id = auth.uid() and a.active
  ) then
    raise exception 'Active administrator required' using errcode = '42501';
  end if;

  if book_cover is not null and (
    length(book_cover) > 2048 or book_cover !~ '^https://[A-Za-z0-9.-]+(/[^[:space:][:cntrl:]]*)?$'
  ) then
    raise exception 'Choose a valid HTTPS cover image';
  end if;

  if p_book_id is not null then
    update public.books b set cover_url = book_cover, updated_at = now()
    where b.id = p_book_id and b.cover_url is not distinct from p_expected_cover
    returning b.id into saved_id;
    if not found then
      raise exception 'The cover changed. Search again before saving.';
    end if;
    return saved_id;
  end if;

  if book_title is null or length(book_title) not between 1 and 300
     or coalesce(cardinality(p_authors), 0) not between 1 and 20
     or exists (select 1 from unnest(p_authors) a where a is null or length(trim(a)) not between 1 and 300) then
    raise exception 'A title and author are required';
  end if;
  if p_work_key is not null then
    if p_work_key !~ '^OL[0-9]+W$' then
      raise exception 'Invalid catalog work reference';
    end if;
    catalog_key := 'OL-' || p_work_key;
  end if;

  -- Serialize additions through this entry point so simultaneous submissions
  -- check the same committed title and source identifiers before inserting.
  perform pg_catalog.pg_advisory_xact_lock(694217, 1);
  if exists (
    select 1 from public.books b
    where b.google_books_id = catalog_key or (
      regexp_replace(lower(b.title), '[^[:alnum:]]+', '', 'g') =
        regexp_replace(lower(book_title), '[^[:alnum:]]+', '', 'g')
      and regexp_replace(lower(array_to_string(b.authors, ',')), '[^[:alnum:]]+', '', 'g') =
        regexp_replace(lower(array_to_string(p_authors, ',')), '[^[:alnum:]]+', '', 'g')
    )
  ) then
    raise exception 'This book is already in Paper Gremlin. Search again to edit its cover.';
  end if;

  -- The existing books schema requires an ISBN field even when no ISBN exists.
  insert into public.books (isbn_13, google_books_id, title, authors, cover_url)
  values (
    'PG-' || gen_random_uuid()::text,
    catalog_key, book_title, p_authors, book_cover
  ) returning id into saved_id;
  return saved_id;
end;
$$;

revoke execute on function public.search_books_for_cover(text) from public, anon;
revoke execute on function public.save_admin_book_cover(bigint, text, text, text, text[], text) from public, anon;
grant execute on function public.search_books_for_cover(text) to authenticated;
grant execute on function public.save_admin_book_cover(bigint, text, text, text, text[], text) to authenticated;
