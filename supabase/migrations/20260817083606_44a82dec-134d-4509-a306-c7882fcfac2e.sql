DROP FUNCTION IF EXISTS public.leaderboard_totals();

CREATE OR REPLACE FUNCTION public.leaderboard_totals()
RETURNS TABLE (
  user_id uuid,
  name text,
  avatar_url text,
  org text,
  gender text,
  total_km numeric,
  run_count bigint,
  gps_runs bigint,
  manual_runs bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, p.org, p.gender,
         COALESCE(SUM(r.distance_km), 0)::numeric AS total_km,
         COUNT(r.id) AS run_count,
         COUNT(r.id) FILTER (WHERE r.source = 'gps') AS gps_runs,
         COUNT(r.id) FILTER (WHERE r.source = 'manual') AS manual_runs
  FROM public.profiles p
  LEFT JOIN public.runs r ON r.user_id = p.id
  WHERE auth.uid() IS NOT NULL
  GROUP BY p.id, p.name, p.avatar_url, p.org, p.gender
  ORDER BY total_km DESC
$$;

REVOKE ALL ON FUNCTION public.leaderboard_totals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leaderboard_totals() FROM anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_totals() TO authenticated;