/** Session-storage handoff between signup and /verify-email. */
export const VERIFICATION_KEY = "autopilot-verification";

export type VerificationInfo = {
  required?: boolean;
  sent?: boolean;
  devCode?: string;
  detail?: string;
  retryAfterSeconds?: number;
  /** When the code was issued (ms). */
  at?: number;
};
