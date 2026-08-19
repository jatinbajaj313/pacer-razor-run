import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { requestCoachWeek, type CoachResponse } from "@/lib/coach.functions";
import {
  buildCoachContext,
  coachSystemPrompt,
  validateCoachWeek,
  type CoachContext,
  type CoachRun,
  type CoachSession,
  type CoachWeek,
} from "@/lib/coach";

export type CoachState =
  | { status: "idle" }
  | { status: "thinking" }
  | { status: "ready"; week: CoachWeek; context: CoachContext }
  | { status: "rejected"; reasons: string[]; context: CoachContext }
  | { status: "error"; message: string };

/** Monday of the week that starts after today, as YYYY-MM-DD. */
function nextMonday(now = new Date()): string {
  const d = new Date(now);
  const daysUntilMonday = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toLocaleDateString("en-CA");
}

export function useCoach(args: {
  userId: string | undefined;
  runs: CoachRun[];
  raceDistanceKm: number;
  targetSeconds: number | null;
  daysToRace: number;
}) {
  const [state, setState] = useState<CoachState>({ status: "idle" });
  const [saving, setSaving] = useState(false);

  const generate = useCallback(async () => {
    if (!args.userId) {
      setState({ status: "error", message: "Sign in first." });
      return;
    }
    const context = buildCoachContext({
      runs: args.runs,
      raceDistanceKm: args.raceDistanceKm,
      targetSeconds: args.targetSeconds,
      daysToRace: args.daysToRace,
    });

    setState({ status: "thinking" });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("Sign in again and retry.");

      const payload = (await requestCoachWeek({
        data: { context, systemPrompt: coachSystemPrompt(), accessToken },
      })) as CoachResponse;
      if (payload.error) throw new Error(payload.error);

      // Guardrails run on the client too: a plan that breaks a safety rule is
      // never shown as advice, even if the model was confident about it.
      const verdict = validateCoachWeek(payload.week, context);
      if (verdict.ok) setState({ status: "ready", week: verdict.week, context });
      else setState({ status: "rejected", reasons: verdict.reasons, context });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "The coach is unavailable.",
      });
    }
  }, [args.userId, args.runs, args.raceDistanceKm, args.targetSeconds, args.daysToRace]);

  /** The irreversible step — only reachable after the runner has read the plan. */
  const approve = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (state.status !== "ready" || !args.userId) return { ok: false };
    setSaving(true);
    try {
      const { error } = await supabase.from("plan_weeks").upsert(
        {
          user_id: args.userId,
          week_start: nextMonday(),
          headline: state.week.headline,
          reasoning: state.week.reasoning,
          total_km: state.week.totalKm,
          sessions: state.week.sessions,
          approved_at: new Date().toISOString(),
        },
        { onConflict: "user_id,week_start" },
      );
      if (error) return { ok: false, message: error.message };
      setState({ status: "idle" });
      return { ok: true };
    } finally {
      setSaving(false);
    }
  }, [state, args.userId]);

  const discard = useCallback(() => setState({ status: "idle" }), []);

  return { state, saving, generate, approve, discard, weekStart: nextMonday() };
}

/**
 * Calendar file for the approved week — no OAuth needed, works with Google
 * Calendar, Outlook and Apple Calendar. Sessions land at 06:00 IST.
 */
export function weekToIcs(week: CoachWeek, weekStart: string): string {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const start = new Date(`${weekStart}T00:00:00+05:30`);
  const pad = (n: number) => String(n).padStart(2, "0");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pacer//Razor Run 2026//EN",
    "CALSCALE:GREGORIAN",
  ];

  week.sessions.forEach((s: CoachSession) => {
    if (s.kind === "Rest") return;
    const offset = days.indexOf(s.day);
    if (offset < 0) return;
    const d = new Date(start.getTime() + offset * 864e5);
    const y = d.getFullYear();
    const stamp = `${y}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const title = `${s.kind}${s.distanceKm > 0 ? ` · ${s.distanceKm} km` : ""}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:pacer-${stamp}-${s.day}@razorpay`,
      `DTSTAMP:${stamp}T000000Z`,
      `DTSTART;TZID=Asia/Kolkata:${stamp}T060000`,
      `DTEND;TZID=Asia/Kolkata:${stamp}T070000`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${s.detail.replace(/[\n,;]/g, " ")}`,
      "END:VEVENT",
    );
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
