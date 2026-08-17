import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { parseGpxFile, type GpxResult } from "@/lib/gpx";
import { formatDuration, formatPace } from "@/lib/running";

type Props = {
  /** Called with the parsed run once the user confirms it. */
  onImport: (run: GpxResult) => void | Promise<void>;
  /** Set false to keep GPS coordinates out of the payload entirely. */
  includeRoute?: boolean;
};

export function GpxImport({ onImport, includeRoute = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<GpxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPending(null);
    setBusy(true);
    const result = await parseGpxFile(file, { includeRoute });
    setBusy(false);
    if (result.ok) setPending(result.run);
    else setError(result.reason);
    if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await onImport(pending);
      setPending(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-surface rounded-2xl p-4">
      <p className="num text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
        Import from your watch
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        In Strava, Garmin or Nike Run Club, open the activity and export it as GPX, then pick the
        file here.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".gpx,.xml,application/gpx+xml"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        <Upload className="size-4" />
        {busy ? "Reading file…" : "Choose GPX file"}
      </button>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {pending && (
        <div className="mt-4 rounded-xl border border-border p-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="num text-lg font-bold">{pending.distanceKm.toFixed(2)}</p>
              <p className="num text-[9px] tracking-[0.14em] text-muted-foreground uppercase">km</p>
            </div>
            <div>
              <p className="num text-lg font-bold">{formatDuration(pending.movingSeconds)}</p>
              <p className="num text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                moving
              </p>
            </div>
            <div>
              <p className="num text-lg font-bold">
                {formatPace(pending.movingSeconds / pending.distanceKm)}
              </p>
              <p className="num text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                /km
              </p>
            </div>
          </div>

          {pending.elapsedSeconds > pending.movingSeconds + 5 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Total time was {formatDuration(pending.elapsedSeconds)} including{" "}
              {formatDuration(pending.elapsedSeconds - pending.movingSeconds)} stopped. Moving time
              is what counts on the boards.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={saving}
              className="flex-1 rounded-xl bg-gradient-data px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save this run"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={saving}
              className="rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
