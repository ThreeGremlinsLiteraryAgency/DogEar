drop policy if exists "Public can read marketplace settings" on public.marketplace_settings;
create policy "Public can read marketplace settings"
  on public.marketplace_settings
  for select
  to anon
  using (true);

drop policy if exists "Public can read active curated books" on public.marketplace_curated_books;
create policy "Public can read active curated books"
  on public.marketplace_curated_books
  for select
  to anon
  using (
    active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

drop policy if exists "Public can read enabled coin rewards" on public.coin_rewards;
create policy "Public can read enabled coin rewards"
  on public.coin_rewards
  for select
  to anon
  using (
    active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
    and exists (
      select 1
      from public.marketplace_settings settings
      where settings.id = 1
        and settings.coins_enabled = true
        and settings.coin_marketplace_enabled = true
    )
  );

grant select on public.marketplace_settings to anon;
grant select on public.marketplace_curated_books to anon;
grant select on public.coin_rewards to anon;
