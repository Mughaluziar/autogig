"use client";
import * as React from "react";
import Link from "next/link";
import { Sparkles, Zap, Crown, Check } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDemoStore } from "@/lib/demo-store";
import { CREDIT_PACKS } from "@/lib/demo-engine";
import { cn } from "@/lib/utils";

/**
 * Upgrade / top-up dialog shown when free credits run out. It only lets the
 * user choose: payment happens on /checkout, which hands off to Stripe's
 * hosted page (or says checkout isn't live yet). No card details are ever
 * collected here.
 */
export function PaywallDialog({
  open,
  onOpenChange,
  kind,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "bids" | "profiles";
}) {
  const demo = useDemoStore();
  const [choice, setChoice] = React.useState<"pack" | "pro">("pro");
  const pack = CREDIT_PACKS[kind];
  const isPro = demo?.state.monetization.plan === "pro";

  React.useEffect(() => {
    if (open) setChoice("pro");
  }, [open]);

  const href = choice === "pro" ? "/checkout?plan=pro" : `/checkout?pack=${kind}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          {kind === "bids" ? "You're out of job bids" : "You're out of profile slots"}
        </DialogTitle>
        <DialogDescription>
          {kind === "bids"
            ? "Your agents stopped bidding. Top up, or go unlimited and never think about credits again."
            : "Add another marketplace profile, or go unlimited and connect them all."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3" role="radiogroup" aria-label="Choose an option">
        <Option
          active={choice === "pro"}
          onClick={() => setChoice("pro")}
          icon={<Crown className="size-4" />}
          tone="warning"
          title="Pro — unlimited everything"
          sub="Unlimited bids and profiles, priority matching. Free trial on your first plan."
          price={<>$19<span className="text-xs font-normal text-muted-foreground">/mo</span></>}
          badge="Best value"
        />
        <Option
          active={choice === "pack"}
          onClick={() => setChoice("pack")}
          icon={<Zap className="size-4" />}
          tone="primary"
          title={pack.label}
          sub="One-time top-up · never expires"
          price={<>${pack.price}</>}
        />
      </div>
      {choice === "pro" && (
        <ul className="mt-4 grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
          {["Cancel anytime", "All agents unlocked", "Every marketplace", "Priority matching"].map((f) => (
            <li key={f} className="flex items-center gap-1.5"><Check className="size-3.5 text-success" />{f}</li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Maybe later</Button>
        {isPro && choice === "pro" ? (
          <Button variant="gradient" disabled>You&apos;re on Pro</Button>
        ) : (
          <Button variant="gradient" asChild>
            <Link href={href} onClick={() => onOpenChange(false)}>{choice === "pro" ? "Go unlimited" : "Continue"}</Link>
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function Option({ active, onClick, icon, tone, title, sub, price, badge }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; tone: "primary" | "warning";
  title: string; sub: string; price: React.ReactNode; badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "relative flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors",
        active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent/50"
      )}
    >
      {badge && <span className="absolute -top-2 right-3 rounded-full bg-gradient-to-r from-primary to-fuchsia-500 px-2 py-0.5 text-[10px] font-semibold text-white">{badge}</span>}
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn("shrink-0 rounded-lg p-2", tone === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")}>{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </div>
      <span className="shrink-0 font-semibold">{price}</span>
    </button>
  );
}
