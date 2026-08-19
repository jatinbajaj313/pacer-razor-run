import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyRuns } from "@/hooks/useMyRuns";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { buildPlan } from "@/lib/plan";
import { RACE_DATE, formatDuration, formatPace } from "@/lib/running";

/** One source of truth for the race, shared with the leaderboard. 6am IST start. */
const RACE_AT = new Date(`${RACE_DATE}T06:00:00+05:30`);
/** Local calendar date — must match how runs are stored, or the week chart misses them. */
const localKey = (d: Date) => d.toLocaleDateString("en-CA");

/** Riegel: extrapolate a race time from the best effort of at least 2 km. */
function predictRace(
  runs: { distance_km: number; duration_seconds: number }[],
  raceKm: number,
): { seconds: number; fromKm: number } | null {
  let best: { seconds: number; fromKm: number } | null = null;
  for (const r of runs) {
    if (r.distance_km < 2 || r.duration_seconds <= 0) continue;
    const seconds = r.duration_seconds * Math.pow(raceKm / r.distance_km, 1.06);
    if (!best || seconds < best.seconds) best = { seconds, fromKm: r.distance_km };
  }
  return best;
}

function sessionAccent(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("rest")) return "bg-muted-foreground";
  if (k.includes("long")) return "bg-accent";
  if (k.includes("interval") || k.includes("tempo") || k.includes("speed")) return "bg-record";
  return "bg-primary";
}

export function HomeScreen({ onGoBoard }: { onGoBoard: () => void }) {
  const { user, profile } = useAuth();
  const { runs } = useMyRuns(user?.id);
  const { rows } = useLeaderboard();

  const daysToRace = Math.max(0, Math.ceil((RACE_AT.getTime() - Date.now()) / 864e5));
  const raceDistanceKm = profile?.race_distance ?? 5;
  const targetSeconds = profile?.target_time ?? null;

  const { weeklyKm, weeklyTargetKm, session, last7 } = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      const key = localKey(d);
      const km = runs
        .filter((r) => r.ran_on === key)
        .reduce((s, r) => s + r.distance_km, 0);
      return {
        key,
        label: d.toLocaleDateString(undefined, { weekday: "narrow" }),
        km,
        isToday: i === 6,
      };
    });
    const weekly = days.reduce((s, d) => s + d.km, 0);
    const plan = buildPlan({
      raceDistanceKm,
      targetSeconds,
      bestSeconds: null,
      bestDistanceKm: null,
      weeklyKm: weekly,
      bmi: null,
      age: null,
    });
    const todayIdx = (now.getDay() + 6) % 7;
    return {
      weeklyKm: weekly,
      weeklyTargetKm: plan.weeklyTargetKm,
      session: plan.sessions[todayIdx] ?? plan.sessions[0],
      last7: days,
    };
  }, [runs, raceDistanceKm, targetSeconds]);

  const prediction = useMemo(
    () => predictRace(runs, raceDistanceKm),
    [runs, raceDistanceKm],
  );

  const ranked = [...rows]
    .filter((r) => r.total_km > 0)
    .sort((a, b) => b.total_km - a.total_km);
  const myIdx = ranked.findIndex((r) => r.user_id === user?.id);
  const chase = myIdx > 0 ? ranked[myIdx - 1] : null;
  const myKm = myIdx >= 0 ? ranked[myIdx]!.total_km : 0;

  const pct = Math.min(1, weeklyTargetKm > 0 ? weeklyKm / weeklyTargetKm : 0);
  const maxKm = Math.max(1, weeklyTargetKm / 5, ...last7.map((d) => d.km));
  const dailyTarget = weeklyTargetKm / 7;

  const gap =
    prediction && targetSeconds ? Math.round(prediction.seconds - targetSeconds) : null;

  return (
    <main className="min-h-screen px-4 pb-28 pt-6">
      {/* ---------- hero: the one number worth opening the app for ---------- */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-card px-5 pb-6 pt-5">
        {/* hairline grid, like a timing sheet */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, currentColor 0 1px, transparent 1px 12px)",
          }}
        />
        <div className="relative">
          <div className="flex items-baseline justify-between">
            <p className="num text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
              {profile?.name?.split(" ")[0] ?? "Runner"}
            </p>
            <p className="num text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              {daysToRace > 1
                ? `${daysToRace} days out`
                : daysToRace === 1
                  ? "Tomorrow"
                  : "Race day"}
            </p>
          </div>

          {prediction ? (
            <>
              <p className="num mt-4 text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                Projected {raceDistanceKm}K
              </p>
              <p className="num text-gradient-data text-[4.25rem] font-bold leading-[0.95]">
                {formatDuration(prediction.seconds)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                from your best {prediction.fromKm.toFixed(1)} km effort
              </p>

              {gap != null && (
                <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
                  <span
                    className={`num text-sm font-bold ${gap <= 0 ? "text-success" : "text-warning"}`}
                  >
                    {gap <= 0 ? "−" : "+"}
                    {formatDuration(Math.abs(gap))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {gap <= 0
                      ? `inside your ${formatDuration(targetSeconds!)} target`
                      : `off your ${formatDuration(targetSeconds!)} target`}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="num text-gradient-data mt-4 text-[4.5rem] font-bold leading-[0.95]">
                {daysToRace}
              </p>
              <p className="num text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                days to Razor Run
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Log a run of 2 km or more and this becomes your projected finish.
              </p>
            </>
          )}
        </div>
      </section>

      {/* ---------- training load ---------- */}
      <section className="card-surface mt-4 p-5">
        <div className="flex items-baseline justify-between">
          <p className="num text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            This week
          </p>
          <p className="num text-sm">
            <span className="font-bold">{weeklyKm.toFixed(1)}</span>
            <span className="text-muted-foreground"> / {weeklyTargetKm} km</span>
          </p>
        </div>

        <div className="mt-4 flex h-24 items-end gap-1.5">
          {last7.map((d) => {
            const h = Math.max(2, (d.km / maxKm) * 88);
            return (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="relative flex h-[88px] w-full items-end">
                  {/* daily target line — shows the shape of the plan, not just the total */}
                  <span
                    aria-hidden
                    className="absolute inset-x-0 border-t border-dashed border-border"
                    style={{ bottom: `${Math.min(88, (dailyTarget / maxKm) * 88)}px` }}
                  />
                  <div
                    className={`w-full rounded-sm ${
                      d.km > 0 ? "bg-gradient-data" : "bg-elevated"
                    } ${d.isToday ? "shadow-glow" : ""}`}
                    style={{ height: `${h}px` }}
                  />
                </div>
                <span
                  className={`num text-[9px] uppercase ${
                    d.isToday ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-gradient-data transition-[width] duration-500"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      </section>

      {/* ---------- today ---------- */}
      {session && (
        <section className="card-surface mt-4 flex gap-4 p-5">
          <span className={`w-1 shrink-0 rounded-full ${sessionAccent(session.kind)}`} />
          <div className="min-w-0">
            <p className="num text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Today
            </p>
            <p className="mt-1 text-lg font-semibold">{session.kind}</p>
            <p className="text-sm text-muted-foreground">{session.detail}</p>
          </div>
        </section>
      )}

      {/* ---------- chase ---------- */}
      {chase && (
        <button
          type="button"
          onClick={onGoBoard}
          className="card-surface mt-4 flex w-full items-center gap-4 p-5 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="num text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Chasing · rank {myIdx}
            </p>
            <p className="mt-1 truncate font-semibold">{chase.name}</p>
          </div>
          <p className="num text-xl font-bold text-warning">
            {(chase.total_km - myKm).toFixed(1)}
            <span className="text-xs font-normal text-muted-foreground"> km</span>
          </p>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {/* ---------- last run ---------- */}
      {runs[0] && (
        <section className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <p className="num text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
            Last run
          </p>
          <p className="num text-sm">
            <span className="font-bold">{runs[0].distance_km.toFixed(2)} km</span>
            <span className="text-muted-foreground">
              {" · "}
              {formatDuration(runs[0].duration_seconds)}
              {" · "}
              {formatPace(runs[0].duration_seconds / runs[0].distance_km)}/km
            </span>
          </p>
        </section>
      )}
    </main>
  );
}
