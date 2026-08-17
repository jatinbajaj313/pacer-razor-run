import { useState } from "react";
import { toast } from "sonner";
import {
  Satellite,
  TriangleAlert,
  Sparkles,
  PencilLine,
  Trophy,
  X,
  Upload,
  RotateCcw,
  Pause,
  Play,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GpxImport } from "@/components/GpxImport";
import { useAuth } from "@/hooks/useAuth";
import { useRunTracker } from "@/hooks/useRunTracker";
import {
  GPS_ACCURACY_LIMIT_M,
  GPS_ACCURACY_WARN_M,
  checkRun,
  formatDuration,
  formatPace,
  paceFrom,
  parseDurationInput,
  type GeoPoint,
} from "@/lib/running";

/**
 * Whether to save the full GPS trace of a run.
 *
 * Set to false: a route recorded from someone's front door is their home
 * address, and this app holds colleagues' data on a personal project. Distance,
 * duration and pace drive every board and the training plan without it. Flip to
 * true only once route maps are a feature someone has actually approved.
 */
const STORE_ROUTES = false;

type Summary = {
  distanceKm: number;
  seconds: number;
  rank: number | null;
  totalRunners: number;
};

/** Local calendar date, not UTC — a 5am Bengaluru run belongs to today. */
const localToday = () => new Date().toLocaleDateString("en-CA");

function signalTone(accuracy: number | null) {
  if (accuracy == null) return { label: "Searching…", color: "text-muted-foreground" };
  const m = Math.round(accuracy);
  if (accuracy > GPS_ACCURACY_LIMIT_M) return { label: `Too weak · ${m}m`, color: "text-danger" };
  if (accuracy > GPS_ACCURACY_WARN_M) return { label: `Weak · ${m}m`, color: "text-warning" };
  if (accuracy < 15) return { label: `Strong · ${m}m`, color: "text-success" };
  return { label: `Fair · ${m}m`, color: "text-warning" };
}

export function RecordScreen() {
  const { user, profile } = useAuth();
  const tracker = useRunTracker();
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [manualDate, setManualDate] = useState(localToday);
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

  /**
   * The only way a run reaches the database. Every path — GPS, manual, imported,
   * simulated — goes through checkRun here, so one implausible entry can't sit
   * on top of five boards until someone notices.
   */
  async function saveRun(input: {
    distanceKm: number;
    seconds: number;
    source: "gps" | "manual" | "import";
    ranOn?: string;
    route?: GeoPoint[];
  }) {
    if (!user) return false;

    const check = checkRun(input.distanceKm, input.seconds);
    if (!check.ok) {
      toast.error(check.reason);
      return false;
    }

    const ranOn = input.ranOn ?? localToday();
    if (ranOn > localToday()) {
      toast.error("That date is in the future.");
      return false;
    }

    setSaving(true);
    const keepRoute = STORE_ROUTES && input.route && input.route.length > 1;
    const { error } = await supabase.from("runs").insert({
      user_id: user.id,
      distance_km: Number(input.distanceKm.toFixed(3)),
      duration_seconds: Math.round(input.seconds),
      source: input.source,
      ran_on: ranOn,
      route: keepRoute ? input.route : null,
    });
    if (error) {
      setSaving(false);
      toast.error("Couldn't save that run. Try again.");
      return false;
    }
    const { rank, totalRunners } = await totalDistanceRank();
    setSaving(false);
    setSummary({
      distanceKm: input.distanceKm,
      seconds: Math.round(input.seconds),
      rank,
      totalRunners,
    });
    return true;
  }

  async function handleStop() {
    const result = tracker.stop();
    if (result.distanceKm < 0.05) {
      toast.error("That run was too short to save.");
      tracker.reset();
      return;
    }
    if (result.estimatedKm > 0.05) {
      toast.warning(
        `${result.estimatedKm.toFixed(2)} km of this run is estimated — the app was in the background for ${formatDuration(result.backgroundSeconds)}.`,
      );
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
    if (!Number.isFinite(km) || km <= 0) {
      toast.error("Enter a distance, e.g. 5.2");
      return;
    }
    if (seconds == null) {
      toast.error("Enter a time as mm:ss, e.g. 32:00");
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
  const isPaused = tracker.status === "paused";
  const isActive = isRunning || isPaused;

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

      {/* A run the browser threw away mid-session */}
      {tracker.recoverable && !isActive && (
        <div className="card-surface mt-6 border border-warning/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-warning">
            <RotateCcw className="size-4" />
            Unfinished run found
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tracker.recoverable.distanceKm.toFixed(2)} km already recorded. Pick it up or bin it.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={tracker.recover}
              className="h-11 flex-1 rounded-lg bg-gradient-data text-sm font-semibold text-primary-foreground"
            >
              Resume
            </Button>
            <Button
              onClick={tracker.discardRecovery}
              className="h-11 rounded-lg border border-border bg-card text-sm font-semibold text-muted-foreground"
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="card-surface mt-8 px-6 py-10 text-center">
        <p className="num text-[5.5rem] font-bold leading-none text-gradient-data">
          {tracker.distanceKm.toFixed(2)}
        </p>
        <p className="mt-1 text-sm font-medium tracking-widest text-muted-foreground uppercase">
          {isPaused ? "kilometres · paused" : "kilometres"}
        </p>

        <div className="mt-8 grid grid-cols-3 gap-3">
          <Stat label="Time" value={formatDuration(tracker.elapsed)} />
          <Stat label="Now / km" value={formatPace(tracker.currentPace)} />
          <Stat label="Avg / km" value={formatPace(tracker.avgPace)} />
        </div>
      </div>

      {tracker.noFixYet && !tracker.gpsError && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Waiting for a GPS fix — this can take up to a minute outdoors.
        </p>
      )}

      {tracker.signalWeak && !tracker.gpsError && (
        <p className="mt-4 flex gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Weak GPS signal. Distance may under-record until it improves.
        </p>
      )}

      {tracker.estimatedKm > 0.05 && (
        <p className="mt-4 flex gap-2 rounded-lg border border-warning/40 bg-card px-4 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {tracker.estimatedKm.toFixed(2)} km of this run is estimated. The app was in the
          background for {formatDuration(tracker.backgroundSeconds)}, so that stretch is a straight
          line, not your real route.
        </p>
      )}

      {tracker.gpsError && (
        <p className="mt-4 flex gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {tracker.gpsError}
        </p>
      )}

      <div className="mt-6">
        {isActive ? (
          <div className="space-y-3">
            <Button
              onClick={handleStop}
              disabled={saving}
              className="h-16 w-full rounded-2xl border border-border bg-card text-lg font-bold text-record hover:bg-elevated"
            >
              {saving ? "Saving…" : "Stop & save run"}
            </Button>
            <Button
              onClick={isPaused ? tracker.resume : tracker.pause}
              disabled={saving}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-muted-foreground hover:bg-elevated"
            >
              {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {isPaused ? "Resume" : "Pause"}
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => void tracker.start()}
            className="h-16 w-full rounded-2xl bg-gradient-record text-lg font-bold text-record-foreground shadow-record-glow hover:opacity-90"
          >
            Start run
          </Button>
        )}
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Keep this screen open. Locking the phone or switching apps stops GPS — we keep the screen
          awake, but we can't record in the background.
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
                max={localToday()}
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

        <Collapsible>
          <CollapsibleTrigger className="card-surface flex w-full items-center gap-3 px-4 py-4 text-left text-sm font-medium">
            <Upload className="size-4 text-primary" />
            Import from Strava, Garmin or your watch
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <GpxImport
              includeRoute={STORE_ROUTES}
              onImport={async (run) => {
                const saved = await saveRun({
                  distanceKm: run.distanceKm,
                  seconds: run.movingSeconds,
                  source: "import",
                  ranOn: run.startedAt ? run.startedAt.slice(0, 10) : undefined,
                  route: run.route,
                });
                if (!saved) throw new Error("save failed");
              }}
            />
          </CollapsibleContent>
        </Collapsible>

        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={simulateRun}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-xs font-medium text-muted-foreground"
          >
            <Sparkles className="size-3.5" />
            Simulate a run (dev only)
          </button>
        )}
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
