/** Session-storage handoff between signup and /verify-email. */
export const VERIFICATION_KEY = "autopilot-verification";
/** Set when the new account linked an Upwork profile: /verify-email then offers the real Upwork connection. */
export const UPWORK_PROMPT_KEY = "autopilot-upwork-prompt";

export type VerificationInfo = {
  required?: boolean;
  sent?: boolean;
  devCode?: string;
  detail?: string;
  retryAfterSeconds?: number;
  /** When the code was issued (ms). */
  at?: number;
};
