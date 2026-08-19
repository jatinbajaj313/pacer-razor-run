export type GeoPoint = { lat: number; lng: number; t: number };

/** Distance in metres between two lat/lng points (Haversine). */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** mm:ss or h:mm:ss */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Seconds per km -> "5:24" */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
    return "--:--";
  }
  if (secondsPerKm > 3600) return "--:--";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

export function paceFrom(distanceKm: number, seconds: number): number | null {
  if (distanceKm <= 0.01) return null;
  return seconds / distanceKm;
}

/**
 * "MM:SS" or "H:MM:SS" -> seconds.
 * A bare number is read as minutes ("25" = 25:00).
 * Rejects out-of-range parts, so "5:75" and "10:60" no longer sail through
 * as 6:15 and 11:00.
 */
export function parseDurationInput(value: string): number | null {
  const parts = value.trim().split(":").map((p) => p.trim());
  if (parts.length > 3) return null;
  if (parts.some((p) => p === "" || !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;

  let seconds: number;
  if (parts.length === 1) {
    seconds = nums[0] * 60;
  } else if (parts.length === 2) {
    if (nums[1] > 59) return null; // "10:60" is not a time
    seconds = nums[0] * 60 + nums[1];
  } else {
    if (nums[1] > 59 || nums[2] > 59) return null;
    seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  }

  if (seconds <= 0) return null; // a run cannot take zero time
  if (seconds > MAX_RUN_SECONDS) return null;
  return seconds;
}

/**
 * Discard a GPS reading when the device reports worse accuracy than this.
 * 40 m was too strict: under tree cover, near buildings, or on a cheap phone,
 * 40-60 m readings are normal and the run silently recorded 0.00 km.
 */
export const GPS_ACCURACY_LIMIT_M = 65;
/** Below this, treat the signal as weak and tell the user rather than failing quietly. */
export const GPS_ACCURACY_WARN_M = 30;
export const MIN_MOVE_M = 2;

/**
 * Point-to-point jitter ceiling for live tracking. NOT a human speed limit:
 * a real 18 km/h stride plus 5 m of GPS wobble can imply 36 km/h between two
 * readings, and throwing that away loses genuine distance. Keep this loose and
 * do the plausibility checking on the finished run instead, via checkRun.
 */
export const MAX_GPS_JITTER_KMH = 45;

/**
 * Plausibility limits, applied to MANUAL entries as well as GPS.
 * The men's 10K road world record is about 26:24, i.e. 2:38/km and 22.7 km/h,
 * so 2:45/km sits just outside the fastest pace any human has recorded while
 * staying far quicker than anyone at a corporate fun run.
 */
export const MIN_PACE_SEC_PER_KM = 165; // 2:45/km  -> 21.8 km/h
export const MAX_PACE_SEC_PER_KM = 900; // 15:00/km -> slow walk
export const MIN_RUN_KM = 0.1;
export const MAX_RUN_KM = 100;
export const MAX_RUN_SECONDS = 24 * 3600;
/** Fastest plausible average speed for a whole run. Used by checkRun, not by the tracker. */
export const MAX_SPEED_KMH = 3600 / MIN_PACE_SEC_PER_KM; // 21.8 km/h

export type RunCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate a run before saving. Use for manual entry AND as a final check on a
 * finished GPS run — one implausible entry sits at the top of five boards
 * until someone deletes it.
 */
export function checkRun(distanceKm: number, seconds: number): RunCheck {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(seconds)) {
    return { ok: false, reason: "Enter a distance and a time." };
  }
  if (distanceKm < MIN_RUN_KM) {
    return { ok: false, reason: `Runs need to be at least ${MIN_RUN_KM} km.` };
  }
  if (distanceKm > MAX_RUN_KM) {
    return { ok: false, reason: `${distanceKm} km looks like a typo — check the distance.` };
  }
  if (seconds <= 0) {
    return { ok: false, reason: "Enter a time like 25:00." };
  }
  if (seconds > MAX_RUN_SECONDS) {
    return { ok: false, reason: "That time is longer than a day — check the format." };
  }
  const pace = seconds / distanceKm;
  if (pace > MAX_PACE_SEC_PER_KM) {
    return { ok: false, reason: "That time is far too slow for the distance — check both fields." };
  }
  if (pace < MIN_PACE_SEC_PER_KM) {
    return {
      ok: false,
      reason: `${formatPace(pace)}/km would beat the world record. Check the distance and time.`,
    };
  }
  return { ok: true };
}

export const RACE_DATE = "2026-09-06";
