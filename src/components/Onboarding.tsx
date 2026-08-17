import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { DEPARTMENTS } from "@/lib/departments";
import { parseDurationInput, formatPace } from "@/lib/running";


const DISTANCES = [3, 5, 10] as const;
const GENDERS = ["Man", "Woman", "Prefer not to say"] as const;

const SUGGESTED: Record<number, string> = { 3: "18:00", 5: "30:00", 10: "60:00" };

export function Onboarding() {
  const { user, profile, refreshProfile } = useAuth();
  const [distance, setDistance] = useState<number>(profile?.race_distance ?? 5);
  const [target, setTarget] = useState<string>(SUGGESTED[profile?.race_distance ?? 5] ?? "30:00");
  const [org, setOrg] = useState(profile?.org ?? "");
  const [gender, setGender] = useState<string>(profile?.gender ?? "");
  const [saving, setSaving] = useState(false);

  const targetSeconds = parseDurationInput(target);
  const requiredPace = targetSeconds ? targetSeconds / distance : null;
  const valid = Boolean(targetSeconds && targetSeconds > 300 && org.trim() && gender);

  async function save() {
    if (!user || !valid || !targetSeconds) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        race_distance: distance,
        target_time: targetSeconds,
        org: org.trim(),
        gender,
        onboarded: true,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save. Try again.");
      return;
    }
    await refreshProfile();
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-6 pb-12 pt-14">
      <p className="text-xs font-semibold tracking-widest text-primary uppercase">
        Welcome, {profile?.name?.split(" ")[0] ?? "runner"}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Set your race</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Four quick answers. This shapes your plan and where you land on the board.
      </p>

      <section className="mt-8 space-y-3">
        <Label className="text-sm text-muted-foreground">Race distance</Label>
        <div className="grid grid-cols-3 gap-3">
          {DISTANCES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDistance(d);
                setTarget(SUGGESTED[d] ?? target);
              }}
              className={`card-surface num py-5 text-2xl font-bold transition-all ${
                distance === d
                  ? "bg-gradient-data text-primary-foreground shadow-glow"
                  : "text-foreground"
              }`}
            >
              {d}K
            </button>
          ))}
        </div>
      </section>

      <section className="mt-7 space-y-3">
        <Label htmlFor="target" className="text-sm text-muted-foreground">
          Target finish time (mm:ss or h:mm:ss)
        </Label>
        <Input
          id="target"
          inputMode="numeric"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="num h-14 rounded-xl border-input bg-card text-2xl font-bold"
        />
        <p className="text-xs text-muted-foreground">
          {requiredPace
            ? `That's ${formatPace(requiredPace)} per km.`
            : "Enter a time like 30:00."}
        </p>
      </section>

      <section className="mt-7 space-y-3">
        <Label htmlFor="org" className="text-sm text-muted-foreground">
          Department
        </Label>
        <Select value={org} onValueChange={setOrg}>
          <SelectTrigger
            id="org"
            className="h-14 rounded-xl border-input bg-card text-base data-[placeholder]:text-muted-foreground"
          >
            <SelectValue placeholder="Select your department" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d} className="text-base">
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>


      <section className="mt-7 space-y-3">
        <Label className="text-sm text-muted-foreground">Gender (for the board filters)</Label>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                gender === g
                  ? "border-transparent bg-record text-record-foreground"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </section>

      <Button
        onClick={save}
        disabled={!valid || saving}
        className="mt-10 h-14 w-full rounded-xl bg-gradient-data text-base font-semibold text-primary-foreground shadow-glow hover:opacity-90"
      >
        {saving ? "Saving…" : "Start training"}
      </Button>
    </main>
  );
}
