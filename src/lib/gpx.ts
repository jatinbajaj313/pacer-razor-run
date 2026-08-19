import {
  MAX_GPS_JITTER_KMH,
  checkRun,
  haversineMeters,
  type GeoPoint,
} from "@/lib/running";

export type GpxResult = {
  /** Measured along the track, not straight-line. */
  distanceKm: number;
  /** Last timestamp minus first — includes any time spent stopped. */
  elapsedSeconds: number;
  /** Excludes stretches longer than PAUSE_GAP_SECONDS, i.e. Strava's "moving time". */
  movingSeconds: number;
  /** When the activity started, if the file has timestamps. */
  startedAt: string | null;
  /** Thinned track, capped at ROUTE_POINT_CAP points. Empty when includeRoute is false. */
  route: GeoPoint[];
  pointCount: number;
  hadTimestamps: boolean;
};

export type GpxParse = { ok: true; run: GpxResult } | { ok: false; reason: string };

/** A gap longer than this is treated as a pause, not running. */
const PAUSE_GAP_SECONDS = 30;
/** Ignore sub-metre wobble between consecutive samples. */
const MIN_STEP_M = 1;
const ROUTE_POINT_CAP = 500;

function collect(doc: Document, tag: string): Element[] {
  const direct = doc.getElementsByTagName(tag);
  if (direct.length > 0) return Array.from(direct);
  // Namespaced or prefixed documents.
  return Array.from(doc.getElementsByTagNameNS("*", tag));
}

function childText(el: Element, tag: string): string | null {
  const direct = el.getElementsByTagName(tag);
  const node = direct.length > 0 ? direct[0] : el.getElementsByTagNameNS("*", tag)[0];
  return node?.textContent?.trim() || null;
}

function thin(points: GeoPoint[], cap: number): GeoPoint[] {
  if (points.length <= cap) return points;
  const step = points.length / cap;
  const out: GeoPoint[] = [];
  for (let i = 0; i < cap; i++) out.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Parse a .gpx file exported from Strava, Garmin, Nike Run Club, Apple Fitness
 * or any other tracker. Works on the file the athlete downloads themselves, so
 * it sidesteps the Strava API's ban on showing one athlete's data to another.
 *
 * .fit and .tcx are not handled: .fit is a binary format needing a decoder,
 * and .tcx is rare as a manual export. Both trackers can export .gpx.
 */
export function parseGpx(xml: string, opts: { includeRoute?: boolean } = {}): GpxParse {
  const includeRoute = opts.includeRoute ?? true;

  if (!xml || xml.length < 40) return { ok: false, reason: "That file looks empty." };
  if (xml.length > 20_000_000) {
    return { ok: false, reason: "That file is too large — export a single activity, not a bulk archive." };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return { ok: false, reason: "Could not read that file. Make sure it's a .gpx export." };
  }
  if (collect(doc, "parsererror").length > 0) {
    return { ok: false, reason: "That file isn't valid GPX. Try exporting the activity again." };
  }

  const trkpts = collect(doc, "trkpt");
  if (trkpts.length === 0) {
    const hasRoute = collect(doc, "rtept").length > 0 || collect(doc, "wpt").length > 0;
    return {
      ok: false,
      reason: hasRoute
        ? "That GPX is a planned route, not a recorded activity — it has no track points."
        : "No track points found in that file.",
    };
  }

  const points: GeoPoint[] = [];
  for (const p of trkpts) {
    const lat = Number(p.getAttribute("lat"));
    const lng = Number(p.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const timeText = childText(p, "time");
    const t = timeText ? Date.parse(timeText) : NaN;
    points.push({ lat, lng, t: Number.isFinite(t) ? t : 0 });
  }

  if (points.length < 2) {
    return { ok: false, reason: "That file has too few track points to measure a run." };
  }

  const hadTimestamps = points.every((p) => p.t > 0);

  let meters = 0;
  let movingMs = 0;
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    const step = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    if (step < MIN_STEP_M) continue; // keep prev as the anchor

    if (hadTimestamps) {
      const dtSeconds = (cur.t - prev.t) / 1000;
      if (dtSeconds < 0) continue; // out-of-order sample
      if (dtSeconds > 0 && step / 1000 / (dtSeconds / 3600) > MAX_GPS_JITTER_KMH) {
        continue; // implausible jump, drop it and keep the anchor
      }
      if (dtSeconds <= PAUSE_GAP_SECONDS) movingMs += dtSeconds * 1000;
    }

    meters += step;
    prev = cur;
  }

  const distanceKm = meters / 1000;
  const first = points[0];
  const last = points[points.length - 1];
  const elapsedSeconds = hadTimestamps ? Math.max(0, (last.t - first.t) / 1000) : 0;
  const movingSeconds = hadTimestamps ? movingMs / 1000 : 0;

  if (!hadTimestamps) {
    return {
      ok: false,
      reason: `That file has no timestamps, so there's no time to record — only ${distanceKm.toFixed(2)} km. Enter the run manually.`,
    };
  }

  // Use moving time: a run paused at a traffic light shouldn't rank worse.
  const seconds = Math.round(movingSeconds > 0 ? movingSeconds : elapsedSeconds);
  const check = checkRun(distanceKm, seconds);
  if (!check.ok) return { ok: false, reason: check.reason };

  return {
    ok: true,
    run: {
      distanceKm: Number(distanceKm.toFixed(3)),
      elapsedSeconds: Math.round(elapsedSeconds),
      movingSeconds: seconds,
      startedAt: new Date(first.t).toISOString(),
      route: includeRoute ? thin(points, ROUTE_POINT_CAP) : [],
      pointCount: points.length,
      hadTimestamps,
    },
  };
}

/** Read a File from an <input type="file"> and parse it. */
export async function parseGpxFile(
  file: File,
  opts: { includeRoute?: boolean } = {},
): Promise<GpxParse> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".fit")) {
    return {
      ok: false,
      reason: "That's a .fit file. In Strava or Garmin, choose the .gpx export instead.",
    };
  }
  if (name.endsWith(".zip")) {
    return { ok: false, reason: "Unzip that first and pick a single .gpx file." };
  }
  if (!name.endsWith(".gpx") && !name.endsWith(".xml")) {
    return { ok: false, reason: "Pick a .gpx file exported from your tracking app." };
  }
  try {
    const text = await file.text();
    return parseGpx(text, opts);
  } catch {
    return { ok: false, reason: "Could not read that file." };
  }
}
