"use client";
/**
 * Pops up when a new order arrives, offering insurance while its window
 * (the first 24 hours) is open. Orders that can't be insured, such as Fiverr
 * orders detected by email, get the same prompt with the reasons instead.
 *
 * "Not now" hides an offer for the rest of the browser session; "No thanks"
 * dismisses it on the server. Either way cover can still be bought from the capital
 * page until the window closes.
 */
import * as React from "react";
import Link from "next/link";
import { Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CoverForm } from "@/components/capital/protection-panel";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeLeft, usd, type CoverOffer } from "@/lib/capital";

const POLL_MS = 60_000;
const SNOOZE_KEY = "cover-offer-snoozed";

function readSnoozed(): ReadonlySet<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SNOOZE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function CoverOfferPrompt() {
  const { user } = useAuth();
  const [offers, setOffers] = React.useState<CoverOffer[]>([]);
  const [snoozed, setSnoozed] = React.useState<ReadonlySet<string>>(readSnoozed);
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    const rows = await apiGet<CoverOffer[]>("/api/capital/coverages/offers");
    if (rows) setOffers(rows);
    setNow(Date.now());
  }, []);

  // Polls the backend: new orders arrive from the scheduler and inbound
  // email, with no push channel to the browser.
  React.useEffect(() => {
    // Simulated module: skip it entirely for accounts the server has not invited (it would only answer 403).
    if (!API_URL || !user || user.modules?.simulated === false) return;
    void load();
    const visible = () => document.visibilityState === "visible";
    const timer = window.setInterval(() => visible() && void load(), POLL_MS);
    const onShow = () => visible() && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [user, load]);

  const offer = offers.find((o) => !snoozed.has(o.order.id) && Date.parse(o.closesAt) > now);
  if (!offer) return null;

  const snooze = () => {
    const next = new Set(snoozed).add(offer.order.id);
    setSnoozed(next);
    try {
      sessionStorage.setItem(SNOOZE_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* storage blocked: the snooze lasts until the next page load */
    }
  };
  const dismiss = async () => {
    snooze();
    await apiCall(`/api/capital/coverages/offers/${encodeURIComponent(offer.order.id)}/dismiss`);
  };
  const done = () => {
    snooze();
    void load();
  };

  const { order } = offer;
  const name = order.title ?? order.externalOrderId ?? "New order";
  const value = order.amount != null ? ` · ${order.currency ?? ""} ${order.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
  const left = timeLeft(offer.closesAt, now);

  return (
    <Dialog open onOpenChange={(v) => !v && snooze()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-6">
          {offer.eligible ? <ShieldCheck className="size-5 text-primary" /> : <ShieldAlert className="size-5 text-muted-foreground" />}
          New {order.platform} order{offer.eligible ? ": insure it?" : ""}
        </DialogTitle>
        <DialogDescription>{name}{value}</DialogDescription>
      </DialogHeader>

      {offer.eligible ? (
        <>
          <p className="mb-3 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <span>You can insure this order for <strong>{left}</strong> more. After that, insurance can&apos;t be added.</span>
          </p>
          {offer.identityVerified ? (
            <CoverForm
              key={order.id}
              orderId={order.id}
              platform={order.platform}
              maxCents={offer.maxCoverCents}
              premiumBps={offer.premiumBps}
              termDays={offer.termDays}
              onDone={done}
              secondary={
                <>
                  <Button variant="ghost" onClick={() => void dismiss()}>No thanks</Button>
                  <Button variant="outline" onClick={snooze}>Not now</Button>
                </>
              }
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Up to {usd(offer.maxCoverCents)} of insurance for {usd(offer.premiumCents)}. Verify your identity first; an operator
                reviews it, so start soon to finish inside the window.
              </p>
              <DialogFooter className="flex-wrap">
                <Button variant="ghost" onClick={() => void dismiss()}>No thanks</Button>
                <Button asChild onClick={snooze}><Link href="/dashboard/capital">Verify identity</Link></Button>
              </DialogFooter>
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">This order can&apos;t be insured:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {offer.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <DialogFooter>
            <Button onClick={() => void dismiss()}>Got it</Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
