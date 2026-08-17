import { formatDuration, formatPace } from "./running";

/** Riegel: T2 = T1 * (d2/d1)^1.06 */
export function riegel(t1Seconds: number, d1Km: number, d2Km: number): number {
  return t1Seconds * Math.pow(d2Km / d1Km, 1.06);
}

export type Session = {
  day: string;
  kind: "Easy" | "Intervals" | "Tempo" | "Long" | "Rest";
  detail: string;
};

export type PlanInput = {
  raceDistanceKm: number;
  targetSeconds: number | null;
  bestSeconds: number | null;
  bestDistanceKm: number | null;
  weeklyKm: number;
  bmi: number | null;
  age: number | null;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildPlan(input: PlanInput): {
  sessions: Session[];
  weeklyTargetKm: number;
  predictedSeconds: number | null;
  goalPaceSecPerKm: number | null;
  note: string;
} {
  const predictedSeconds =
    input.bestSeconds && input.bestDistanceKm
      ? riegel(input.bestSeconds, input.bestDistanceKm, input.raceDistanceKm)
      : null;

  const goalPaceSecPerKm = input.targetSeconds
    ? input.targetSeconds / input.raceDistanceKm
    : predictedSeconds
      ? predictedSeconds / input.raceDistanceKm
      : null;

  // Progressive volume: +10% on recent weekly volume, floored to race-distance needs.
  let weeklyTargetKm = Math.max(input.raceDistanceKm * 2.5, input.weeklyKm * 1.1);
  if (input.bmi != null && input.bmi >= 28) weeklyTargetKm *= 0.85;
  if (input.age != null && input.age >= 45) weeklyTargetKm *= 0.9;
  weeklyTargetKm = Math.round(weeklyTargetKm * 10) / 10;

  const easy = goalPaceSecPerKm ? goalPaceSecPerKm + 75 : null;
  const tempo = goalPaceSecPerKm ? goalPaceSecPerKm - 5 : null;
  const interval = goalPaceSecPerKm ? goalPaceSecPerKm - 35 : null;

  const longKm = Math.round(Math.min(input.raceDistanceKm * 1.3, weeklyTargetKm * 0.4) * 10) / 10;
  const easyKm = Math.round(weeklyTargetKm * 0.22 * 10) / 10;
  const tempoKm = Math.round(weeklyTargetKm * 0.18 * 10) / 10;
  const reps = input.raceDistanceKm >= 10 ? 6 : 5;

  const sessions: Session[] = [
    { day: DAYS[0]!, kind: "Rest", detail: "Mobility + 10 min walk" },
    {
      day: DAYS[1]!,
      kind: "Intervals",
      detail: `${reps} × 600 m @ ${formatPace(interval)}/km, 90 s jog recovery`,
    },
    { day: DAYS[2]!, kind: "Easy", detail: `${easyKm} km @ ${formatPace(easy)}/km` },
    { day: DAYS[3]!, kind: "Tempo", detail: `${tempoKm} km @ ${formatPace(tempo)}/km` },
    { day: DAYS[4]!, kind: "Rest", detail: "Strength: core + glutes, 20 min" },
    { day: DAYS[5]!, kind: "Long", detail: `${longKm} km @ ${formatPace(easy)}/km` },
    { day: DAYS[6]!, kind: "Easy", detail: `${easyKm} km relaxed, or cross-train` },
  ];

  const note = predictedSeconds
    ? input.targetSeconds && input.targetSeconds < predictedSeconds
      ? `Your fitness predicts ${formatDuration(predictedSeconds)} for ${input.raceDistanceKm}K — target is ${formatDuration(input.targetSeconds)}, so we're pushing quality work.`
      : `Your fitness predicts ${formatDuration(predictedSeconds)} for ${input.raceDistanceKm}K — on track, we're building volume.`
    : "Record a run of 3 km or more and the plan will tune to your real pace.";

  return { sessions, weeklyTargetKm, predictedSeconds, goalPaceSecPerKm, note };
}
