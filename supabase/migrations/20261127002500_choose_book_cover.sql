create policy "Read numbered cover templates" on public.book_cover_templates
for select to authenticated using (true);
grant select on public.book_cover_templates to authenticated;

create function public.choose_book_cover(p_book_id bigint, p_number smallint, p_keep boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed bigint;
begin
  if p_keep is null then raise exception 'Choose a cover preference'; end if;
  perform pg_catalog.pg_advisory_xact_lock(694217,1);
  update public.books b
  set cover_template = t.number, keep_generic_cover = p_keep,
      cover_url = case when p_keep then t.url else coalesce(b.verified_cover_url,t.url) end,
      updated_at = now()
  from public.book_cover_templates t
  where t.number = p_number and b.id = p_book_id and b.cover_template is not null
    and (b.submitted_by = auth.uid() or exists (
      select 1 from public.admin_users a where a.user_id = auth.uid() and a.active))
  returning b.id into changed;
  return changed is not null;
end $$;

create function public.submit_missing_book_with_cover(p_title text, p_author text, p_isbn text,
  p_year integer, p_reading_date date, p_cover_template smallint, p_keep_cover boolean)
returns bigint language plpgsql security definer set search_path = '' as $$
declare book bigint;
begin
  if p_cover_template is not null and p_cover_template not between 1 and 10
    then raise exception 'Select a cover from the available designs'; end if;
  book := public.submit_missing_book(p_title,p_author,p_isbn,p_year,p_reading_date,p_keep_cover);
  if p_cover_template is not null then
    perform public.choose_book_cover(book,p_cover_template,coalesce(p_keep_cover,false));
  end if;
  return book;
end $$;

revoke execute on function public.choose_book_cover(bigint,smallint,boolean) from public, anon;
revoke execute on function public.submit_missing_book_with_cover(text,text,text,integer,date,smallint,boolean) from public, anon;
grant execute on function public.choose_book_cover(bigint,smallint,boolean) to authenticated;
grant execute on function public.submit_missing_book_with_cover(text,text,text,integer,date,smallint,boolean) to authenticated;

-- Match the current template URL, including artwork replaced in the admin panel.
create function public.current_book_cover_template(p_book_id bigint)
returns smallint language sql stable security definer set search_path = '' as $$
  select t.number from public.books b join public.book_cover_templates t
    on t.number = b.cover_template and t.url = b.cover_url
  where b.id = p_book_id and (b.verification_status is distinct from 'needs_verification'
    or public.can_read_pending_book(b.id,b.submitted_by))
$$;
revoke execute on function public.current_book_cover_template(bigint) from public;
grant execute on function public.current_book_cover_template(bigint) to anon, authenticated;
