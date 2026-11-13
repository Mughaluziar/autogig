import { API_URL, apiUrl, fetchWithTimeout } from "@/lib/api";

export type WaitlistProduct = "debit-card" | "credit-card" | "financing" | "investor";
export type WaitlistResult = { ok: true; already: boolean; demo: boolean } | { ok: false; error: string };

export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

/** Join an early-access list. Without a backend (frontend-only demo) nothing is sent, and the result says so. */
export async function joinWaitlist(body: {
  email: string;
  product: WaitlistProduct;
  name?: string;
  answers?: Record<string, unknown>;
}): Promise<WaitlistResult> {
  if (!API_URL) return { ok: true, already: false, demo: true };
  try {
    const res = await fetchWithTimeout(apiUrl("/api/waitlist"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, email: body.email.trim(), consent: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: typeof data.detail === "string" ? data.detail : "Couldn't save that right now. Try again in a moment." };
    }
    const data = await res.json();
    return { ok: true, already: !!data.already, demo: false };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
