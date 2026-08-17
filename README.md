# Pacer Run Tracker

# Lovable prompt — Pacer (Razor Run 2026)

Paste this as your first message in a new Lovable project. Then iterate one screen at a time.

---

Build a mobile-first web app called **Pacer** for an internal company running event.

## Context

Razor Run 2026 is an employee race on **6 September 2026** in Bengaluru. Participants run 3K, 5K or 10K. There are 400+ registrants across India, Singapore, Malaysia and the USA. Most are first-time runners with no fitness tracker. The app has two jobs: a live competitive leaderboard, and a training plan that adapts to what people actually run.

Design for phones first. Most people will open this on a phone, one-handed, right after a run.

## Auth

Google sign-in, restricted to the **@razorpay.com** email domain. No other sign-up path. Use the Google profile name and photo. First sign-in goes to a short onboarding: race distance, target finish time, org/team name, gender.

## Data model

**profiles** (public — visible to all signed-in users)
- id, name, avatar_url, org, gender, race_distance (3/5/10), target_time (seconds)

**private_profiles** (row-level security: readable and writable only by the owning user, never by anyone else)
- user_id, age, height_cm, weight_kg

**runs** (public)
- id, user_id, ran_on (date), distance_km, duration_seconds, source ('gps' | 'manual'), created_at
- Optional: route as an array of lat/lng points

Set up Row Level Security so `private_profiles` is genuinely unreadable by other users. This is a hard requirement, not a preference — the app collects age, height and weight and must never expose them.

## Screen 1 — Record (the most important screen)

A GPS run tracker, like Strava's record screen.

- Big **Start run** button.
- While running: live distance in km as a very large number, elapsed time, current pace per km, average pace per km.
- Use `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`. Compute distance between consecutive points with the Haversine formula.
- Filter noise: ignore any reading with accuracy worse than 40 m; ignore point-to-point moves under 2 m; reject implied speeds above 30 km/h.
- Show a live GPS signal indicator (green under 15 m, amber under 35 m, red beyond).
- Request a screen wake lock (`navigator.wakeLock`) so the phone doesn't sleep mid-run. Warn the user that switching apps pauses GPS tracking.
- **Stop** saves the run and shows a summary: distance, time, pace, and the user's new leaderboard position.
- Include a small manual-entry form as a fallback: date, distance, time.
- Include a hidden or clearly-labelled "simulate a run" action for demos on desktop where there is no GPS.

## Screen 2 — Leaderboard

Six separate boards, switchable by horizontal pill tabs:

1. **Total distance** (km, descending)
2. **Fastest 5K** (from runs of 5 km or more, ascending)
3. **Fastest 10K** (from runs of 10 km or more, ascending)
4. **Consistency** — runs in the last 21 days, descending
5. **Most improved** — average pace of the first 3 runs vs the last 3 runs, as a percentage gain. Needs at least 6 runs to qualify. This board matters: it's where a beginner can beat a fast runner.
6. **Streak** — consecutive calendar weeks with 2 or more runs

Filters: Everyone, Men, Women, 3K, 5K, 10K.

Each board shows a **podium** for the top 3 (avatars, first names, 1st raised above 2nd and 3rd), then a ranked list. Each row: rank, avatar, name, org and distance, a horizontal bar showing their value relative to the leader, their value, and their run count. Highlight the signed-in user's own row.

**The chase card** — the single most important motivational element. Above the list, show who is directly ahead of the current user on the active board and exactly what it would take to pass them. Examples: "Arjun Rao is ahead. You need 1.4 km to take 3rd." / "You need 0:12 quicker to take 2nd." / "2 more runs to take 5th." Compute this per board type.

Tapping any runner opens a head-to-head comparison against the current user: total km, runs in 21 days, best 5K, best 10K, longest run, streak.

Leaderboards must update live — use Supabase realtime subscriptions on the `runs` table so a new run appears for everyone without a refresh.

## Screen 3 — Plan

Generate a week-by-week training plan from today to 6 September.

Inputs: race distance, target time, the user's logged run history, and (if provided) age, height and weight from `private_profiles`.

Calculations, in code — not by a model, so the numbers are consistent and checkable:
- **Required pace** = target_time / race_distance
- **Predicted finish** using the Riegel formula: `T2 = T1 × (D2/D1)^1.06`, taking the user's best recent effort at any distance and projecting it to their race distance
- **Pace zones** derived from required pace P (seconds per km): Easy = P + 75, Long = P + 60, Tempo = P + 10, Intervals = P − 15
- **Weekly volume** starts from the user's current 2-week average, ramps at most 8% per week, caps at 2.5× race distance
- **Long run** builds to 80% of race distance for 10K runners, 100% for 3K and 5K
- **Taper**: final week at 50% volume, week before at 75%

Adaptation rules — this is what makes it more than a static plan:
- If the user logged fewer sessions than planned last week, hold volume flat instead of stepping up, and tell them why: ramping through a missed week is how people get injured.
- Age 45 or older: cap hard sessions at one per week for recovery.
- BMI 28 or above (computed privately from height and weight): weight the plan toward easy volume rather than intensity.
- Fewer than 3 runs logged: prescribe no interval sessions at all — build a base first.

Show a **verdict** prominently: "On track" if the predicted finish beats the target; "In reach" if within 6%; "Off target" beyond that, with the honest statement that either the target moves or the volume does.

Display weeks as collapsible cards with completion pips showing sessions done versus planned. Highlight today's session at the top of the home screen as a single clear instruction, not a wall of text.

Never display BMI, weight, height or age anywhere in the interface. They shape the plan silently.

## Screen 4 — Home

- A circular progress ring: predicted finish versus target time, filling as the user gets closer. Green when inside target, amber when close, red when off.
- Today's session as one prominent card.
- The chase card.
- An 8-week volume bar chart.
- Key stats: total km, current streak, runs in the last 21 days, best pace.

## Screen 5 — You

Editable profile: name, org, gender, race distance, target time. A collapsed section for private details (age, height, weight) with a clear label saying these stay private, shape the plan, are never displayed or ranked, and are optional.

## Navigation

Fixed bottom tab bar with five tabs: Home, Record, Board, Plan, You. Record gets an accent colour and a distinct icon.

## Visual direction

Dark, high-contrast, energetic — closer to a fitness app than a dashboard. Deep near-black background (#080B12), elevated cards a shade lighter, a blue-to-violet gradient (#3395FF → #7C5CFF) for primary data, hot pink-red (#FF4D6D) for the record action and the user's own highlights, green (#38E8A0) for on-target states, amber (#FFB53D) for warnings.

Big bold numerals — the distance readout on the record screen should be enormous. A monospace font for all numbers and data so figures align; a geometric sans for headings and labels. Generous rounded corners (14–22px). Smooth transitions on bars and the progress ring. Respect `prefers-reduced-motion`.

## Build order

1. Auth, profiles, onboarding
2. The Record screen with working GPS — get this right before anything else, it's the core of the product
3. Leaderboard with the six boards and the chase card
4. Realtime subscriptions
5. Plan generation and adaptation
6. Home screen

Start with steps 1 and 2 only. Show me the GPS tracker working before building anything else.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pacer-razor-run.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b10801e2-25ce-4823-8d1b-c916d3ffa14d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
