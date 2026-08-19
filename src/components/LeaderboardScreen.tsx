import { useMemo, useState } from "react";
import { Flame, Target, TrendingUp, Trophy, Calendar, Route, X, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useDepartments,
  useLeaderboard,
  type BoardRow,
  type DepartmentRow,
} from "@/hooks/useLeaderboard";
import {
  MAX_PACE_SEC_PER_KM,
  MIN_PACE_SEC_PER_KM,
  RACE_DATE,
  formatDuration,
} from "@/lib/running";
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
    case "five": {
      const v = saneSeconds(r.best_5k_seconds, 5);
      return { value: v, label: v ? formatDuration(v) : "—" };
    }
    case "ten": {
      const v = saneSeconds(r.best_10k_seconds, 10);
      return { value: v, label: v ? formatDuration(v) : "—" };
    }
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

/**
 * Defensive guard against a unit slip upstream. If a stored best-5K/10K implies
 * an impossible pace but dividing by 60 lands squarely in human range, the value
 * was minutes where seconds were expected — show the sane one. If it can't be
 * rescued, leave it alone rather than invent a number.
 */
function saneSeconds(seconds: number | null, km: number): number | null {
  if (seconds == null || seconds <= 0) return null;
  const pace = seconds / km;
  if (pace >= MIN_PACE_SEC_PER_KM && pace <= MAX_PACE_SEC_PER_KM) return seconds;
  const alt = seconds / 60;
  const altPace = alt / km;
  if (altPace >= MIN_PACE_SEC_PER_KM && altPace <= MAX_PACE_SEC_PER_KM) return alt;
  return seconds;
}

/** How far behind the leader, in the board's own unit. Race results show gaps, not bars. */
function gapLabel(board: BoardKey, value: number, leader: number): string {
  const d = Math.abs(value - leader);
  if (d < 0.05) return "leader";
  switch (board) {
    case "five":
    case "ten":
      return `+${formatDuration(d)}`;
    case "total":
      return `\u2212${d.toFixed(1)} km`;
    case "improved":
      return `\u2212${d.toFixed(1)}%`;
    default:
      return `\u2212${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`;
  }
}

const daysToRace = () => {
  const race = new Date(`${RACE_DATE}T06:00:00+05:30`).getTime();
  return Math.ceil((race - Date.now()) / 86_400_000);
};

/** Bib-style rank tile. Race numbers are the vernacular of the subject. */
function Bib({ rank, tone }: { rank: number; tone: "gold" | "silver" | "bronze" | "plain" }) {
  const ring =
    tone === "gold"
      ? "border-amber-300 text-amber-200"
      : tone === "silver"
        ? "border-zinc-300 text-zinc-200"
        : tone === "bronze"
          ? "border-amber-700 text-amber-500"
          : "border-border text-muted-foreground";
  return (
    <span
      className={`num flex size-9 shrink-0 items-center justify-center border ${ring} text-sm font-bold tabular-nums`}
      style={{ borderRadius: 2 }}
    >
      {rank}
    </span>
  );
}

const SELECT_CLASS =
  "w-full appearance-none rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground";

export function LeaderboardScreen() {
  const { user } = useAuth();
  const { rows, loading, error } = useLeaderboard();
  const departments = useDepartments(2);
  const [view, setView] = useState<"runners" | "departments">("runners");
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

  const myOrg = useMemo(() => {
    const mine = rows.find((r) => r.user_id === user?.id);
    return mine?.org ? normalizeOrg(mine.org) : null;
  }, [rows, user?.id]);

  const myIndex = ranked.findIndex((e) => e.row.user_id === user?.id);
  const chase = myIndex > 0 ? ranked[myIndex - 1] : null;
  const me = myIndex >= 0 ? ranked[myIndex] : null;
  const leader = ranked[0]?.value ?? null;
  const asc = ASCENDING.includes(board);
  const days = daysToRace();

  /** Fraction of the leader's performance, for the timing strip under each row. */
  const ratio = (value: number) => {
    if (leader == null || leader <= 0 || value <= 0) return 0;
    return Math.max(0.04, Math.min(1, asc ? leader / value : value / leader));
  };

  return (
    <main className="min-h-screen px-4 pb-28 pt-6">
      <header className="mb-5 border-b border-border pb-4">
        <div className="flex items-baseline justify-between">
          <p className="num text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
            Razor Run 2026
          </p>
          <p className="num text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            {days > 1
              ? `${days} days out`
              : days === 1
                ? "Tomorrow"
                : days === 0
                  ? "Race day"
                  : "Complete"}
          </p>
        </div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Leaderboard</h1>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-1">
        {(
          [
            ["runners", "Runners", Trophy],
            ["departments", "Departments", Users],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              view === key ? "bg-gradient-data text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {view === "departments" ? (
        <DepartmentBoard
          rows={departments.rows}
          loading={departments.loading}
          error={departments.error}
          myOrg={myOrg}
        />
      ) : (
        <>
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

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && ranked.length === 0 && (
        <div className="card-surface p-6 text-center">
          <p className="text-sm font-semibold">
            {activeFilters > 0 ? "Nobody matches those filters" : "This board is empty"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeFilters > 0
              ? "Clear one and try again."
              : "Record a run and you'll be first on it."}
          </p>
        </div>
      )}

      {!loading && ranked.length > 0 && (
        <ol className="space-y-2">
          {ranked.map((entry, i) => {
            const isMe = entry.row.user_id === user?.id;
            const tone = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "plain";
            const width = `${ratio(entry.value!) * 100}%`;
            return (
              <li
                key={entry.row.user_id}
                className={`relative overflow-hidden rounded-2xl border p-3 ${
                  isMe ? "border-primary/60 bg-primary/10" : "border-border bg-card"
                }`}
              >
                {/* timing strip: distance from the leader, at a glance */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-data"
                  style={{ width }}
                />
                <div className="flex items-center gap-3">
                  <Bib rank={i + 1} tone={tone} />
                  <Avatar row={entry.row} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {entry.row.name}
                      {isMe && (
                        <span className="num ml-2 text-[9px] tracking-[0.16em] text-primary">
                          YOU
                        </span>
                      )}
                    </p>
                    {leader != null && (
                      <p className="num mt-0.5 text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                        {gapLabel(board, entry.value!, leader)}
                      </p>
                    )}
                  </div>
                  <p className="num text-lg font-bold tabular-nums">{entry.label}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Your position, reachable without scrolling the whole board */}
      {me && myIndex > 4 && leader != null && (
        <div className="sticky bottom-24 mt-3">
          <div className="flex items-center gap-3 rounded-2xl border border-primary/60 bg-elevated p-3 shadow-lg">
            <Bib rank={myIndex + 1} tone="plain" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Your position</p>
              <p className="num mt-0.5 text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                {gapLabel(board, me.value!, leader)} off the lead
              </p>
            </div>
            <p className="num text-lg font-bold tabular-nums">{me.label}</p>
          </div>
        </div>
      )}

        </>
      )}
    </main>
  );
}

function DepartmentBoard({
  rows,
  loading,
  error,
  myOrg,
}: {
  rows: DepartmentRow[];
  loading: boolean;
  error: string | null;
  myOrg: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (rows.length === 0) {
    return (
      <div className="card-surface p-6 text-center">
        <p className="text-sm font-semibold">No departments on the board yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Teams appear once at least two people from a department have signed up.
        </p>
      </div>
    );
  }

  const leader = rows[0]?.km_per_member ?? 0;

  return (
    <>
      <p className="num mb-3 text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        Kilometres per person · size doesn&apos;t win
      </p>
      <ol className="space-y-2">
        {rows.map((d, i) => {
          const isMine = myOrg != null && d.org === myOrg;
          const tone = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "plain";
          const width = leader > 0 ? Math.max(4, (d.km_per_member / leader) * 100) : 0;
          return (
            <li
              key={d.org}
              className={`relative overflow-hidden rounded-2xl border p-3 ${
                isMine ? "border-primary/60 bg-primary/10" : "border-border bg-card"
              }`}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-data"
                style={{ width: `${width}%` }}
              />
              <div className="flex items-center gap-3">
                <Bib rank={i + 1} tone={tone} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {d.org}
                    {isMine && (
                      <span className="num ml-2 text-[9px] tracking-[0.16em] text-primary">
                        YOURS
                      </span>
                    )}
                  </p>
                  <p className="num mt-0.5 text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
                    {d.active_count}/{d.member_count} running · {d.total_km.toFixed(0)} km total
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-lg font-bold tabular-nums">
                    {d.km_per_member.toFixed(1)}
                  </p>
                  <p className="num text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
                    km / head
                  </p>
                </div>
              </div>

              {/* participation is the number that actually moves a team challenge */}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-success/70"
                    style={{ width: `${d.participation_pct}%` }}
                  />
                </div>
                <span className="num text-[9px] text-muted-foreground">
                  {d.participation_pct.toFixed(0)}% in
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
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
