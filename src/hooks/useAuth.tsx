import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
  /** Signed in fine, but the profile row couldn't be read or created. */
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const PROFILE_COLUMNS =
  "id, name, avatar_url, org, gender, race_distance, target_time, onboarded";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  /**
   * Sign-in fires applySession from two places — the redirect handler and the
   * SIGNED_IN event. Without this, both race to create the profile row: the
   * loser gets a duplicate-key error and used to blank out the profile that the
   * winner had just created. New users hung on "Setting up your profile…";
   * existing users were never affected because they never reached the insert.
   */
  const inFlight = useRef<Promise<void> | null>(null);
  const handledUserId = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Profile | null) ?? null;
  }, []);

  const loadProfile = useCallback(
    async (user: User) => {
      if (inFlight.current) return inFlight.current; // collapse concurrent calls

      const work = (async () => {
        setProfileError(null);
        try {
          const existing = await fetchProfile(user.id);
          if (existing) {
            setProfile(existing);
            return;
          }

          const meta = user.user_metadata ?? {};
          const name =
            (meta["full_name"] as string) ||
            (meta["name"] as string) ||
            user.email ||
            "Runner";
          const avatar =
            (meta["avatar_url"] as string) || (meta["picture"] as string) || null;

          // upsert, not insert: if the other call won the race, this is a no-op
          // that returns the existing row instead of an error.
          const { data, error } = await supabase
            .from("profiles")
            .upsert({ id: user.id, name, avatar_url: avatar }, { onConflict: "id" })
            .select(PROFILE_COLUMNS)
            .maybeSingle();

          if (data) {
            setProfile(data as Profile);
            return;
          }

          // Upsert blocked (RLS, or a NOT NULL column we don't supply). The row
          // may still exist from the other call, so look again before failing.
          const afterward = await fetchProfile(user.id);
          if (afterward) {
            setProfile(afterward);
            return;
          }
          throw new Error(error?.message ?? "Could not create your profile.");
        } catch (err) {
          console.error("[profile]", err);
          setProfileError(
            err instanceof Error
              ? err.message
              : "Could not set up your profile. Tap retry.",
          );
          // Deliberately leave `profile` as-is rather than nulling it: a failed
          // write must never erase a profile that already loaded.
        }
      })();

      inFlight.current = work;
      try {
        await work;
      } finally {
        inFlight.current = null;
      }
    },
    [fetchProfile],
  );

  const applySession = useCallback(
    async (next: Session | null) => {
      const email = next?.user.email?.toLowerCase() ?? "";
      if (next && !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        setDomainError(`Pacer is only open to @${ALLOWED_DOMAIN} accounts.`);
        setSession(null);
        setProfile(null);
        handledUserId.current = null;
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      setSession(next);

      if (!next) {
        setProfile(null);
        handledUserId.current = null;
        setLoading(false);
        return;
      }

      // Skip redundant work when both entry points report the same user.
      if (handledUserId.current === next.user.id && profile) {
        setLoading(false);
        return;
      }
      handledUserId.current = next.user.id;

      await loadProfile(next.user);
      setLoading(false);
    },
    [loadProfile, profile],
  );

  useEffect(() => {
    let active = true;

    // The Google flow can return here as a full-page redirect with tokens in
    // the query string or the hash. Consume them before reading the stored
    // session, otherwise the app looks signed out right after sign-in.
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
    setProfileError(null);
    handledUserId.current = null;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user: session?.user ?? null,
        profile,
        domainError,
        profileError,
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
