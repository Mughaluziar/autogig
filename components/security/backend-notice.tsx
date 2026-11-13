import * as React from "react";
import { Info } from "lucide-react";

/** Shown in the frontend-only demo for features that only exist on the server. */
export function BackendNotice({ feature }: { feature: string }) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">{feature} needs the Autopilot server.</span>{" "}
        This preview runs without one, so nothing here is saved or sent. Sign in to your account to use it.
      </p>
    </div>
  );
}

/** Inline error with a retry, for a failed server load. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      <button onClick={onRetry} className="self-start rounded-md border px-3 py-1.5 font-medium hover:bg-accent sm:self-auto">
        Try again
      </button>
    </div>
  );
}
