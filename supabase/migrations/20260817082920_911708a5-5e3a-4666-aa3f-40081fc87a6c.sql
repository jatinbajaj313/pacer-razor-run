DROP POLICY IF EXISTS "Profiles are viewable by signed-in users" ON public.profiles;
CREATE POLICY "Users view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Runs are viewable by signed-in users" ON public.runs;
CREATE POLICY "Users view their own runs" ON public.runs FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.leaderboard_totals()
RETURNS TABLE (
  user_id uuid,
  name text,
  avatar_url text,
  org text,
  total_km numeric,
  run_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, p.org,
         COALESCE(SUM(r.distance_km), 0)::numeric AS total_km,
         COUNT(r.id) AS run_count
  FROM public.profiles p
  LEFT JOIN public.runs r ON r.user_id = p.id
  WHERE auth.uid() IS NOT NULL
  GROUP BY p.id, p.name, p.avatar_url, p.org
  ORDER BY total_km DESC
$$;

REVOKE ALL ON FUNCTION public.leaderboard_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leaderboard_totals() TO authenticated;