create function public.edit_submitted_book(p_book_id bigint,p_expected_updated_at timestamptz,
  p_title text,p_authors text[],p_subtitle text,p_isbn_13 text,p_isbn_10 text,
  p_publisher text,p_published_date text,p_description text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  isbn13 text := nullif(regexp_replace(coalesce(p_isbn_13,''),'[[:space:]-]','','g'),'');
  isbn10 text := nullif(upper(regexp_replace(coalesce(p_isbn_10,''),'[[:space:]-]','','g')),'');
begin
  if not exists (select 1 from public.admin_users a where a.user_id=auth.uid() and a.active)
    then raise exception 'Active administrator required' using errcode='42501'; end if;
  if coalesce(length(trim(p_title)),0) not between 1 and 300
    or coalesce(cardinality(p_authors),0) not between 1 and 20
    or exists(select 1 from unnest(p_authors) a where coalesce(length(trim(a)),0) not between 1 and 300)
    or length(p_subtitle)>300 or length(p_publisher)>300
    or length(p_published_date)>40 or length(p_description)>10000 then
    raise exception 'Enter a title and at least one author, within the field limits';
  end if;
  if isbn13 is not null and (isbn13 !~ '^97[89][0-9]{10}$' or
    (select sum(substring(isbn13,i,1)::int * case when i%2=0 then 3 else 1 end) from generate_series(1,13) i)%10<>0)
    then raise exception 'Enter a valid ISBN-13'; end if;
  if isbn10 is not null and (isbn10 !~ '^[0-9]{9}[0-9X]$' or
    (select sum(case when substring(isbn10,i,1)='X' then 10 else substring(isbn10,i,1)::int end * (11-i)) from generate_series(1,10) i)%11<>0)
    then raise exception 'Enter a valid ISBN-10'; end if;

  perform pg_catalog.pg_advisory_xact_lock(694217,1);
  if exists(select 1 from public.books b where b.id<>p_book_id and
    (b.isbn_13=isbn13 or b.isbn_10=isbn10)) then
    raise exception 'That ISBN is already assigned to another book';
  end if;
  update public.books b set title=trim(p_title),authors=array(select trim(a) from unnest(p_authors) a),
    subtitle=nullif(trim(p_subtitle),''),isbn_13=coalesce(isbn13,
      case when b.isbn_13 like 'PG-%' then b.isbn_13 end,'PG-'||gen_random_uuid()::text),
    isbn_10=isbn10,publisher=nullif(trim(p_publisher),''),
    published_date=nullif(trim(p_published_date),''),description=nullif(trim(p_description),''),
    updated_at=clock_timestamp()
  where b.id=p_book_id and b.submitted_by is not null and b.updated_at=p_expected_updated_at;
  if not found then raise exception 'The book changed or is unavailable. Close and reopen the editor.'; end if;
end $$;

revoke execute on function public.edit_submitted_book(bigint,timestamptz,text,text[],text,text,text,text,text,text) from public, anon;
grant execute on function public.edit_submitted_book(bigint,timestamptz,text,text[],text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
