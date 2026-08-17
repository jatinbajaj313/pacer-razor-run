import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BoardRow = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  org: string | null;
  gender: string | null;
  total_km: number;
  run_count: number;
  gps_runs: number;
  manual_runs: number;
  best_5k_seconds: number | null;
  best_10k_seconds: number | null;
  active_days: number;
  streak_days: number;
  improvement_pct: number | null;
};

export function useLeaderboard() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("leaderboard_boards");
    if (err) setError(err.message);
    else {
      setRows((data ?? []) as unknown as BoardRow[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("runs-leaderboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { rows, loading, error, reload: load };
}
