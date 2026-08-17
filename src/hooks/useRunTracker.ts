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

export function useRunTracker() {
  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [distanceKm, setDistanceKm] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [route, setRoute] = useState<GeoPoint[]>([]);
  const [currentPace, setCurrentPace] = useState<number | null>(null);
  const [fixCount, setFixCount] = useState(0);

  const watchId = useRef<number | null>(null);
  const timerId = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number | null>(null);
  const bankedSeconds = useRef(0);
  const lastPoint = useRef<GeoPoint | null>(null);
  const recent = useRef<{ km: number; t: number }[]>([]);
  const wakeLock = useRef<WakeLockLike | null>(null);
  const paused = useRef(false);

  const avgPace = paceFrom(distanceKm, elapsed);
  const signalWeak = accuracy != null && accuracy > GPS_ACCURACY_WARN_M;
  const noFixYet = status !== "idle" && fixCount === 0;

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
      /* wake lock is best-effort */
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

  // A screen lock silently drops the wake lock. Take it again when we come back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && status === "running") {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status, requestWakeLock]);

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

    // FIRST FIX: anchor here, nothing to measure yet.
    if (!prev) {
      lastPoint.current = point;
      setRoute((r) => [...r, point]);
      return;
    }

    const meters = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);

    // Too small to be real movement: KEEP the old anchor, or a slow walk of
    // 1.5 m hops accumulates nothing at all while the anchor creeps forward.
    if (meters < MIN_MOVE_M) return;

    const dtSeconds = Math.max(0.5, (point.t - prev.t) / 1000);
    const speedKmh = meters / 1000 / (dtSeconds / 3600);
    // Implausible hop: reject the reading AND keep the old anchor, so the
    // bogus position can't become the baseline for the next measurement.
    if (speedKmh > MAX_GPS_JITTER_KMH) return;

    lastPoint.current = point;
    setRoute((r) => [...r, point]);

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
    }
  }, []);

  const start = useCallback(async () => {
    setGpsError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("This device has no GPS available. Use manual entry instead.");
      return;
    }

    // Tell the user up front if location was blocked earlier — otherwise the
    // browser never shows a prompt again and the app just looks broken.
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
      /* Permissions API missing (older Safari) — fall through and just ask. */
    }

    setDistanceKm(0);
    setElapsed(0);
    setRoute([]);
    setCurrentPace(null);
    setAccuracy(null);
    setFixCount(0);
    lastPoint.current = null;
    recent.current = [];
    bankedSeconds.current = 0;
    paused.current = false;
    startedAt.current = Date.now();
    setStatus("running");

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

  const pause = useCallback(() => {
    if (status !== "running") return;
    if (startedAt.current) {
      bankedSeconds.current += (Date.now() - startedAt.current) / 1000;
      startedAt.current = null;
    }
    paused.current = true;
    lastPoint.current = null; // don't draw a straight line across the break
    setStatus("paused");
  }, [status]);

  const resume = useCallback(() => {
    if (status !== "paused") return;
    paused.current = false;
    startedAt.current = Date.now();
    setStatus("running");
    void requestWakeLock();
  }, [status, requestWakeLock]);

  const stop = useCallback(() => {
    stopSensors();
    const finalElapsed =
      bankedSeconds.current + (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);
    startedAt.current = null;
    paused.current = false;
    setStatus("idle");
    setElapsed(finalElapsed);
    return {
      distanceKm,
      seconds: Math.round(finalElapsed),
      route,
    };
  }, [distanceKm, route, stopSensors]);

  const reset = useCallback(() => {
    stopSensors();
    setStatus("idle");
    setDistanceKm(0);
    setElapsed(0);
    setRoute([]);
    setAccuracy(null);
    setCurrentPace(null);
    setGpsError(null);
    setFixCount(0);
    startedAt.current = null;
    bankedSeconds.current = 0;
    paused.current = false;
    lastPoint.current = null;
    recent.current = [];
  }, [stopSensors]);

  return {
    status,
    distanceKm,
    elapsed,
    accuracy,
    signalWeak,
    noFixYet,
    gpsError,
    route,
    currentPace,
    avgPace,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
