import { formatDuration, formatPace } from "./running";
import { trainingLoad, type TrainingLoad } from "./load";
import { riegel, type Session } from "./plan";

/**
 * The coach: Claude decides next week's training, this file makes that safe.
 *
 *   retrieve  -> buildCoachContext() assembles verified facts from the database
 *   classify  -> trainingLoad() computes load state; Claude reads the history
 *   decide    -> Claude returns a structured week (server route calls it)
 *   validate  -> validateCoachWeek() enforces rules Claude cannot override
 *   act       -> the UI writes it only after the runner approves
 *
 * The guardrails exist because a language model asked for a training plan will
 * occasionally produce something that would hurt someone: five hard sessions in
 * a row, or a 30 km long run for someone averaging 12 km a week. Those get
 * rejected here rather than shown as advice.
 */

export type CoachRun = {
  ran_on: string;
  distance_km: number;
  duration_seconds: number;
  source: string;
};

export type CoachContext = {
  today: string;
  daysToRace: number;
  raceDistanceKm: number;
  targetSeconds: number | null;
  targetLabel: string | null;
  goalPaceLabel: string | null;
  predictedSeconds: number | null;
  predictedLabel: string | null;
  load: {
    acuteKm: number;
    chronicKm: number;
    ratio: number | null;
    zone: TrainingLoad["zone"];
  };
  /** Hard ceiling for next week's volume. Claude is told this and cannot exceed it. */
  maxWeeklyKm: number;
  minRestDays: number;
  maxQualitySessions: number;
  recentRuns: { date: string; km: number; time: string; pace: string }[];
  weeklyKmLast4: number[];
  adherence: { plannedDays: number; ranDays: number };
};

export type CoachSession = {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  kind: Session["kind"];
  distanceKm: number;
  detail: string;
};

export type CoachWeek = {
  headline: string;
  reasoning: string;
  totalKm: number;
  sessions: CoachSession[];
};

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const QUALITY: Session["kind"][] = ["Intervals", "Tempo"];
const DAY = 864e5;
const localKey = (d: Date) => d.toLocaleDateString("en-CA");

function bestEffort(runs: CoachRun[]): { seconds: number; km: number } | null {
  let best: { seconds: number; km: number } | null = null;
  for (const r of runs) {
    if (r.distance_km < 2 || r.duration_seconds <= 0) continue;
    const pace = r.duration_seconds / r.distance_km;
    if (!best || pace < best.seconds / best.km) {
      best = { seconds: r.duration_seconds, km: r.distance_km };
    }
  }
  return best;
}

export function buildCoachContext(args: {
  runs: CoachRun[];
  raceDistanceKm: number;
  targetSeconds: number | null;
  daysToRace: number;
  now?: Date;
}): CoachContext {
  const now = args.now ?? new Date();
  const load = trainingLoad(args.runs, { daysToRace: args.daysToRace, now });

  const best = bestEffort(args.runs);
  const predictedSeconds = best
    ? riegel(best.seconds, best.km, args.raceDistanceKm)
    : null;
  const goalPace = args.targetSeconds ? args.targetSeconds / args.raceDistanceKm : null;

  // Weekly totals for the last four weeks, most recent first.
  const weeklyKmLast4 = [0, 1, 2, 3].map((w) => {
    const keys = new Set<string>();
    for (let d = w * 7; d < (w + 1) * 7; d++) {
      keys.add(localKey(new Date(now.getTime() - d * DAY)));
    }
    return (
      Math.round(
        args.runs
          .filter((r) => keys.has(r.ran_on))
          .reduce((s, r) => s + r.distance_km, 0) * 10,
      ) / 10
    );
  });

  // Volume ceiling: never more than 30% above what the body is used to, and in
  // the final ten days, below it. This is the rule Claude is not allowed to break.
  const base = load.chronicKm > 0 ? load.chronicKm : Math.max(8, args.raceDistanceKm * 1.5);
  let maxWeeklyKm = base * 1.3;
  if (args.daysToRace <= 10) maxWeeklyKm = base * 0.8;
  if (load.zone === "high") maxWeeklyKm = base;
  maxWeeklyKm = Math.round(maxWeeklyKm * 10) / 10;

  const last14 = args.runs.filter((r) => {
    const t = new Date(`${r.ran_on}T12:00:00`).getTime();
    return now.getTime() - t <= 14 * DAY;
  });

  return {
    today: localKey(now),
    daysToRace: args.daysToRace,
    raceDistanceKm: args.raceDistanceKm,
    targetSeconds: args.targetSeconds,
    targetLabel: args.targetSeconds ? formatDuration(args.targetSeconds) : null,
    goalPaceLabel: goalPace ? `${formatPace(goalPace)}/km` : null,
    predictedSeconds: predictedSeconds ? Math.round(predictedSeconds) : null,
    predictedLabel: predictedSeconds ? formatDuration(predictedSeconds) : null,
    load: {
      acuteKm: Math.round(load.acuteKm * 10) / 10,
      chronicKm: Math.round(load.chronicKm * 10) / 10,
      ratio: load.ratio == null ? null : Math.round(load.ratio * 100) / 100,
      zone: load.zone,
    },
    maxWeeklyKm,
    minRestDays: load.zone === "high" ? 3 : args.daysToRace <= 10 ? 2 : 1,
    maxQualitySessions: load.zone === "high" ? 1 : args.daysToRace <= 10 ? 1 : 2,
    recentRuns: [...args.runs]
      .sort((a, b) => (a.ran_on < b.ran_on ? 1 : -1))
      .slice(0, 12)
      .map((r) => ({
        date: r.ran_on,
        km: Math.round(r.distance_km * 100) / 100,
        time: formatDuration(r.duration_seconds),
        pace: `${formatPace(r.duration_seconds / r.distance_km)}/km`,
      })),
    weeklyKmLast4,
    adherence: {
      plannedDays: 14,
      ranDays: new Set(last14.map((r) => r.ran_on)).size,
    },
  };
}

export function coachSystemPrompt(): string {
  return [
    "You are a running coach writing next week's training for one runner preparing for a 10K-or-shorter company race.",
    "You will receive verified facts about their recent training. Use only those facts; never invent runs or times.",
    "",
    "Return ONLY a JSON object, no prose and no markdown fences, shaped exactly:",
    '{"headline": string, "reasoning": string, "totalKm": number, "sessions": [{"day":"Mon","kind":"Easy|Intervals|Tempo|Long|Rest","distanceKm":number,"detail":string}]}',
    "",
    "Hard rules you must not break:",
    "- Exactly 7 sessions, one per day, Mon through Sun in order.",
    "- Sum of distanceKm must not exceed maxWeeklyKm.",
    "- At least minRestDays sessions of kind Rest, with distanceKm 0.",
    "- At most maxQualitySessions of kind Intervals or Tempo, and never on consecutive days.",
    "- Long run no longer than 1.3x the race distance.",
    "- If daysToRace is 10 or fewer, no Intervals in the final 3 days before the race.",
    "",
    "headline: under 60 characters, what this week is for.",
    "reasoning: 2-3 sentences citing their actual numbers, addressed to them as 'you'. Be direct and specific. If their load ratio is high, say plainly that the priority is not getting injured.",
    "detail: the session in one short line, e.g. '6 x 600 m @ 4:05/km, 90 s jog' or 'Mobility and a 10 minute walk'.",
  ].join("\n");
}

export type Validation =
  | { ok: true; week: CoachWeek }
  | { ok: false; reasons: string[] };

/** Rules the model cannot talk its way out of. */
export function validateCoachWeek(raw: unknown, ctx: CoachContext): Validation {
  const reasons: string[] = [];
  const w = raw as Partial<CoachWeek> | null;

  if (!w || typeof w !== "object") return { ok: false, reasons: ["No plan returned."] };
  if (typeof w.headline !== "string" || !w.headline.trim()) reasons.push("Missing headline.");
  if (typeof w.reasoning !== "string" || !w.reasoning.trim()) reasons.push("Missing reasoning.");
  if (!Array.isArray(w.sessions) || w.sessions.length !== 7) {
    return { ok: false, reasons: [...reasons, "Plan must have exactly 7 days."] };
  }

  const sessions = w.sessions as CoachSession[];
  sessions.forEach((s, i) => {
    if (s.day !== DAY_ORDER[i]) reasons.push(`Day ${i + 1} should be ${DAY_ORDER[i]}.`);
    if (!["Easy", "Intervals", "Tempo", "Long", "Rest"].includes(s.kind)) {
      reasons.push(`Unknown session kind "${String(s.kind)}".`);
    }
    if (typeof s.distanceKm !== "number" || !Number.isFinite(s.distanceKm) || s.distanceKm < 0) {
      reasons.push(`${s.day}: invalid distance.`);
    }
    if (s.kind === "Rest" && s.distanceKm > 0) reasons.push(`${s.day}: rest days must be 0 km.`);
    if (typeof s.detail !== "string" || !s.detail.trim()) reasons.push(`${s.day}: missing detail.`);
  });

  const total = sessions.reduce((a, s) => a + (Number(s.distanceKm) || 0), 0);
  if (total > ctx.maxWeeklyKm + 0.01) {
    reasons.push(
      `Total ${total.toFixed(1)} km exceeds the ${ctx.maxWeeklyKm} km ceiling for this week.`,
    );
  }

  const rest = sessions.filter((s) => s.kind === "Rest").length;
  if (rest < ctx.minRestDays) {
    reasons.push(`Needs at least ${ctx.minRestDays} rest day(s), got ${rest}.`);
  }

  const quality = sessions.filter((s) => QUALITY.includes(s.kind));
  if (quality.length > ctx.maxQualitySessions) {
    reasons.push(
      `At most ${ctx.maxQualitySessions} hard session(s) this week, got ${quality.length}.`,
    );
  }
  for (let i = 1; i < sessions.length; i++) {
    if (QUALITY.includes(sessions[i].kind) && QUALITY.includes(sessions[i - 1].kind)) {
      reasons.push(`Hard sessions on consecutive days (${sessions[i - 1].day}, ${sessions[i].day}).`);
    }
  }

  const longest = Math.max(...sessions.map((s) => Number(s.distanceKm) || 0));
  if (longest > ctx.raceDistanceKm * 1.3 + 0.01) {
    reasons.push(
      `Longest run ${longest.toFixed(1)} km exceeds 1.3x race distance (${(ctx.raceDistanceKm * 1.3).toFixed(1)} km).`,
    );
  }

  if (ctx.daysToRace <= 10) {
    // The last three days before the race fall at the end of this week.
    const tail = sessions.slice(Math.max(0, 7 - Math.min(3, ctx.daysToRace)));
    if (tail.some((s) => s.kind === "Intervals")) {
      reasons.push("No interval work in the final 3 days before the race.");
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    week: {
      headline: w.headline!.trim(),
      reasoning: w.reasoning!.trim(),
      totalKm: Math.round(total * 10) / 10,
      sessions,
    },
  };
}
