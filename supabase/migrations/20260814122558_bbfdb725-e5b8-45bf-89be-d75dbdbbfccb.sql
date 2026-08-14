CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  org TEXT NOT NULL DEFAULT '',
  gender TEXT,
  race_distance INTEGER,
  target_time INTEGER,
  onboarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by signed-in users" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.private_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  age INTEGER,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_profiles TO authenticated;
GRANT ALL ON public.private_profiles TO service_role;
ALTER TABLE public.private_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner only select" ON public.private_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner only insert" ON public.private_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner only update" ON public.private_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner only delete" ON public.private_profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  ran_on DATE NOT NULL DEFAULT CURRENT_DATE,
  distance_km NUMERIC NOT NULL,
  duration_seconds INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'gps',
  route JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX runs_user_id_idx ON public.runs (user_id);
CREATE INDEX runs_ran_on_idx ON public.runs (ran_on);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Runs are viewable by signed-in users" ON public.runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert their own runs" ON public.runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update their own runs" ON public.runs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete their own runs" ON public.runs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER private_profiles_touch BEFORE UPDATE ON public.private_profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;