import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { SignInScreen } from "@/components/SignInScreen";
import { Onboarding } from "@/components/Onboarding";
import { RecordScreen } from "@/components/RecordScreen";
import { HomeScreen } from "@/components/HomeScreen";
import { LeaderboardScreen } from "@/components/LeaderboardScreen";
import { PlanScreen } from "@/components/PlanScreen";
import { YouScreen } from "@/components/YouScreen";
import { BottomNav, type TabKey } from "@/components/BottomNav";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pacer — Razor Run 2026 training & leaderboard" },
      {
        name: "description",
        content:
          "Track your runs with GPS, follow an adaptive training plan and climb the Razor Run 2026 leaderboard.",
      },
      { property: "og:title", content: "Pacer — Razor Run 2026" },
      {
        property: "og:description",
        content:
          "GPS run tracking, live leaderboards and an adaptive plan for Razor Run 2026 in Bengaluru.",
      },
    ],
  }),
  component: PacerApp,
});

function PacerApp() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { loading, session, profile, domainError, signOut } = useAuth();
  const [tab, setTab] = useState<TabKey>("record");

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="num text-sm tracking-widest text-muted-foreground uppercase">Loading…</p>
      </main>
    );
  }

  if (!session) return <SignInScreen domainError={domainError} />;
  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Setting up your profile…</p>
      </main>
    );
  }
  if (!profile.onboarded) return <Onboarding />;

  return (
    <div className="mx-auto min-h-screen w-full max-w-md">
      <RecordScreen />
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label="Sign out"
        className="fixed right-4 top-4 z-40 rounded-full border border-border bg-card p-2 text-muted-foreground"
      >
        <LogOut className="size-4" />
      </button>
      <BottomNav active={tab} onSelect={setTab} enabled={["record"]} />
    </div>
  );
}
