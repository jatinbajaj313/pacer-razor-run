import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MyRun = {
  id: string;
  distance_km: number;
  duration_seconds: number;
  ran_on: string;
  source: string;
  created_at: string;
};

export function useMyRuns(userId: string | undefined) {
  const [runs, setRuns] = useState<MyRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("runs")
      .select("id, distance_km, duration_seconds, ran_on, source, created_at")
      .eq("user_id", userId)
      .order("ran_on", { ascending: false });
    setRuns((data ?? []) as MyRun[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { runs, loading, reload: load };
}
