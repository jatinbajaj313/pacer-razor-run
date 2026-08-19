PATCH FOR src/routes/index.tsx
================================

Two small edits. Everything else in the file stays as it is.

--------------------------------------------------------------------
EDIT 1 — pull the two new values out of useAuth
--------------------------------------------------------------------

FIND this line:

  const { loading, session, profile, domainError } = useAuth();

REPLACE with:

  const { loading, session, profile, domainError, profileError, refreshProfile } = useAuth();


--------------------------------------------------------------------
EDIT 2 — stop hanging forever when the profile can't be created
--------------------------------------------------------------------

FIND this block:

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Setting up your profile…</p>
      </main>
    );
  }

REPLACE with:

  if (!profile) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        {profileError ? (
          <>
            <p className="text-sm font-semibold">We couldn't finish setting up your profile</p>
            <p className="text-sm text-muted-foreground">{profileError}</p>
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold"
            >
              Try again
            </button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Setting up your profile…</p>
        )}
      </main>
    );
  }


--------------------------------------------------------------------
Why this matters
--------------------------------------------------------------------

Before: if profile creation failed, `profile` stayed null and this screen showed
"Setting up your profile…" indefinitely. The user had no path forward and no idea
what went wrong — that's the "something went wrong" your colleagues reported.

After: the actual database error is shown, with a retry that doesn't require
signing out and back in. It also makes the real cause visible to you during the
demo instead of a spinner.
