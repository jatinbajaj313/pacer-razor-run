import { useCallback, useEffect, useRef, useState } from "react";
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

export type DepartmentRow = {
  org: string;
  member_count: number;
  active_count: number;
  participation_pct: number;
  total_km: number;
  km_per_member: number;
  km_per_active: number | null;
  run_count: number;
  active_days: number;
};

/** Postgres numeric arrives as a string over the wire in some setups. */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null =>
  v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * Every run logged by anyone fires a realtime event. Without a debounce, five
 * people finishing a group run means five full board queries back to back.
 */
const DEBOUNCE_MS = 400;

export function useLeaderboard() {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("leaderboard_boards");
    if (err) setError(err.message);
    else {
      setRows(
        ((data ?? []) as Record<string, unknown>[]).map((d) => ({
          user_id: String(d.user_id),
          name: String(d.name ?? ""),
          avatar_url: (d.avatar_url as string | null) ?? null,
          org: (d.org as string | null) ?? null,
          gender: (d.gender as string | null) ?? null,
          total_km: num(d.total_km),
          run_count: num(d.run_count),
          gps_runs: num(d.gps_runs),
          manual_runs: num(d.manual_runs),
          best_5k_seconds: numOrNull(d.best_5k_seconds),
          best_10k_seconds: numOrNull(d.best_10k_seconds),
          active_days: num(d.active_days),
          streak_days: num(d.streak_days),
          improvement_pct: numOrNull(d.improvement_pct),
        })),
      );
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();

    const queue = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("runs-leaderboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, queue)
      // profile edits matter too: the department and gender filters read from
      // profiles, so a colleague setting their department should show up without
      // them having to log a run first
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, queue)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { rows, loading, error, reload: load };
}

/** Team challenge: kilometres per head, so a big department can't win on size. */
export function useDepartments(minRunners = 2) {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("leaderboard_departments", {
      min_runners: minRunners,
    });
    if (err) setError(err.message);
    else {
      setRows(
        ((data ?? []) as Record<string, unknown>[]).map((d) => ({
          org: String(d.org ?? ""),
          member_count: num(d.member_count),
          active_count: num(d.active_count),
          participation_pct: num(d.participation_pct),
          total_km: num(d.total_km),
          km_per_member: num(d.km_per_member),
          km_per_active: numOrNull(d.km_per_active),
          run_count: num(d.run_count),
          active_days: num(d.active_days),
        })),
      );
      setError(null);
    }
    setLoading(false);
  }, [minRunners]);

  useEffect(() => {
    void load();

    const queue = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("dept-leaderboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, queue)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { rows, loading, error, reload: load };
}
