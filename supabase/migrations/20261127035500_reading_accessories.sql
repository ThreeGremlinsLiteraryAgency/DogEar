create table public.reading_accessories (
 id bigint generated always as identity primary key,
 name text not null check (length(trim(name)) between 1 and 160),
 description text not null default '' check (length(description)<=1000),
 product_url text not null check (length(product_url)<=2048 and product_url ~ '^https://[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+([/?#][^[:space:][:cntrl:]<>"\\]*)?$'),
 image_url text check (image_url is null or (length(image_url)<=2048 and image_url ~ '^https://[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+([/?#][^[:space:][:cntrl:]<>"\\]*)?$')),
 gremlins_approved boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.reading_accessories enable row level security;
grant select on public.reading_accessories to anon, authenticated;
grant insert, update on public.reading_accessories to authenticated;
create policy "Read reading accessories" on public.reading_accessories for select to anon,authenticated using (true);
create policy "Admins add reading accessories" on public.reading_accessories for insert to authenticated
 with check (public.is_listed_site_admin(auth.uid()));
create policy "Admins edit reading accessories" on public.reading_accessories for update to authenticated
 using (public.is_listed_site_admin(auth.uid())) with check (public.is_listed_site_admin(auth.uid()));
notify pgrst, 'reload schema';
