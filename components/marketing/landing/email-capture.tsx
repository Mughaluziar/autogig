"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SIGNUP_EMAIL_KEY } from "@/lib/landing";

/**
 * Email-first signup: one field, one button. The email is handed to the
 * signup form so the visitor never types it twice.
 */
export function EmailCapture({ cta = "Start free", id, className, dark, href = "/signup" }: { cta?: string; id: string; className?: string; dark?: boolean; href?: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  return (
    <form
      className={cn("flex w-full max-w-md flex-col gap-2 sm:flex-row", className)}
      onSubmit={(e) => {
        e.preventDefault();
        try { if (email.trim()) sessionStorage.setItem(SIGNUP_EMAIL_KEY, email.trim()); } catch { /* storage blocked */ }
        router.push(href);
      }}
    >
      <label htmlFor={id} className="sr-only">Email address</label>
      <input
        id={id}
        type="email"
        autoComplete="email"
        placeholder="you@work.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={cn(
          "h-12 w-full min-w-0 rounded-lg sm:flex-1 border px-4 text-base outline-none transition focus-visible:ring-2",
          dark
            ? "border-white/30 bg-white/10 text-white placeholder:text-white/60 focus-visible:ring-white/70"
            : "border-input bg-background focus-visible:ring-ring",
        )}
      />
      <Button type="submit" size="xl" variant={dark ? "secondary" : "gradient"} className="shrink-0 px-6" data-cta={`${id}-submit`}>
        {cta} <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}
