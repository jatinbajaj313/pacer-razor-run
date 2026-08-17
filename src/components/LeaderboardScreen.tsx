import { useMemo, useState } from "react";
import { Flame, Target, TrendingUp, Trophy, Calendar, Route, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderboard, type BoardRow } from "@/hooks/useLeaderboard";
import { formatDuration } from "@/lib/running";
import {
  DEPARTMENTS,
  GENDERS,
  UNLISTED,
  normalizeGender,
  normalizeOrg,
} from "@/lib/constants";

type BoardKey = "total" | "five" | "ten" | "consistency" | "improved" | "streak";

const BOARDS: { key: BoardKey; label: string; icon: typeof Trophy }[] = [
  { key: "total", label: "Total distance", icon: Route },
  { key: "five", label: "Fastest 5K", icon: Target },
  { key: "ten", label: "Fastest 10K", icon: Target },
  { key: "consistency", label: "Consistency", icon: Calendar },
  { key: "improved", label: "Most improved", icon: TrendingUp },
  { key: "streak", label: "Streak", icon: Flame },
];

function metric(board: BoardKey, r: BoardRow): { value: number | null; label: string } {
  switch (board) {
    case "total":
      return { value: r.total_km > 0 ? r.total_km : null, label: `${r.total_km.toFixed(1)} km` };
    case "five":
      return {
        value: r.best_5k_seconds,
        label: r.best_5k_seconds ? formatDuration(r.best_5k_seconds) : "—",
      };
    case "ten":
      return {
        value: r.best_10k_seconds,
        label: r.best_10k_seconds ? formatDuration(r.best_10k_seconds) : "—",
      };
    case "consistency":
      return {
        value: r.active_days > 0 ? r.active_days : null,
        label: `${r.active_days} day${r.active_days === 1 ? "" : "s"}`,
      };
    case "improved":
      return {
        value: r.improvement_pct != null && r.improvement_pct > 0 ? r.improvement_pct : null,
        label: r.improvement_pct != null ? `${r.improvement_pct.toFixed(1)}%` : "—",
      };
    case "streak":
      return {
        value: r.streak_days > 0 ? r.streak_days : null,
        label: `${r.streak_days} day${r.streak_days === 1 ? "" : "s"}`,
      };
  }
}

const ASCENDING: BoardKey[] = ["five", "ten"];

const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground";

export function LeaderboardScreen() {
  const { user } = useAuth();
  const { rows, loading, error } = useLeaderboard();
  const [board, setBoard] = useState<BoardKey>("total");
  const [dept, setDept] = useState("all");
  const [gender, setGender] = useState("all");

  // Department and gender options are FIXED lists — nobody can invent a new one.
  // Existing messy values ("Man", "BizFin") get folded in by the normalisers.
  const hasUnlisted = useMemo(
    () => rows.some((r) => normalizeOrg(r.org) === UNLISTED),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (dept !== "all" && normalizeOrg(r.org) !== dept) return false;
        if (gender !== "all" && normalizeGender(r.gender) !== gender) return false;
        return true;
      }),
    [rows, dept, gender],
  );

  const ranked = useMemo(() => {
    const asc = ASCENDING.includes(board);
    return filtered
      .map((r) => ({ row: r, ...metric(board, r) }))
      .filter((e) => e.value != null)
      .sort((a, b) => (asc ? a.value! - b.value! : b.value! - a.value!));
  }, [filtered, board]);

  const activeFilters = (dept !== "all" ? 1 : 0) + (gender !== "all" ? 1 : 0);

  const clearFilters = () => {
    setDept("all");
    setGender("all");
  };

  const myIndex = ranked.findIndex((e) => e.row.user_id === user?.id);
  const chase = myIndex > 0 ? ranked[myIndex - 1] : null;
  const me = myIndex >= 0 ? ranked[myIndex] : null;

  return (
    <main className="min-h-screen px-4 pb-28 pt-6">
      <header className="mb-4">
        <p className="num text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
          Razor Run 2026
        </p>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
      </header>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {BOARDS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setBoard(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              board === key
                ? "border-transparent bg-gradient-data text-primary-foreground"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="num mb-1 block text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
            Department
          </span>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={SELECT_CLASS}>
            <option value="all">All</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {hasUnlisted && <option value={UNLISTED}>{UNLISTED}</option>}
          </select>
        </label>

        <label className="block">
          <span className="num mb-1 block text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
            Gender
          </span>
          <select value={gender} onChange={(e) => setGender(e.target.value)} className={SELECT_CLASS}>
            <option value="all">Everyone</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <p className="num text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {activeFilters > 0
            ? `${ranked.length} of ${rows.length} runners`
            : `${rows.length} runner${rows.length === 1 ? "" : "s"}`}
        </p>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-semibold text-muted-foreground"
          >
            <X className="size-3" />
            Clear
          </button>
        )}
      </div>

      {chase && me && (
        <section className="card-surface mb-5 rounded-2xl p-4">
          <p className="num text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Chase card
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Avatar row={chase.row} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{chase.row.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {normalizeOrg(chase.row.org)} · rank {myIndex}
              </p>
            </div>
            <p className="num text-lg font-bold">{chase.label}</p>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            You&apos;re at <span className="num text-foreground">{me.label}</span> — close the gap
            to take rank {myIndex}.
          </p>
        </section>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading boards…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && ranked.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {activeFilters > 0
            ? "Nobody on this board matches those filters. Try clearing one."
            : "No results on this board yet. Record a run to get on it."}
        </p>
      )}

      <ol className="space-y-2">
        {ranked.map((entry, i) => {
          const isMe = entry.row.user_id === user?.id;
          return (
            <li
              key={entry.row.user_id}
              className={`flex items-center gap-3 rounded-2xl border p-3 ${
                isMe ? "border-primary/60 bg-primary/10" : "border-border bg-card"
              }`}
            >
              <span className="num w-6 text-center text-sm font-bold text-muted-foreground">
                {i + 1}
              </span>
              <Avatar row={entry.row} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {entry.row.name}
                  {isMe && <span className="ml-2 text-[10px] text-primary">YOU</span>}
                </p>
              </div>
              <p className="num font-bold">{entry.label}</p>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function Avatar({ row }: { row: BoardRow }) {
  if (row.avatar_url) {
    return (
      <img
        src={row.avatar_url}
        alt={row.name}
        className="size-9 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span className="flex size-9 items-center justify-center rounded-full bg-gradient-data text-xs font-bold text-primary-foreground">
      {row.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
