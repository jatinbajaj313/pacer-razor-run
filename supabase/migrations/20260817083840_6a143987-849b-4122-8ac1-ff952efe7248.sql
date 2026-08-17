CREATE OR REPLACE FUNCTION public.leaderboard_boards()
RETURNS TABLE (
  user_id uuid,
  name text,
  avatar_url text,
  org text,
  gender text,
  total_km numeric,
  run_count integer,
  gps_runs integer,
  manual_runs integer,
  best_5k_seconds integer,
  best_10k_seconds integer,
  active_days integer,
  streak_days integer,
  improvement_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  with r as (
    select
      runs.user_id,
      runs.distance_km,
      runs.duration_seconds,
      runs.ran_on,
      runs.source,
      runs.created_at,
      runs.duration_seconds / nullif(runs.distance_km, 0) as pace,
      row_number() over (partition by runs.user_id order by runs.created_at asc) as rn_asc,
      row_number() over (partition by runs.user_id order by runs.created_at desc) as rn_desc,
      count(*) over (partition by runs.user_id) as total_runs
    from runs
  ),
  days as (
    select user_id, ran_on,
      ran_on - (row_number() over (partition by user_id order by ran_on))::int as grp
    from (select distinct user_id, ran_on from runs) d
  ),
  streaks as (
    select user_id, max(len) as streak_days from (
      select user_id, grp, count(*) as len, max(ran_on) as last_day
      from days group by user_id, grp
    ) s
    where last_day >= current_date - 1
    group by user_id
  ),
  agg as (
    select
      r.user_id,
      round(sum(r.distance_km)::numeric, 2) as total_km,
      count(*)::int as run_count,
      count(*) filter (where r.source = 'gps')::int as gps_runs,
      count(*) filter (where r.source = 'manual')::int as manual_runs,
      min(case when r.distance_km >= 4.8 then round(r.duration_seconds * 5.0 / r.distance_km) end)::int as best_5k_seconds,
      min(case when r.distance_km >= 9.5 then round(r.duration_seconds * 10.0 / r.distance_km) end)::int as best_10k_seconds,
      count(distinct r.ran_on)::int as active_days,
      avg(case when r.rn_asc <= 3 then r.pace end) as early_pace,
      avg(case when r.rn_desc <= 3 and r.total_runs >= 4 then r.pace end) as late_pace
    from r group by r.user_id
  )
  select
    p.id as user_id,
    p.name,
    p.avatar_url,
    p.org,
    p.gender,
    coalesce(a.total_km, 0) as total_km,
    coalesce(a.run_count, 0) as run_count,
    coalesce(a.gps_runs, 0) as gps_runs,
    coalesce(a.manual_runs, 0) as manual_runs,
    a.best_5k_seconds,
    a.best_10k_seconds,
    coalesce(a.active_days, 0) as active_days,
    coalesce(s.streak_days, 0)::int as streak_days,
    case when a.early_pace is not null and a.late_pace is not null and a.early_pace > 0
      then round(((a.early_pace - a.late_pace) / a.early_pace * 100)::numeric, 1) end as improvement_pct
  from profiles p
  left join agg a on a.user_id = p.id
  left join streaks s on s.user_id = p.id
  where p.onboarded = true
$$;

REVOKE ALL ON FUNCTION public.leaderboard_boards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_boards() TO authenticated;