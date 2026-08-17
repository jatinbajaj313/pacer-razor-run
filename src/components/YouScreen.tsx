import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyRuns } from "@/hooks/useMyRuns";
import { supabase } from "@/integrations/supabase/client";
import { DEPARTMENTS } from "@/lib/departments";
import { formatDuration, parseDurationInput } from "@/lib/running";
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

export function YouScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { runs } = useMyRuns(user?.id);

  const [name, setName] = useState(profile?.name ?? "");
  const [org, setOrg] = useState(profile?.org ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "");
  const [raceDistance, setRaceDistance] = useState(String(profile?.race_distance ?? 5));
  const [target, setTarget] = useState(
    profile?.target_time ? formatDuration(profile.target_time) : "",
  );
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("private_profiles")
        .select("age, height_cm, weight_kg")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setAge(data.age ? String(data.age) : "");
        setHeight(data.height_cm ? String(data.height_cm) : "");
        setWeight(data.weight_kg ? String(data.weight_kg) : "");
      }
    })();
  }, [user]);

  async function save() {
    if (!user) return;
    setSaving(true);
    setMsg(null);
    const targetSeconds = target ? parseDurationInput(target) : null;
    const { error } = await supabase
      .from("profiles")
      .update({
        name: name.trim() || "Runner",
        org,
        gender: gender || null,
        race_distance: Number(raceDistance),
        target_time: targetSeconds,
      })
      .eq("id", user.id);

    const privErr = await supabase.from("private_profiles").upsert(
      {
        user_id: user.id,
        age: age ? Number(age) : null,
        height_cm: height ? Number(height) : null,
        weight_kg: weight ? Number(weight) : null,
      },
      { onConflict: "user_id" },
    );

    setSaving(false);
    if (error || privErr.error) {
      setMsg(error?.message ?? privErr.error?.message ?? "Could not save.");
      return;
    }
    setMsg("Saved.");
    await refreshProfile();
  }

  const totalKm = runs.reduce((s, r) => s + r.distance_km, 0);

  return (
    <main className="min-h-screen px-4 pb-28 pt-6">
      <header className="mb-5 flex items-center gap-3">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt={profile.name} className="size-12 rounded-full" />
        ) : (
          <span className="flex size-12 items-center justify-center rounded-full bg-gradient-data font-bold text-primary-foreground">
            {(profile?.name ?? "R").slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{profile?.name}</h1>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Sign out">
          <LogOut className="size-4" />
        </Button>
      </header>

      <section className="card-surface mb-5 grid grid-cols-2 gap-3 rounded-2xl p-4">
        <div>
          <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Total</p>
          <p className="num text-xl font-bold">{totalKm.toFixed(1)} km</p>
        </div>
        <div>
          <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Runs</p>
          <p className="num text-xl font-bold">{runs.length}</p>
        </div>
      </section>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Department</Label>
          <Select value={org} onValueChange={setOrg}>
            <SelectTrigger>
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Gender</Label>
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {["Male", "Female", "Other", "Prefer not to say"].map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Race distance</Label>
            <Select value={raceDistance} onValueChange={setRaceDistance}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["3", "5", "10"].map((d) => (
                  <SelectItem key={d} value={d}>
                    {d} K
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target">Target time</Label>
            <Input
              id="target"
              inputMode="numeric"
              placeholder="mm:ss"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
        </div>

        <p className="pt-2 text-xs text-muted-foreground">
          Private — only you can see these; used to tune your plan.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="age">Age</Label>
            <Input id="age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="height">Height cm</Label>
            <Input
              id="height"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weight">Weight kg</Label>
            <Input
              id="weight"
              inputMode="numeric"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
        </div>

        <Button className="w-full" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
        {msg && <p className="text-center text-sm text-muted-foreground">{msg}</p>}
      </div>
    </main>
  );
}
