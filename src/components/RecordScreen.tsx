import { useState } from "react";
import { toast } from "sonner";
import { Satellite, TriangleAlert, Sparkles, PencilLine, Trophy, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import { useRunTracker } from "@/hooks/useRunTracker";
import {
  formatDuration,
  formatPace,
  paceFrom,
  parseDurationInput,
  type GeoPoint,
} from "@/lib/running";

type Summary = {
  distanceKm: number;
  seconds: number;
  rank: number | null;
  totalRunners: number;
};

function signalTone(accuracy: number | null) {
  if (accuracy == null) return { label: "Searching…", color: "text-muted-foreground" };
  if (accuracy < 15) return { label: `Strong · ${Math.round(accuracy)}m`, color: "text-success" };
  if (accuracy < 35) return { label: `Fair · ${Math.round(accuracy)}m`, color: "text-warning" };
  return { label: `Weak · ${Math.round(accuracy)}m`, color: "text-danger" };
}

export function RecordScreen() {
  const { user, profile } = useAuth();
  const tracker = useRunTracker();
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualDistance, setManualDistance] = useState("");
  const [manualTime, setManualTime] = useState("");

  const signal = signalTone(tracker.accuracy);

  async function totalDistanceRank(): Promise<{ rank: number | null; totalRunners: number }> {
    const { data } = await supabase.rpc("leaderboard_totals");
    if (!data || !user) return { rank: null, totalRunners: 0 };
    const ordered = [...data].sort((a, b) => Number(b.total_km) - Number(a.total_km));
    const index = ordered.findIndex((row) => row.user_id === user.id);
    return { rank: index >= 0 ? index + 1 : null, totalRunners: ordered.length };
  }


  async function saveRun(input: {
    distanceKm: number;
    seconds: number;
    source: "gps" | "manual";
    ranOn?: string;
    route?: GeoPoint[];
  }) {
    if (!user) return false;
    setSaving(true);
    const { error } = await supabase.from("runs").insert({
      user_id: user.id,
      distance_km: Number(input.distanceKm.toFixed(3)),
      duration_seconds: input.seconds,
      source: input.source,
      ran_on: input.ranOn ?? new Date().toISOString().slice(0, 10),
      route: input.route && input.route.length > 1 ? input.route : null,
    });
    if (error) {
      setSaving(false);
      toast.error("Couldn't save that run. Try again.");
      return false;
    }
    const { rank, totalRunners } = await totalDistanceRank();
    setSaving(false);
    setSummary({ distanceKm: input.distanceKm, seconds: input.seconds, rank, totalRunners });
    return true;
  }

  async function handleStop() {
    const result = tracker.stop();
    if (result.distanceKm < 0.05) {
      toast.error("That run was too short to save.");
      tracker.reset();
      return;
    }
    const saved = await saveRun({
      distanceKm: result.distanceKm,
      seconds: result.seconds,
      source: "gps",
      route: result.route,
    });
    if (saved) tracker.reset();
  }

  async function simulateRun() {
    const distanceKm = 3 + Math.random() * 4;
    const paceSeconds = 330 + Math.random() * 120;
    await saveRun({
      distanceKm,
      seconds: Math.round(distanceKm * paceSeconds),
      source: "manual",
    });
  }

  async function submitManual() {
    const km = Number(manualDistance);
    const seconds = parseDurationInput(manualTime);
    if (!km || km <= 0 || km > 100 || !seconds || seconds < 60) {
      toast.error("Check the distance and time — e.g. 5.2 km and 32:00.");
      return;
    }
    const saved = await saveRun({
      distanceKm: km,
      seconds,
      source: "manual",
      ranOn: manualDate,
    });
    if (saved) {
      setManualDistance("");
      setManualTime("");
    }
  }

  if (summary) {
    const pace = paceFrom(summary.distanceKm, summary.seconds);
    return (
      <section className="px-5 pb-32 pt-12">
        <div className="card-surface relative overflow-hidden p-6">
          <button
            type="button"
            onClick={() => setSummary(null)}
            aria-label="Close summary"
            className="absolute right-4 top-4 text-muted-foreground"
          >
            <X className="size-5" />
          </button>
          <p className="text-xs font-semibold tracking-widest text-success uppercase">
            Run saved
          </p>
          <p className="num mt-3 text-6xl font-bold text-gradient-data">
            {summary.distanceKm.toFixed(2)}
            <span className="text-2xl text-muted-foreground"> km</span>
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <Stat label="Time" value={formatDuration(summary.seconds)} />
            <Stat label="Pace / km" value={formatPace(pace)} />
          </div>
          <div className="mt-6 flex items-center gap-3 rounded-lg bg-elevated px-4 py-3">
            <Trophy className="size-5 text-warning" />
            <p className="text-sm">
              {summary.rank
                ? `You're now #${summary.rank} of ${summary.totalRunners} on total distance.`
                : "Logged. Your board position updates live."}
            </p>
          </div>
          <Button
            onClick={() => setSummary(null)}
            className="mt-6 h-12 w-full rounded-xl bg-gradient-data font-semibold text-primary-foreground"
          >
            Done
          </Button>
        </div>
      </section>
    );
  }

  const isRunning = tracker.status === "running";

  return (
    <section className="px-5 pb-32 pt-10">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Record
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {profile?.name?.split(" ")[0] ?? "Runner"}, let's move
          </h1>
        </div>
        <span className={`flex items-center gap-2 text-xs font-medium ${signal.color}`}>
          <Satellite className={`size-4 ${isRunning ? "animate-signal" : ""}`} />
          {signal.label}
        </span>
      </header>

      <div className="card-surface mt-8 px-6 py-10 text-center">
        <p className="num text-[5.5rem] font-bold leading-none text-gradient-data">
          {tracker.distanceKm.toFixed(2)}
        </p>
        <p className="mt-1 text-sm font-medium tracking-widest text-muted-foreground uppercase">
          kilometres
        </p>

        <div className="mt-8 grid grid-cols-3 gap-3">
          <Stat label="Time" value={formatDuration(tracker.elapsed)} />
          <Stat label="Now / km" value={formatPace(tracker.currentPace)} />
          <Stat label="Avg / km" value={formatPace(tracker.avgPace)} />
        </div>
      </div>

      {tracker.gpsError && (
        <p className="mt-4 flex gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {tracker.gpsError}
        </p>
      )}

      <div className="mt-6">
        {isRunning ? (
          <Button
            onClick={handleStop}
            disabled={saving}
            className="h-16 w-full rounded-2xl border border-border bg-card text-lg font-bold text-record hover:bg-elevated"
          >
            {saving ? "Saving…" : "Stop & save run"}
          </Button>
        ) : (
          <Button
            onClick={() => void tracker.start()}
            className="h-16 w-full rounded-2xl bg-gradient-record text-lg font-bold text-record-foreground shadow-record-glow hover:opacity-90"
          >
            Start run
          </Button>
        )}
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Keep Pacer open — switching apps pauses GPS tracking. We hold the screen awake for you.
        </p>
      </div>

      <div className="mt-8 space-y-3">
        <Collapsible>
          <CollapsibleTrigger className="card-surface flex w-full items-center gap-3 px-4 py-4 text-left text-sm font-medium">
            <PencilLine className="size-4 text-primary" />
            Log a run manually
          </CollapsibleTrigger>
          <CollapsibleContent className="card-surface mt-2 space-y-4 p-4">
            <div className="space-y-2">
              <Label htmlFor="m-date" className="text-xs text-muted-foreground">
                Date
              </Label>
              <Input
                id="m-date"
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="num h-12 rounded-lg border-input bg-elevated"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="m-dist" className="text-xs text-muted-foreground">
                  Distance (km)
                </Label>
                <Input
                  id="m-dist"
                  inputMode="decimal"
                  placeholder="5.2"
                  value={manualDistance}
                  onChange={(e) => setManualDistance(e.target.value)}
                  className="num h-12 rounded-lg border-input bg-elevated"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-time" className="text-xs text-muted-foreground">
                  Time (mm:ss)
                </Label>
                <Input
                  id="m-time"
                  inputMode="numeric"
                  placeholder="32:00"
                  value={manualTime}
                  onChange={(e) => setManualTime(e.target.value)}
                  className="num h-12 rounded-lg border-input bg-elevated"
                />
              </div>
            </div>
            <Button
              onClick={submitManual}
              disabled={saving}
              className="h-12 w-full rounded-lg bg-gradient-data font-semibold text-primary-foreground"
            >
              Save run
            </Button>
          </CollapsibleContent>
        </Collapsible>

        <button
          type="button"
          onClick={simulateRun}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs font-medium text-muted-foreground"
        >
          <Sparkles className="size-3.5" />
          Simulate a run (demo, no GPS needed)
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated px-3 py-3">
      <p className="num text-xl font-bold">{value}</p>
      <p className="mt-0.5 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
    </div>
  );
}
