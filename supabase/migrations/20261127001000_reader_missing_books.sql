alter table public.books
  add column verification_status text,
  add column submitted_by uuid references auth.users(id) on delete set null,
  add column cover_template smallint check (cover_template between 1 and 10),
  add column keep_generic_cover boolean not null default false,
  add column verified_cover_url text,
  add constraint book_submission_status check (verification_status in
    ('needs_verification', 'community_unverified', 'verified', 'manually_verified'));

create table public.book_cover_templates (
  number smallint primary key check (number between 1 and 10),
  url text not null
);
alter table public.book_cover_templates enable row level security;
insert into public.book_cover_templates
select n, 'https://threegremlinsliteraryagency.github.io/DogEar/assets/cover-templates/' ||
  lpad(n::text,4,'0') || '.webp' from generate_series(1,10) n;

create function public.book_identity(value text) returns text
language sql immutable set search_path = ''
as $$ select regexp_replace(lower(value), '[^[:alnum:]]+', '', 'g') $$;

create unique index community_book_identity on public.books
  (public.book_identity(title), public.book_identity(authors[1]))
  where verification_status in ('needs_verification','community_unverified');

create function public.can_read_pending_book(p_book_id bigint, p_submitter uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_submitter = auth.uid()
    or exists (select 1 from public.user_books u where u.book_id = p_book_id and u.user_id = auth.uid())
    or exists (select 1 from public.admin_users a where a.user_id = auth.uid() and a.active)
  )
$$;
revoke execute on function public.can_read_pending_book(bigint,uuid) from public;
grant execute on function public.can_read_pending_book(bigint,uuid) to anon, authenticated;

create policy "Limit unscreened books to submitting readers and admins"
on public.books as restrictive for select to anon, authenticated using (
  verification_status is distinct from 'needs_verification'
  or public.can_read_pending_book(id, submitted_by)
);

create function public.submit_missing_book(p_title text, p_author text, p_isbn text,
  p_year integer, p_reading_date date, p_keep_cover boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  reader uuid := auth.uid();
  title_input text := trim(p_title);
  author_input text := trim(p_author);
  isbn text := nullif(upper(regexp_replace(coalesce(p_isbn,''), '[[:space:]-]', '', 'g')), '');
  canonical text;
  template public.book_cover_templates%rowtype;
  book_id_result bigint;
  checksum integer;
begin
  if reader is null then raise exception 'Sign in to add a book'; end if;
  if coalesce(length(title_input),0) not between 1 and 300
    or coalesce(length(author_input),0) not between 1 and 300
    or public.book_identity(title_input) = '' or public.book_identity(author_input) = ''
    or (p_year is not null and p_year not between 1 and 9999) then
    raise exception 'Enter a valid title, author and publication year';
  end if;
  if isbn ~ '^[0-9]{9}[0-9X]$' then
    select sum(case when substr(isbn,i,1) = 'X' then 10 else substr(isbn,i,1)::int end * (11-i))
      into checksum from generate_series(1,10) i;
    if checksum % 11 <> 0 then raise exception 'Enter a valid ISBN'; end if;
    canonical := '978' || left(isbn,9);
    select canonical || ((10 - sum(substr(canonical,i,1)::int *
      case when i % 2 = 0 then 3 else 1 end) % 10) % 10)::text into canonical
      from generate_series(1,12) i;
  elsif isbn is not null then
    if isbn !~ '^97[89][0-9]{10}$' then raise exception 'Enter a valid ISBN'; end if;
    select sum(substr(isbn,i,1)::int * case when i % 2 = 0 then 3 else 1 end)
      into checksum from generate_series(1,13) i;
    if checksum % 10 <> 0 then raise exception 'Enter a valid ISBN'; end if;
    canonical := isbn;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(694217,1);
  select b.id into book_id_result from public.books b
  where b.isbn_13 = canonical or b.isbn_10 = isbn or
    (public.book_identity(b.title) = public.book_identity(title_input)
      and exists (select 1 from unnest(b.authors) a where public.book_identity(a) = public.book_identity(author_input)))
  order by coalesce(b.isbn_13 = canonical or b.isbn_10 = isbn, false) desc,
    (b.verification_status is distinct from 'needs_verification') desc, b.id
  limit 1;

  if book_id_result is null then
    if (select count(*) from public.books where submitted_by = reader
      and created_at >= now() - interval '1 day') >= 20 then
      raise exception 'Daily new-book limit reached. Try again tomorrow.';
    end if;
    select * into template from public.book_cover_templates order by random() limit 1;
    insert into public.books (isbn_13,isbn_10,title,authors,published_date,cover_url,
      verification_status,submitted_by,cover_template,keep_generic_cover)
    values (coalesce(canonical,'PG-' || gen_random_uuid()::text),
      case when length(isbn)=10 then isbn end,title_input,array[author_input],p_year::text,
      template.url,'needs_verification',reader,template.number,coalesce(p_keep_cover,false))
    returning id into book_id_result;
  end if;

  insert into public.user_books(user_id,book_id) values(reader,book_id_result) on conflict do nothing;
  if p_reading_date is not null then
    insert into public.reading_calendar_entries(user_id,book_id,reading_date)
      values(reader,book_id_result,p_reading_date) on conflict do nothing;
  end if;
  return book_id_result;
end $$;

create function public.review_missing_book(p_book_id bigint, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid() and active)
    then raise exception 'Active administrator required'; end if;
  if p_status is null or p_status not in ('needs_verification','community_unverified','manually_verified')
    then raise exception 'Invalid review status'; end if;
  update public.books set verification_status = p_status, updated_at = now()
  where id = p_book_id and submitted_by is not null;
end $$;

create function public.replace_book_cover_template(p_number smallint, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare previous_url text;
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid() and active)
    then raise exception 'Active administrator required'; end if;
  if p_url is null or length(p_url) > 2048 or p_url !~ '^https://[A-Za-z0-9.-]+/[^[:space:][:cntrl:]"<>]*$'
    then raise exception 'Enter a valid HTTPS image URL'; end if;
  perform pg_catalog.pg_advisory_xact_lock(694217,1);
  select url into strict previous_url from public.book_cover_templates where number = p_number;
  update public.book_cover_templates set url = p_url where number = p_number;
  update public.books set cover_url = p_url, updated_at = now()
    where cover_template = p_number and cover_url = previous_url;
end $$;

revoke execute on function public.submit_missing_book(text,text,text,integer,date,boolean) from public, anon;
revoke execute on function public.review_missing_book(bigint,text) from public, anon;
revoke execute on function public.replace_book_cover_template(smallint,text) from public, anon;
grant execute on function public.submit_missing_book(text,text,text,integer,date,boolean) to authenticated;
grant execute on function public.review_missing_book(bigint,text) to authenticated;
grant execute on function public.replace_book_cover_template(smallint,text) to authenticated;

create function public.keep_missing_book_cover(p_book_id bigint, p_keep boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.books b set keep_generic_cover = p_keep, updated_at = now(),
    cover_url = case
      when p_keep then (select url from public.book_cover_templates where number = b.cover_template)
      else coalesce(b.verified_cover_url,b.cover_url) end
  where b.id = p_book_id and b.cover_template is not null
    and (b.submitted_by = auth.uid() or exists (
      select 1 from public.admin_users a where a.user_id = auth.uid() and a.active));
  if not found then raise exception 'Cover settings are unavailable for this book'; end if;
end $$;

create function public.verify_missing_book(p_book_id bigint, p_work_key text,
  p_title text, p_authors text[], p_year integer, p_cover text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed bigint;
begin
  if p_work_key !~ '^OL[0-9]+W$' then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(694217,1);
  if exists (select 1 from public.books where google_books_id = 'OL-' || p_work_key
      and id <> p_book_id) then return false; end if;
  update public.books b set google_books_id = 'OL-' || p_work_key, title = p_title,
    authors = p_authors, published_date = coalesce(b.published_date,p_year::text),
    cover_url = case when not b.keep_generic_cover and p_cover is not null then p_cover else b.cover_url end,
    verified_cover_url = p_cover, verification_status = 'verified', updated_at = now()
  where b.id = p_book_id and b.verification_status = 'needs_verification'
  returning id into changed;
  return changed is not null;
end $$;

revoke execute on function public.keep_missing_book_cover(bigint,boolean) from public, anon;
grant execute on function public.keep_missing_book_cover(bigint,boolean) to authenticated;
revoke execute on function public.verify_missing_book(bigint,text,text,text[],integer,text) from public, anon, authenticated;
grant execute on function public.verify_missing_book(bigint,text,text,text[],integer,text) to service_role;

create function public.list_missing_books()
returns table(id bigint, title text, authors text[], verification_status text,
  cover_template smallint, keep_generic_cover boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admin_users a where a.user_id = auth.uid() and a.active)
    then raise exception 'Active administrator required'; end if;
  return query select b.id,b.title,b.authors,b.verification_status,b.cover_template,b.keep_generic_cover
  from public.books b where b.verification_status in ('needs_verification','community_unverified')
  order by (b.verification_status = 'needs_verification') desc,b.created_at desc limit 100;
end $$;
revoke execute on function public.list_missing_books() from public, anon;
grant execute on function public.list_missing_books() to authenticated;

create function public.find_submitted_books(p_query text) returns setof public.books
language sql stable security invoker set search_path = '' as $$
  select b.* from public.books b
  where b.submitted_by is not null and length(trim(p_query)) between 2 and 300
    and (strpos(lower(b.title),lower(trim(p_query))) > 0
      or exists (select 1 from unnest(b.authors) a where strpos(lower(a),lower(trim(p_query))) > 0)
      or b.isbn_13 = regexp_replace(upper(p_query),'[[:space:]-]','','g')
      or b.isbn_10 = regexp_replace(upper(p_query),'[[:space:]-]','','g'))
  order by b.title,b.id limit 30
$$;
grant execute on function public.find_submitted_books(text) to anon, authenticated;

-- Keep existing Google-era records readable, but do not accept new Google IDs.
create function public.require_open_library_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.google_books_id is not null and new.google_books_id !~ '^OL-OL[0-9]+W$' then
    if tg_op = 'INSERT' or new.google_books_id is distinct from old.google_books_id then
      raise exception 'Google Books imports are disabled. Use Open Library.';
    end if;
  end if;
  return new;
end $$;
create trigger require_open_library_source before insert or update of google_books_id
  on public.books for each row execute function public.require_open_library_source();
