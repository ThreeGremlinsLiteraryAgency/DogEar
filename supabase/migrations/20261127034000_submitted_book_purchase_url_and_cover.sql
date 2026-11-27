alter table public.books add column buy_url text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('book-covers','book-covers',true,1048576,array['image/webp']);

create policy "Active admins upload book covers" on storage.objects
for insert to authenticated with check (
  bucket_id='book-covers' and public.is_listed_site_admin(auth.uid())
  and name ~ '^[0-9]+/[0-9a-f-]{36}[.]webp$'
);
create policy "Admins clean up their own unattached book covers" on storage.objects
for delete to authenticated using (
  bucket_id='book-covers' and owner_id=auth.uid()::text and public.is_listed_site_admin(auth.uid())
  and not exists(select 1 from public.books b where b.cover_url=
    'https://nrtutxjznkfvvbmaagum.supabase.co/storage/v1/object/public/book-covers/'||storage.objects.name)
);

create function public.edit_submitted_book_media(p_book_id bigint,p_expected_updated_at timestamptz,
  p_title text,p_authors text[],p_subtitle text,p_isbn_13 text,p_isbn_10 text,
  p_publisher text,p_published_date text,p_description text,p_buy_url text,p_cover_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_url text := nullif(trim(p_buy_url),'');
begin
  if not public.is_listed_site_admin(auth.uid()) then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
  if target_url is not null and (length(target_url)>2048 or
    target_url !~ '^https://[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+([/?#][^[:space:][:cntrl:]<>"\\]*)?$')
    then raise exception 'Enter a valid HTTPS purchase URL'; end if;
  if p_cover_path is not null and (p_cover_path !~ ('^'||p_book_id::text||'/[0-9a-f-]{36}[.]webp$')
    or not exists(select 1 from storage.objects o where o.bucket_id='book-covers'
      and o.name=p_cover_path and o.owner_id=auth.uid()::text))
    then raise exception 'The cover upload could not be found'; end if;

  perform public.edit_submitted_book(p_book_id,p_expected_updated_at,p_title,p_authors,p_subtitle,
    p_isbn_13,p_isbn_10,p_publisher,p_published_date,p_description);
  update public.books b set buy_url=target_url,
    cover_url=case when p_cover_path is null then b.cover_url else
      'https://nrtutxjznkfvvbmaagum.supabase.co/storage/v1/object/public/book-covers/'||p_cover_path end,
    keep_generic_cover=case when p_cover_path is null then b.keep_generic_cover else true end
  where b.id=p_book_id;
end $$;
revoke execute on function public.edit_submitted_book_media(bigint,timestamptz,text,text[],text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.edit_submitted_book_media(bigint,timestamptz,text,text[],text,text,text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
