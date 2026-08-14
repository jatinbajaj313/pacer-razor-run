import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const ALLOWED_DOMAIN = "razorpay.com";

export type Profile = {
  id: string;
  name: string;
  avatar_url: string | null;
  org: string;
  gender: string | null;
  race_distance: number | null;
  target_time: number | null;
  onboarded: boolean;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  domainError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);

  const loadProfile = useCallback(async (user: User) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, name, avatar_url, org, gender, race_distance, target_time, onboarded")
      .eq("id", user.id)
      .maybeSingle();

    if (data) {
      setProfile(data as Profile);
      return;
    }

    const meta = user.user_metadata ?? {};
    const inserted = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        name:
          (meta["full_name"] as string) ||
          (meta["name"] as string) ||
          user.email ||
          "Runner",
        avatar_url: (meta["avatar_url"] as string) || (meta["picture"] as string) || null,
      })
      .select("id, name, avatar_url, org, gender, race_distance, target_time, onboarded")
      .maybeSingle();

    setProfile((inserted.data as Profile) ?? null);
  }, []);

  const applySession = useCallback(
    async (next: Session | null) => {
      const email = next?.user.email?.toLowerCase() ?? "";
      if (next && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        setDomainError(`Pacer is only open to @${ALLOWED_DOMAIN} accounts.`);
        setSession(null);
        setProfile(null);
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
      setSession(next);
      if (next) {
        await loadProfile(next.user);
      } else {
        setProfile(null);
      }
      setLoading(false);
    },
    [loadProfile],
  );

  useEffect(() => {
    let active = true;

    // The Google flow can return to this page as a full-page redirect with the
    // tokens in either the query string or the hash. Consume them before we
    // read the stored session, otherwise the app looks signed out (or blank)
    // right after sign-in.
    async function consumeRedirectTokens(): Promise<boolean> {
      if (typeof window === "undefined") return false;
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const access_token = search.get("access_token") || hash.get("access_token");
      const refresh_token = search.get("refresh_token") || hash.get("refresh_token");
      const errorDescription =
        search.get("error_description") || hash.get("error_description");

      if (!access_token || !refresh_token) {
        if (errorDescription) {
          setDomainError(errorDescription);
          window.history.replaceState({}, "", window.location.pathname);
        }
        return false;
      }

      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
      window.history.replaceState({}, "", window.location.pathname);
      if (error) {
        setDomainError(error.message);
        return false;
      }
      if (active) await applySession(data.session);
      return true;
    }

    void (async () => {
      try {
        if (await consumeRedirectTokens()) return;
        const { data } = await supabase.auth.getSession();
        if (active) await applySession(data.session);
      } catch (err) {
        console.error(err);
        if (active) {
          setDomainError(
            err instanceof Error ? err.message : "Could not finish signing you in.",
          );
          setSession(null);
          setLoading(false);
        }
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (!active) return;
      void applySession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession]);


  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user);
  }, [session, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        profile,
        domainError,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
