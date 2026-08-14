import { Home, Timer, Trophy, CalendarDays, User } from "lucide-react";

export type TabKey = "home" | "record" | "board" | "plan" | "you";

const TABS: { key: TabKey; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "record", label: "Record", icon: Timer },
  { key: "board", label: "Board", icon: Trophy },
  { key: "plan", label: "Plan", icon: CalendarDays },
  { key: "you", label: "You", icon: User },
];

export function BottomNav({
  active,
  onSelect,
  enabled,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
  enabled: TabKey[];
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-md items-end justify-between px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isRecord = key === "record";
          const isActive = active === key;
          const isEnabled = enabled.includes(key);

          if (isRecord) {
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                aria-label="Record a run"
                className="-mt-6 flex flex-col items-center gap-1"
              >
                <span
                  className={`flex size-14 items-center justify-center rounded-full bg-gradient-record text-record-foreground transition-transform ${
                    isActive ? "scale-105 shadow-record-glow" : "opacity-90"
                  }`}
                >
                  <Icon className="size-6" />
                </span>
                <span className="text-[11px] font-semibold text-record">{label}</span>
              </button>
            );
          }

          return (
            <button
              key={key}
              type="button"
              disabled={!isEnabled}
              onClick={() => onSelect(key)}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors ${
                isActive
                  ? "text-primary"
                  : isEnabled
                    ? "text-muted-foreground"
                    : "text-muted-foreground/40"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
