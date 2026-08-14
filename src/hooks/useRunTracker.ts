import { useCallback, useEffect, useRef, useState } from "react";
import {
  GPS_ACCURACY_LIMIT_M,
  MAX_SPEED_KMH,
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

  const watchId = useRef<number | null>(null);
  const timerId = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef<number | null>(null);
  const lastPoint = useRef<GeoPoint | null>(null);
  const recent = useRef<{ km: number; t: number }[]>([]);
  const wakeLock = useRef<WakeLockLike | null>(null);

  const avgPace = paceFrom(distanceKm, elapsed);

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLock.current;
    wakeLock.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
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

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const acc = pos.coords.accuracy ?? 999;
    setAccuracy(acc);
    if (acc > GPS_ACCURACY_LIMIT_M) return;

    const point: GeoPoint = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      t: pos.timestamp || Date.now(),
    };
    const prev = lastPoint.current;
    lastPoint.current = point;
    setRoute((r) => [...r, point]);
    if (!prev) return;

    const meters = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);
    if (meters < MIN_MOVE_M) return;

    const dtSeconds = Math.max(0.5, (point.t - prev.t) / 1000);
    const speedKmh = meters / 1000 / (dtSeconds / 3600);
    if (speedKmh > MAX_SPEED_KMH) return;

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

  const start = useCallback(async () => {
    setGpsError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("This device has no GPS available. Use manual entry instead.");
      return;
    }

    setDistanceKm(0);
    setElapsed(0);
    setRoute([]);
    setCurrentPace(null);
    lastPoint.current = null;
    recent.current = [];
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

    timerId.current = setInterval(() => {
      if (startedAt.current) setElapsed((Date.now() - startedAt.current) / 1000);
    }, 250);

    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<WakeLockLike> } })
        .wakeLock;
      if (wl) wakeLock.current = await wl.request("screen");
    } catch {
      /* wake lock is best-effort */
    }
  }, [handlePosition]);

  const stop = useCallback(() => {
    stopSensors();
    setStatus("idle");
    const finalElapsed = startedAt.current ? (Date.now() - startedAt.current) / 1000 : elapsed;
    startedAt.current = null;
    return {
      distanceKm,
      seconds: Math.round(finalElapsed),
      route,
    };
  }, [distanceKm, elapsed, route, stopSensors]);

  const reset = useCallback(() => {
    stopSensors();
    setStatus("idle");
    setDistanceKm(0);
    setElapsed(0);
    setRoute([]);
    setAccuracy(null);
    setCurrentPace(null);
    setGpsError(null);
    startedAt.current = null;
    lastPoint.current = null;
    recent.current = [];
  }, [stopSensors]);

  return {
    status,
    distanceKm,
    elapsed,
    accuracy,
    gpsError,
    route,
    currentPace,
    avgPace,
    start,
    stop,
    reset,
  };
}
