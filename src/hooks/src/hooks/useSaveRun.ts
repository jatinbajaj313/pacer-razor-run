import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkRun } from "@/lib/running";

export type RunSource = "gps" | "manual" | "import";

export type NewRun = {
  distanceKm: number;
  seconds: number;
  /** YYYY-MM-DD. Defaults to today. Imports should pass the file's own date. */
  ranOn?: string;
  source: RunSource;
};

export type SaveResult = { ok: true } | { ok: false; reason: string };

const today = () => new Date().toLocaleDateString("en-CA"); // local date, not UTC

/**
 * Single entry point for writing a run. Everything goes through checkRun first,
 * so an implausible entry can't reach the leaderboard from any direction —
 * typed by hand, finished on GPS, or imported from a watch file.
 */
export function useSaveRun(userId: string | undefined) {
  const [saving, setSaving] = useState(false);

  const saveRun = useCallback(
    async (run: NewRun): Promise<SaveResult> => {
      if (!userId) return { ok: false, reason: "Sign in before logging a run." };

      const check = checkRun(run.distanceKm, run.seconds);
      if (!check.ok) return check;

      const ranOn = run.ranOn ?? today();
      if (ranOn > today()) {
        return { ok: false, reason: "That date is in the future." };
      }

      setSaving(true);
      try {
        const { error } = await supabase.from("runs").insert({
          user_id: userId,
          distance_km: Number(run.distanceKm.toFixed(3)),
          duration_seconds: Math.round(run.seconds),
          ran_on: ranOn,
          source: run.source,
        });
        if (error) return { ok: false, reason: error.message };
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          reason: e instanceof Error ? e.message : "Could not save that run. Try again.",
        };
      } finally {
        setSaving(false);
      }
    },
    [userId],
  );

  return { saveRun, saving };
}
