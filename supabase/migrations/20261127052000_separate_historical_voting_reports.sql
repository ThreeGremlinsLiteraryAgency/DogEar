create function public.read_historical_voting(p_first date,p_last date,p_summary boolean,p_matchups boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_site_admin() or not public.is_listed_site_admin(auth.uid()) then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
  if p_first is null or p_last is null or p_first>p_last
     or extract(day from p_first)<>1 or extract(day from p_last)<>1 then
    raise exception 'Choose a valid month range';
  end if;
  with eligible as (
    select b.id,b.club_id,b.ballot_month,b.winner_option_id,
      coalesce(nullif(trim(c.genre),''),'Uncategorized') genre
    from public.club_ballots b join public.clubs c on c.id=b.club_id
    where c.is_public is true and b.status in ('closed','finalized')
      and b.ballot_month>=p_first and b.ballot_month<(p_last+interval '1 month')::date
      and b.ballot_month<date_trunc('month',now() at time zone 'America/New_York')::date
  ), vote_counts as (
    select v.ballot_id,v.option_id,count(*) votes
    from public.club_votes v join eligible b on b.id=v.ballot_id and b.club_id=v.club_id
    group by v.ballot_id,v.option_id
  ), nominees as (
    select b.id ballot,b.club_id,b.ballot_month,b.genre,b.winner_option_id,
      o.id,o.position,coalesce(nullif(trim(o.title),''),book.title,'Untitled') title,
      public.book_identity(coalesce(nullif(trim(o.title),''),book.title,'Untitled')) title_key,
      public.book_identity(coalesce(array_to_string(o.authors,','),array_to_string(book.authors,','),'')) author_key,
      coalesce(v.votes,0) votes
    from eligible b join public.club_ballot_options o on o.ballot_id=b.id and o.club_id=b.club_id
    left join public.books book on book.id=o.book_id
    left join vote_counts v on v.ballot_id=b.id and v.option_id=o.id
    where o.is_active is distinct from false or v.votes>0 or o.id=b.winner_option_id
  ), summary as (
    select ballot_month,min(title) title,sum(votes) votes,count(distinct club_id) clubs,
      count(distinct ballot) filter(where id=winner_option_id) wins
    from nominees where p_summary group by ballot_month,title_key,author_key
  ), matchups as (
    select ballot,ballot_month,genre,max(title) filter(where id=winner_option_id) winner,
      jsonb_agg(jsonb_build_object('title',title,'votes',votes,'position',position)
        order by position,id) nominees
    from nominees where p_matchups group by ballot,ballot_month,genre
  )
  select jsonb_build_object(
    'summary',coalesce((select jsonb_agg(to_jsonb(x) order by ballot_month desc,votes desc,title)
      from summary x),'[]'::jsonb),
    'matchups',coalesce((select jsonb_agg(to_jsonb(x) order by ballot_month desc,ballot)
      from matchups x),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke execute on function public.read_historical_voting(date,date,boolean,boolean) from public,anon;
grant execute on function public.read_historical_voting(date,date,boolean,boolean) to authenticated;
notify pgrst,'reload schema';
