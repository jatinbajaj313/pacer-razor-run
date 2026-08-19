import { createServerFn } from "@tanstack/react-start";

/**
 * Server-side only. The build replaces this with an RPC stub in the client
 * bundle, so the Anthropic key never reaches the browser.
 *
 * Requires these environment variables on the server:
 *   ANTHROPIC_API_KEY  — your Anthropic key
 *   VITE_SUPABASE_URL  — already present; used to verify the caller's token
 *   VITE_SUPABASE_PUBLISHABLE_KEY — already present
 */

const MODEL = "claude-sonnet-4-6";
const ALLOWED_DOMAIN = "razorpay.com";

export type CoachResponse = { week?: unknown; error?: string };

type CoachRequest = {
  context: unknown;
  systemPrompt: string;
  /** The caller's Supabase access token, so the server can confirm who they are. */
  accessToken: string;
};

export const requestCoachWeek = createServerFn({ method: "POST" })
  .validator((data: CoachRequest) => {
    if (!data || typeof data.systemPrompt !== "string" || !data.context) {
      throw new Error("Missing coach context.");
    }
    if (typeof data.accessToken !== "string" || data.accessToken.length < 20) {
      throw new Error("Not signed in.");
    }
    if (JSON.stringify(data.context).length > 20_000) {
      throw new Error("Context too large.");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CoachResponse> => {
    // Read env inside the handler: at module scope it can be inlined into the
    // client bundle, and on edge runtimes it isn't populated yet.
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl =
      process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
    const supabaseKey =
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

    if (!apiKey) return { error: "The coach isn't configured yet — no API key set." };

    // Confirm the caller is a signed-in Razorpay account. Without this the
    // function is an open proxy to a paid API.
    try {
      const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${data.accessToken}`, apikey: supabaseKey },
      });
      if (!who.ok) return { error: "Sign in again and retry." };
      const user = (await who.json()) as { email?: string };
      const email = (user.email ?? "").toLowerCase();
      if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return { error: `The coach is only available to @${ALLOWED_DOMAIN} accounts.` };
      }
    } catch {
      return { error: "Could not verify your account. Try again." };
    }

    let upstream: Response;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1200,
          temperature: 0.3,
          system: data.systemPrompt,
          messages: [
            {
              role: "user",
              content: `Here are this runner's verified numbers. Write next week's training.\n\n${JSON.stringify(data.context)}`,
            },
          ],
        }),
      });
    } catch {
      return { error: "Could not reach the coach. Try again." };
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("[coach] anthropic", upstream.status, detail.slice(0, 400));
      return {
        error:
          upstream.status === 429
            ? "The coach is busy. Try again in a minute."
            : "The coach couldn't answer just now.",
      };
    }

    const payload = (await upstream.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (payload.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

    // The prompt forbids fences; models add them anyway often enough to matter.
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    try {
      return { week: JSON.parse(cleaned) };
    } catch {
      console.error("[coach] unparseable", cleaned.slice(0, 300));
      return { error: "The coach returned something unreadable. Try again." };
    }
  });
