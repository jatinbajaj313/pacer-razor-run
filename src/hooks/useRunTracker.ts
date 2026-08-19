import { useCallback, useEffect, useRef, useState } from "react";
import {
  GPS_ACCURACY_LIMIT_M,
  GPS_ACCURACY_WARN_M,
  MAX_GPS_JITTER_KMH,
  MIN_MOVE_M,
  haversineMeters,
  paceFrom,
  type GeoPoint,
} from "@/lib/running";

export type TrackerStatus = "idle" | "running" | "paused";

type WakeLockLike = { release: () => Promise<void>; released: boolean };

/** A stretch where the browser was suspended and no GPS arrived. */
export type BackgroundGap = { seconds: number; straightLineKm: number };

const DRAFT_KEY = "pacer:run-in-progress";
/** Ignore blips; longer than this counts as a real background gap. */
const GAP_THRESHOLD_SECONDS = 15;
/**
 * No measured movement for this long and we treat the run as over. Long enough
 * to survive a traffic light, a chat at the gate, or a stretch; short enough
 * that forgetting to stop doesn't ruin the run.
 */
const IDLE_LIMIT_SECONDS = 20 * 60;
/** Warn the runner before we auto-finish. */
const IDLE_WARN_SECONDS = 5 * 60;

type Draft = {
  startedAtEpoch: number;
  bankedSeconds: number;
  distanceKm: number;
  estimatedKm: number;
  gaps: BackgroundGap[];
  route: GeoPoint[];
  savedAt: number;
  /** Seconds of running up to the last measured movement — the tail is trimmed. */
  activeSeconds: number;
  /** Wall-clock ms when distance last increased. */
  lastMoveAt: number;
};

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function useRunTracker() {
  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [distanceKm, setDistanceKm] = useState(0);
  const [estimatedKm, setEstimatedKm] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [route, setRoute] = useState<GeoPoint[]>([]);
  const [currentPace, setCurrentPace] = useState<number | null>(null);
  const [fixCount, setFixCount] = useState(0);
  const [gaps, setGaps] = useState<BackgroundGap[]>([]);
  const [recoverable, setRecoverable] = useState<Draft | null>(null);

  const watchId = useRef<number | null>(null);
  const timerId = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number | null>(null);
  const bankedSeconds = useRef(0);
  const lastPoint = useRef<GeoPoint | null>(null);
  const recent = useRef<{ km: number; t: number }[]>([]);
  const wakeLock = useRef<WakeLockLike | null>(null);
  const paused = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const gapPending = useRef<number | null>(null);
  /** Wall clock at the last accepted distance increase. */
  const lastMoveAt = useRef<number | null>(null);
  /** Elapsed reading at that same moment, so the idle tail can be cut off. */
  const activeAtLastMove = useRef(0);
  const [idleSeconds, setIdleSeconds] = useState(0);

  const avgPace = paceFrom(distanceKm, elapsed);
  const signalWeak = accuracy != null && accuracy > GPS_ACCURACY_WARN_M;
  const noFixYet = status !== "idle" && fixCount === 0;
  const backgroundSeconds = gaps.reduce((a, g) => a + g.seconds, 0);
  const idleWarning = status === "running" && distanceKm > 0 && idleSeconds >= IDLE_WARN_SECONDS;
  const shouldAutoFinish =
    status === "running" && distanceKm > 0 && idleSeconds >= IDLE_LIMIT_SECONDS;

  // ---------- draft persistence: an iOS tab discard shouldn't erase the run ----------
  const saveDraft = useCallback(() => {
    if (!startedAt.current && bankedSeconds.current === 0) return;
    const draft: Draft = {
      startedAtEpoch: startedAt.current ?? 0,
      bankedSeconds: bankedSeconds.current,
      distanceKm,
      estimatedKm,
      gaps,
      route,
      savedAt: Date.now(),
      activeSeconds: activeAtLastMove.current,
      lastMoveAt: lastMoveAt.current ?? 0,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage blocked — tracking still works, just no recovery */
    }
  }, [distanceKm, estimatedKm, gaps, route]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const d = readDraft();
    if (d && Date.now() - d.savedAt < 6 * 3600 * 1000 && d.distanceKm > 0.05) {
      setRecoverable(d);
    } else if (d) {
      clearDraft();
    }
  }, [clearDraft]);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLock.current;
    wakeLock.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      const wl = (
        navigator as Navigator & {
          wakeLock?: { request: (t: string) => Promise<WakeLockLike> };
        }
      ).wakeLock;
      if (wl && !wakeLock.current) wakeLock.current = await wl.request("screen");
    } catch {
      /* best effort */
    }
  }, []);

  const stopSensors = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (timerId.current) {
      clearInterval(timerId.current);
      timerId.current = null;
    }
    releaseWakeLock();
  }, [releaseWakeLock]);

  useEffect(() => stopSensors, [stopSensors]);

  // ---------- background handling ----------
  useEffect(() => {
    const onHidden = () => {
      if (status !== "running") return;
      hiddenAt.current = Date.now();
      saveDraft();
    };
    const onVisible = () => {
      if (status !== "running") return;
      void requestWakeLock();
      if (hiddenAt.current) {
        const away = (Date.now() - hiddenAt.current) / 1000;
        hiddenAt.current = null;
        if (away >= GAP_THRESHOLD_SECONDS) gapPending.current = away;
      }
    };
    const onVisibility = () =>
      document.visibilityState === "hidden" ? onHidden() : onVisible();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [status, requestWakeLock, saveDraft]);

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const acc = pos.coords.accuracy ?? 999;
    setAccuracy(acc);
    if (acc > GPS_ACCURACY_LIMIT_M) return;
    if (paused.current) return;

    setFixCount((n) => n + 1);

    const point: GeoPoint = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      t: pos.timestamp || Date.now(),
    };
    const prev = lastPoint.current;

    if (!prev) {
      lastPoint.current = point;
      setRoute((r) => [...r, point]);
      return;
    }

    const meters = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);

    // First fix after a background gap: this straight line is a guess, not a
    // measurement. Count it, but book it as estimated so the UI can say so.
    const gapSeconds = gapPending.current;
    if (gapSeconds != null) {
      gapPending.current = null;
      lastPoint.current = point;
      setRoute((r) => [...r, point]);
      const km = meters / 1000;
      lastMoveAt.current = Date.now();
      setGaps((g) => [...g, { seconds: gapSeconds, straightLineKm: km }]);
      setEstimatedKm((e) => e + km);
      setDistanceKm((d) => d + km);
      recent.current = [];
      setCurrentPace(null);
      return;
    }

    if (meters < MIN_MOVE_M) return;

    const dtSeconds = Math.max(0.5, (point.t - prev.t) / 1000);
    const speedKmh = meters / 1000 / (dtSeconds / 3600);
    if (speedKmh > MAX_GPS_JITTER_KMH) return;

    lastPoint.current = point;
    setRoute((r) => [...r, point]);
    lastMoveAt.current = Date.now();
    if (startedAt.current) {
      activeAtLastMove.current =
        bankedSeconds.current + (Date.now() - startedAt.current) / 1000;
    }

    setDistanceKm((km) => {
      const nextKm = km + meters / 1000;
      const now = point.t;
      recent.current = [...recent.current, { km: nextKm, t: now }].filter(
        (s) => now - s.t <= 45000,
      );
      const first = recent.current[0];
      if (first && now - first.t > 8000) {
        const dKm = nextKm - first.km;
        setCurrentPace(dKm > 0.005 ? (now - first.t) / 1000 / dKm : null);
      }
      return nextKm;
    });
  }, []);

  const tick = useCallback(() => {
    if (startedAt.current && !paused.current) {
      setElapsed(bankedSeconds.current + (Date.now() - startedAt.current) / 1000);
      setIdleSeconds(lastMoveAt.current ? (Date.now() - lastMoveAt.current) / 1000 : 0);
    }
  }, []);

  const beginWatch = useCallback(() => {
    watchId.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable it in your browser settings, or log the run manually."
            : "GPS signal unavailable right now. Keep moving — we'll reconnect.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    timerId.current = setInterval(tick, 250);
    void requestWakeLock();
  }, [handlePosition, tick, requestWakeLock]);

  const start = useCallback(async () => {
    setGpsError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("This device has no GPS available. Use manual entry instead.");
      return;
    }

    try {
      const perm = await navigator.permissions?.query({
        name: "geolocation" as PermissionName,
      });
      if (perm?.state === "denied") {
        setGpsError(
          "Location is blocked for this site. Tap the padlock in the address bar, allow Location, then reload — or log the run manually.",
        );
        return;
      }
    } catch {
      /* Permissions API unavailable — just ask. */
    }

    clearDraft();
    setRecoverable(null);
    setDistanceKm(0);
    setEstimatedKm(0);
    setElapsed(0);
    setRoute([]);
    setGaps([]);
    setCurrentPace(null);
    setAccuracy(null);
    setFixCount(0);
    lastPoint.current = null;
    recent.current = [];
    bankedSeconds.current = 0;
    paused.current = false;
    hiddenAt.current = null;
    gapPending.current = null;
    lastMoveAt.current = Date.now();
    activeAtLastMove.current = 0;
    setIdleSeconds(0);
    startedAt.current = Date.now();
    setStatus("running");
    beginWatch();
  }, [beginWatch, clearDraft]);

  /** Pick up a run the browser threw away. */
  const recover = useCallback(() => {
    const d = recoverable;
    if (!d) return;
    setDistanceKm(d.distanceKm);
    setEstimatedKm(d.estimatedKm);
    setGaps(d.gaps ?? []);
    setRoute(d.route ?? []);
    bankedSeconds.current =
      d.bankedSeconds + (d.startedAtEpoch ? (d.savedAt - d.startedAtEpoch) / 1000 : 0);
    setElapsed(bankedSeconds.current);
    lastPoint.current = null;
    recent.current = [];
    paused.current = false;
    hiddenAt.current = null;
    gapPending.current = null;
    startedAt.current = Date.now();
    setRecoverable(null);
    setStatus("running");
    beginWatch();
  }, [recoverable, beginWatch]);

  /**
   * Save an abandoned run straight from the draft, without restarting GPS.
   * This is the common "forgot to stop, phone died, opened the app next day"
   * case: the distance is real, so the run should not be thrown away.
   */
  const finishRecovered = useCallback(() => {
    const d = recoverable;
    if (!d) return null;
    const seconds = Math.round(
      d.activeSeconds > 0
        ? d.activeSeconds
        : d.bankedSeconds + (d.startedAtEpoch ? (d.savedAt - d.startedAtEpoch) / 1000 : 0),
    );
    setRecoverable(null);
    clearDraft();
    return {
      distanceKm: d.distanceKm,
      seconds,
      route: d.route ?? [],
      estimatedKm: d.estimatedKm ?? 0,
      backgroundSeconds: (d.gaps ?? []).reduce((a, g) => a + g.seconds, 0),
      ranOn: new Date(d.lastMoveAt || d.savedAt).toLocaleDateString("en-CA"),
    };
  }, [recoverable, clearDraft]);

  const discardRecovery = useCallback(() => {
    setRecoverable(null);
    clearDraft();
  }, [clearDraft]);

  const pause = useCallback(() => {
    if (status !== "running") return;
    if (startedAt.current) {
      bankedSeconds.current += (Date.now() - startedAt.current) / 1000;
      startedAt.current = null;
    }
    paused.current = true;
    lastPoint.current = null;
    gapPending.current = null;
    setStatus("paused");
    saveDraft();
  }, [status, saveDraft]);

  const resume = useCallback(() => {
    if (status !== "paused") return;
    paused.current = false;
    startedAt.current = Date.now();
    setStatus("running");
    void requestWakeLock();
  }, [status, requestWakeLock]);

  const stop = useCallback(() => {
    stopSensors();
    const rawElapsed =
      bankedSeconds.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);

    // Trim time spent not moving at the end. Without this, forgetting to stop
    // for two hours turns a 5:30/km run into 22:15/km, which checkRun then
    // rejects outright — so the run would be lost, not merely wrong.
    const idleTail = lastMoveAt.current ? (Date.now() - lastMoveAt.current) / 1000 : 0;
    const trimmed =
      idleTail >= IDLE_WARN_SECONDS && activeAtLastMove.current > 0
        ? activeAtLastMove.current
        : rawElapsed;

    startedAt.current = null;
    paused.current = false;
    hiddenAt.current = null;
    gapPending.current = null;
    lastMoveAt.current = null;
    setStatus("idle");
    setElapsed(trimmed);
    setIdleSeconds(0);
    clearDraft();
    return {
      distanceKm,
      seconds: Math.round(trimmed),
      route,
      estimatedKm,
      backgroundSeconds,
      trimmedSeconds: Math.round(Math.max(0, rawElapsed - trimmed)),
    };
  }, [distanceKm, route, estimatedKm, backgroundSeconds, stopSensors, clearDraft]);

  const reset = useCallback(() => {
    stopSensors();
    setStatus("idle");
    setDistanceKm(0);
    setEstimatedKm(0);
    setElapsed(0);
    setRoute([]);
    setGaps([]);
    setAccuracy(null);
    setCurrentPace(null);
    setGpsError(null);
    setFixCount(0);
    startedAt.current = null;
    bankedSeconds.current = 0;
    paused.current = false;
    hiddenAt.current = null;
    gapPending.current = null;
    lastPoint.current = null;
    lastMoveAt.current = null;
    activeAtLastMove.current = 0;
    setIdleSeconds(0);
    recent.current = [];
    clearDraft();
  }, [stopSensors, clearDraft]);

  return {
    status,
    distanceKm,
    estimatedKm,
    elapsed,
    accuracy,
    signalWeak,
    noFixYet,
    gpsError,
    route,
    currentPace,
    avgPace,
    gaps,
    backgroundSeconds,
    idleSeconds,
    idleWarning,
    shouldAutoFinish,
    recoverable,
    recover,
    finishRecovered,
    discardRecovery,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
