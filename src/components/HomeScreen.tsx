import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMyRuns } from "@/hooks/useMyRuns";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { buildPlan } from "@/lib/plan";
import { formatDuration, formatPace } from "@/lib/running";

const RACE_DATE = new Date("2026-09-06T00:00:00Z");

export function HomeScreen({ onGoBoard }: { onGoBoard: () => void }) {
  const { user, profile } = useAuth();
  const { runs } = useMyRuns(user?.id);
  const { rows } = useLeaderboard();

  const daysToRace = Math.max(
    0,
    Math.ceil((RACE_DATE.getTime() - Date.now()) / 864e5),
  );

  const raceDistanceKm = profile?.race_distance ?? 5;

  const { weeklyKm, weeklyTargetKm, session, last7 } = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().slice(0, 10);
      const km = runs
        .filter((r) => r.ran_on === key)
        .reduce((s, r) => s + r.distance_km, 0);
      return { key, label: d.toLocaleDateString(undefined, { weekday: "narrow" }), km };
    });
    const weekly = days.reduce((s, d) => s + d.km, 0);
    const plan = buildPlan({
      raceDistanceKm,
      targetSeconds: profile?.target_time ?? null,
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
      session: plan.sessions[todayIdx]!,
      last7: days,
    };
  }, [runs, raceDistanceKm, profile]);

  const ranked = [...rows]
    .filter((r) => r.total_km > 0)
    .sort((a, b) => b.total_km - a.total_km);
  const myIdx = ranked.findIndex((r) => r.user_id === user?.id);
  const chase = myIdx > 0 ? ranked[myIdx - 1] : null;
  const myKm = myIdx >= 0 ? ranked[myIdx]!.total_km : 0;

  const pct = Math.min(1, weeklyTargetKm > 0 ? weeklyKm / weeklyTargetKm : 0);
  const maxKm = Math.max(1, ...last7.map((d) => d.km));

  return (
    <main className="min-h-screen px-4 pb-28 pt-6">
      <header className="mb-5">
        <p className="num text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          {daysToRace} days to Razor Run
        </p>
        <h1 className="text-2xl font-bold">
          Hey {profile?.name?.split(" ")[0] ?? "runner"}
        </h1>
      </header>

      <section className="card-surface mb-5 flex items-center gap-5 rounded-2xl p-5">
        <Ring pct={pct} />
        <div>
          <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
            This week
          </p>
          <p className="num text-2xl font-bold">
            {weeklyKm.toFixed(1)}
            <span className="text-sm text-muted-foreground"> / {weeklyTargetKm} km</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {runs.length} run{runs.length === 1 ? "" : "s"} logged all-time
          </p>
        </div>
      </section>

      <section className="card-surface mb-5 rounded-2xl p-4">
        <p className="num text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Today&apos;s session
        </p>
        <p className="mt-1 text-lg font-semibold">{session.kind}</p>
        <p className="text-sm text-muted-foreground">{session.detail}</p>
      </section>

      {chase && (
        <button
          type="button"
          onClick={onGoBoard}
          className="card-surface mb-5 w-full rounded-2xl p-4 text-left"
        >
          <p className="num text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Chasing
          </p>
          <p className="mt-1 font-semibold">{chase.name}</p>
          <p className="text-sm text-muted-foreground">
            {(chase.total_km - myKm).toFixed(1)} km ahead of you · rank {myIdx}
          </p>
        </button>
      )}

      <section className="card-surface rounded-2xl p-4">
        <p className="num text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Last 7 days
        </p>
        <div className="mt-3 flex h-24 items-end gap-2">
          {last7.map((d) => (
            <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-gradient-data"
                style={{ height: `${Math.max(3, (d.km / maxKm) * 80)}px` }}
              />
              <span className="text-[10px] text-muted-foreground">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      {runs[0] && (
        <p className="mt-4 text-xs text-muted-foreground">
          Last run: {runs[0].distance_km.toFixed(2)} km in{" "}
          {formatDuration(runs[0].duration_seconds)} (
          {formatPace(runs[0].duration_seconds / runs[0].distance_km)}/km)
        </p>
      )}
    </main>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="currentColor"
        className="text-primary"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}
