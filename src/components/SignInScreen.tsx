import { useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { ALLOWED_DOMAIN } from "@/hooks/useAuth";
import { RACE_DATE } from "@/lib/running";

export function SignInScreen({ domainError }: { domainError: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysToRace = Math.max(
    0,
    Math.ceil((new Date(`${RACE_DATE}T06:00:00+05:30`).getTime() - Date.now()) / 86400000),
  );

  async function signIn() {
    setBusy(true);
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
      extraParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
    });
    if (result.error) {
      setError(
        typeof result.error === "string"
          ? result.error
          : (result.error as { message?: string })?.message || "Sign-in failed. Please try again.",
      );
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    setBusy(false);
  }

  return (
    <main className="relative flex min-h-screen flex-col justify-between overflow-hidden px-6 pb-10 pt-16">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gradient-data opacity-25 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-sm font-medium tracking-widest text-muted-foreground uppercase">
          <Activity className="size-4 text-primary" />
          Razor Run 2026
        </div>
        <h1 className="mt-6 text-6xl font-bold leading-[0.95] tracking-tight">
          Pacer<span className="text-record">.</span>
        </h1>
        <p className="mt-4 max-w-xs text-base text-muted-foreground">
          Track every run, climb the board, and arrive at the start line ready. Race day is 6
          September 2026 in Bengaluru.
        </p>
        <p className="num mt-8 text-5xl font-bold text-gradient-data">{daysToRace} days</p>
        <p className="text-sm text-muted-foreground">until the gun goes off</p>
      </div>

      <div className="relative space-y-4">
        {domainError && (
          <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-danger">
            {domainError}
          </p>
        )}
        {error && (
          <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          size="lg"
          onClick={signIn}
          disabled={busy}
          className="h-14 w-full rounded-xl bg-gradient-data text-base font-semibold text-primary-foreground shadow-glow hover:opacity-90"
        >
          {busy ? "Opening Google…" : "Continue with Google"}
        </Button>
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          @{ALLOWED_DOMAIN} accounts only
        </p>
      </div>
    </main>
  );
}
