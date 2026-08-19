/**
 * Training load, via the acute:chronic workload ratio (ACWR).
 *
 * Acute load  = distance over the last 7 days.
 * Chronic load = average weekly distance over the last 28 days.
 * Ratio       = acute / chronic.
 *
 * The sports-science literature on ACWR puts injury risk sharply higher above
 * ~1.5 — that is, a week more than 50% heavier than what the body is used to.
 * This is the single most useful thing an app can tell a runner in the fortnight
 * before a race, because the usual reason people miss the start line is ramping
 * volume too fast at the end.
 *
 * It is a guide, not a diagnosis. ACWR is contested in the literature and says
 * nothing about intensity, sleep, or the niggle in someone's left knee.
 */

export type LoadZone = "baseline" | "detraining" | "optimal" | "caution" | "high" | "taper";

export type TrainingLoad = {
  acuteKm: number;
  chronicKm: number;
  /** null until there's enough history to mean anything. */
  ratio: number | null;
  zone: LoadZone;
  headline: string;
  detail: string;
  /** Distance that would bring this week back to a sensible ceiling. */
  suggestedCeilingKm: number | null;
};

const DAY = 864e5;
const localKey = (d: Date) => d.toLocaleDateString("en-CA");

/** Sum distance over the trailing `days` days, today inclusive. */
function sumTrailing(
  runs: { ran_on: string; distance_km: number }[],
  days: number,
  now: Date,
): number {
  const keys = new Set<string>();
  for (let i = 0; i < days; i++) keys.add(localKey(new Date(now.getTime() - i * DAY)));
  return runs
    .filter((r) => keys.has(r.ran_on))
    .reduce((s, r) => s + (r.distance_km || 0), 0);
}

/** Days on which anything was logged, over the trailing window. */
function activeDays(
  runs: { ran_on: string; distance_km: number }[],
  days: number,
  now: Date,
): number {
  const keys = new Set<string>();
  for (let i = 0; i < days; i++) keys.add(localKey(new Date(now.getTime() - i * DAY)));
  const hit = new Set(runs.filter((r) => keys.has(r.ran_on)).map((r) => r.ran_on));
  return hit.size;
}

export function trainingLoad(
  runs: { ran_on: string; distance_km: number }[],
  opts: { daysToRace?: number; now?: Date } = {},
): TrainingLoad {
  const now = opts.now ?? new Date();
  const daysToRace = opts.daysToRace ?? 999;

  const acuteKm = sumTrailing(runs, 7, now);
  const monthKm = sumTrailing(runs, 28, now);
  const chronicKm = monthKm / 4;

  // Not enough history for a ratio to say anything honest.
  const daysLogged = activeDays(runs, 28, now);
  if (daysLogged < 4 || chronicKm < 3) {
    return {
      acuteKm,
      chronicKm,
      ratio: null,
      zone: "baseline",
      headline: "Building your baseline",
      detail:
        "A few more runs and this will start flagging weeks that ramp up too fast for your body.",
      suggestedCeilingKm: null,
    };
  }

  const ratio = acuteKm / chronicKm;
  const ceiling = Math.round(chronicKm * 1.3 * 10) / 10;

  // In the final stretch, dropping volume is the plan, not a warning.
  if (daysToRace <= 10) {
    if (ratio > 1.3) {
      return {
        acuteKm,
        chronicKm,
        ratio,
        zone: "high",
        headline: "Too much, too close to the race",
        detail: `You're ${Math.round((ratio - 1) * 100)}% above your usual week with ${daysToRace} days to go. This is taper time — extra kilometres now cost you on race day rather than adding fitness.`,
        suggestedCeilingKm: ceiling,
      };
    }
    return {
      acuteKm,
      chronicKm,
      ratio,
      zone: "taper",
      headline: "Tapering — this is right",
      detail: `${acuteKm.toFixed(1)} km this week against a ${chronicKm.toFixed(1)} km average. Easing off in the last ${daysToRace} days is exactly what you want.`,
      suggestedCeilingKm: null,
    };
  }

  if (ratio > 1.5) {
    return {
      acuteKm,
      chronicKm,
      ratio,
      zone: "high",
      headline: "Your load jumped sharply",
      detail: `${acuteKm.toFixed(1)} km this week against a ${chronicKm.toFixed(1)} km average — ${Math.round((ratio - 1) * 100)}% more than your body is used to. This is where injuries happen. Hold this week at ${ceiling} km.`,
      suggestedCeilingKm: ceiling,
    };
  }
  if (ratio > 1.3) {
    return {
      acuteKm,
      chronicKm,
      ratio,
      zone: "caution",
      headline: "Ramping up quickly",
      detail: `${Math.round((ratio - 1) * 100)}% above your usual week. Fine for one week, risky if you repeat it. Keep next week near ${ceiling} km.`,
      suggestedCeilingKm: ceiling,
    };
  }
  if (ratio < 0.8) {
    return {
      acuteKm,
      chronicKm,
      ratio,
      zone: "detraining",
      headline: "Lighter than usual",
      detail: `${acuteKm.toFixed(1)} km against a ${chronicKm.toFixed(1)} km average. Fine if it's a recovery week or you're carrying a niggle — otherwise you're losing ground.`,
      suggestedCeilingKm: null,
    };
  }
  return {
    acuteKm,
    chronicKm,
    ratio,
    zone: "optimal",
    headline: "Load looks sustainable",
    detail: `${acuteKm.toFixed(1)} km this week, in line with your ${chronicKm.toFixed(1)} km average. This is the range where fitness builds without breaking you.`,
    suggestedCeilingKm: null,
  };
}

export const ZONE_COLOR: Record<LoadZone, string> = {
  baseline: "text-muted-foreground",
  detraining: "text-muted-foreground",
  optimal: "text-success",
  taper: "text-success",
  caution: "text-warning",
  high: "text-danger",
};
