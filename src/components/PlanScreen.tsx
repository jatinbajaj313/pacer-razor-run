import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMyRuns } from "@/hooks/useMyRuns";
import { supabase } from "@/integrations/supabase/client";
import { buildPlan } from "@/lib/plan";
import { formatDuration, formatPace } from "@/lib/running";

export function PlanScreen() {
  const { user, profile } = useAuth();
  const { runs } = useMyRuns(user?.id);
  const [priv, setPriv] = useState<{ age: number | null; height_cm: number | null; weight_kg: number | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("private_profiles")
        .select("age, height_cm, weight_kg")
        .eq("user_id", user.id)
        .maybeSingle();
      setPriv(data ?? null);
    })();
  }, [user]);

  const plan = useMemo(() => {
    const raceDistanceKm = profile?.race_distance ?? 5;
    const since = Date.now() - 7 * 864e5;
    const weeklyKm = runs
      .filter((r) => new Date(r.ran_on).getTime() >= since)
      .reduce((s, r) => s + r.distance_km, 0);

    let bestSeconds: number | null = null;
    let bestDistanceKm: number | null = null;
    for (const r of runs) {
      if (r.distance_km < 2) continue;
      const norm = (r.duration_seconds / r.distance_km) * raceDistanceKm;
      if (bestSeconds == null || norm < bestSeconds) {
        bestSeconds = r.duration_seconds;
        bestDistanceKm = r.distance_km;
      }
    }

    const bmi =
      priv?.height_cm && priv?.weight_kg
        ? priv.weight_kg / Math.pow(priv.height_cm / 100, 2)
        : null;

    return buildPlan({
      raceDistanceKm,
      targetSeconds: profile?.target_time ?? null,
      bestSeconds,
      bestDistanceKm,
      weeklyKm,
      bmi,
      age: priv?.age ?? null,
    });
  }, [runs, profile, priv]);

  return (
    <main className="min-h-screen px-4 pb-28 pt-6">
      <header className="mb-4">
        <p className="num text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          Adaptive plan
        </p>
        <h1 className="text-2xl font-bold">This week</h1>
      </header>

      <section className="card-surface mb-5 grid grid-cols-3 gap-3 rounded-2xl p-4">
        <Stat label="Weekly target" value={`${plan.weeklyTargetKm}`} unit="km" />
        <Stat
          label={`${profile?.race_distance ?? 5}K predict`}
          value={plan.predictedSeconds ? formatDuration(plan.predictedSeconds) : "—"}
        />
        <Stat label="Goal pace" value={formatPace(plan.goalPaceSecPerKm)} unit="/km" />
      </section>

      <p className="mb-5 text-sm text-muted-foreground">{plan.note}</p>

      <ul className="space-y-2">
        {plan.sessions.map((s) => (
          <li key={s.day} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <span className="num w-10 text-xs font-bold text-muted-foreground uppercase">
              {s.day}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{s.kind}</p>
              <p className="text-xs text-muted-foreground">{s.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <p className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className="num text-lg font-bold">
        {value}
        {unit && <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}
