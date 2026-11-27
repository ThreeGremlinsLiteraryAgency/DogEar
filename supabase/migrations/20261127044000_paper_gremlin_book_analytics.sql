create table public.book_activity_daily (
 day date not null,
 book_key text not null,
 placement text not null check (placement in ('book_page','marketplace')),
 views bigint not null default 0,
 buy_clicks bigint not null default 0,
 primary key(day,book_key,placement)
);
alter table public.book_activity_daily enable row level security;
revoke all on public.book_activity_daily from anon,authenticated;

create function public.record_book_activity(p_book_key text,p_placement text,p_event text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_placement is null or p_event is null or p_placement not in ('book_page','marketplace') or p_event not in ('view','buy')
    or p_book_key is null then return; end if;
  if not (
    (p_book_key ~ '^local:[0-9]{1,18}$' and exists (
      select 1 from public.books b where b.id=substring(p_book_key from '^local:([0-9]{1,18})$')::bigint
        and b.verification_status is distinct from 'needs_verification'))
    or (p_book_key ~ '^OL[0-9]{1,18}W$' and exists (
      select 1 from public.book_catalog_works w where w.source_work_key in (p_book_key,'/works/'||p_book_key)))
  ) then return; end if;
  insert into public.book_activity_daily(day,book_key,placement,views,buy_clicks)
  values((now() at time zone 'America/New_York')::date,p_book_key,p_placement,
    (p_event='view')::int,(p_event='buy')::int)
  on conflict(day,book_key,placement) do update
  set views=public.book_activity_daily.views+excluded.views,
    buy_clicks=public.book_activity_daily.buy_clicks+excluded.buy_clicks;
end $$;
revoke execute on function public.record_book_activity(text,text,text) from public;
grant execute on function public.record_book_activity(text,text,text) to anon,authenticated;

create function public.read_book_analytics(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  start_at timestamptz := p_start::timestamp at time zone 'America/New_York';
  end_at timestamptz := (p_end+1)::timestamp at time zone 'America/New_York';
  result jsonb;
begin
  if not public.is_site_admin() or not public.is_listed_site_admin(auth.uid()) then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_end<p_start then raise exception 'Choose a valid date range'; end if;
  with picks as (
    select b.club_id,coalesce(o.title,'Untitled') as title,coalesce(nullif(trim(c.genre),''),'Uncategorized') as genre
    from public.club_ballots b join public.club_ballot_options o on o.id=b.winner_option_id
    join public.clubs c on c.id=b.club_id
    where b.winner_option_id is not null and c.is_public is true
      and b.ballot_month between p_start and p_end
  ), saves as (
    select u.book_id,count(*) n from public.user_books u join public.books b on b.id=u.book_id
    where u.created_at>=start_at and u.created_at<end_at
      and b.verification_status is distinct from 'needs_verification'
    group by u.book_id
  ), traffic as (
    select book_key,sum(views) views,sum(buy_clicks) clicks
    from public.book_activity_daily where day between p_start and p_end group by book_key
  ), titles as (
    select book_key,max(title) title,sum(views) views,sum(clicks) clicks,sum(saved) saves from (
      select t.book_key,coalesce(b.title,w.title,t.book_key) title,t.views,t.clicks,0 saved
      from traffic t left join public.books b on 'local:'||b.id=t.book_key
      left join lateral(select x.title from public.book_catalog_works x
        where x.source_work_key in (t.book_key,'/works/'||t.book_key) limit 1) w on b.id is null
      union all
      select 'local:'||b.id,b.title,0,0,s.n from saves s join public.books b on b.id=s.book_id
    ) t group by book_key
  )
  select jsonb_build_object(
    'total_clubs',(select count(distinct club_id) from picks),
    'total_picks',(select count(*) from picks),
    'total_saves',coalesce((select sum(n) from saves),0),
    'total_views',coalesce((select sum(views) from traffic),0),
    'total_clicks',coalesce((select sum(clicks) from traffic),0),
    'titles',coalesce((select jsonb_agg(to_jsonb(x) order by clicks desc,saves desc,views desc,title)
      from (select title,views,clicks,saves from titles) x),'[]'::jsonb),
    'picks',coalesce((select jsonb_agg(to_jsonb(x) order by picks desc,title)
      from (select title,genre,count(*) picks from picks group by title,genre) x),'[]'::jsonb),
    'placements',coalesce((select jsonb_agg(to_jsonb(x) order by placement)
      from (select placement,sum(buy_clicks) clicks from public.book_activity_daily
        where day between p_start and p_end group by placement having sum(buy_clicks)>0) x),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke execute on function public.read_book_analytics(date,date) from public,anon;
grant execute on function public.read_book_analytics(date,date) to authenticated;
notify pgrst,'reload schema';
