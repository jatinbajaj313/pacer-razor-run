REVOKE ALL ON FUNCTION public.leaderboard_totals() FROM anon;
REVOKE ALL ON FUNCTION public.leaderboard_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leaderboard_totals() TO authenticated;