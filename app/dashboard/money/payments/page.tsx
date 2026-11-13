"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowRight, CheckCircle2, Coins, Copy, CreditCard, ExternalLink, Landmark, Link2, Loader2, RefreshCw, ShieldCheck, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useMoney } from "@/components/money/money-provider";
import { fmtShortDate, isOnline, methodsOf, money, moneyRound } from "@/components/money/format";
import { PAID_VIA_LABEL, payableParts, type PayMethod } from "@/lib/ledger";
import { cn } from "@/lib/utils";

const METHOD_INFO: Record<PayMethod, { title: string; body: string; icon: any }> = {
  debit: { title: "Debit card", body: "Visa and Mastercard debit, straight from your client's bank account.", icon: Landmark },
  credit: { title: "Credit card", body: "Visa, Mastercard, Amex and more, including Apple Pay and Google Pay where available.", icon: CreditCard },
  crypto: { title: "Crypto (USDC)", body: "Your client pays a USD stablecoin from their wallet. It shows as paid once the network confirms it.", icon: Coins },
};

export default function PaymentsPage() {
  const { L, canLink, payStatus, links, copy, payUrl, refresh } = useMoney();
  const [refreshing, setRefreshing] = React.useState(false);

  const online = L.invoices
    .flatMap((i) => payableParts(i).filter((m) => m.status === "Paid" && isOnline(m.paidVia)).map((m) => ({ invoice: i, part: m })))
    .sort((a, b) => (b.part.paidOn ?? "").localeCompare(a.part.paidOn ?? ""));
  const onlineTotal = online.reduce((n, x) => n + x.part.amount, 0);
  const byMethod = (m: PayMethod) => online.filter((x) => x.part.paidVia === m).reduce((n, x) => n + x.part.amount, 0);
  const accepting = (m: PayMethod) => L.invoices.filter((i) => i.status !== "Paid" && methodsOf(i).includes(m)).length;
  const active = links
    .map((l) => ({ link: l, invoice: L.invoices.find((i) => i.id === l.invoiceId) }))
    .filter((x) => x.invoice)
    .sort((a, b) => b.link.remaining - a.link.remaining);
  const methodOn = (m: PayMethod) => !!payStatus?.live && (m !== "crypto" || payStatus.cryptoLive);

  return (
    <div className="space-y-6">
      {/* Status */}
      <Card className="overflow-hidden">
        <CardContent className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", payStatus?.live ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
                <span className={cn("size-1.5 rounded-full", payStatus?.live ? "bg-success" : "bg-warning")} />
                {!canLink ? "Demo mode" : payStatus === null ? "Checking…" : payStatus.live ? "Online payments on" : "Online payments off"}
              </span>
            </div>
            <h2 className="mt-2 text-xl font-bold tracking-tight">Get paid through Autopilot</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {!canLink
                ? "Pay links need the server, so they're off in this demo. Invoices and manual payment tracking still work."
                : payStatus?.live
                  ? "Every invoice gets a secure pay link. Clients pay by card or crypto on Stripe's hosted checkout, and each payment lands in Money automatically."
                  : "Pay links already show clients the invoice and milestones. Card and crypto payment switch on once Stripe is connected; until then nothing is charged."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="gradient" asChild><Link href="/dashboard/money/invoices/new">New invoice</Link></Button>
            {canLink && (
              <Button variant="outline" size="icon" aria-label="Refresh payments" disabled={refreshing} onClick={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }}>
                {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </Button>
            )}
          </div>
        </CardContent>
        <div className="grid grid-cols-3 divide-x border-t bg-muted/20">
          <Stat label="Received online" value={moneyRound(onlineTotal)} />
          <Stat label="Payments" value={String(online.length)} />
          <Stat label="Open pay links" value={String(active.filter((x) => x.link.remaining > 0).length)} />
        </div>
      </Card>

      {/* Methods */}
      <section aria-labelledby="methods">
        <p id="methods" className="mb-3 text-sm font-semibold">How your clients can pay</p>
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(METHOD_INFO) as PayMethod[]).map((m) => {
            const info = METHOD_INFO[m];
            const on = methodOn(m);
            return (
              <Card key={m}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className={cn("flex size-10 items-center justify-center rounded-xl text-white", m === "crypto" ? "bg-gradient-to-br from-fuchsia-500 to-cyan-400" : "bg-gradient-to-br from-primary to-purple-500")}><info.icon className="size-5" /></span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", on ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{on ? "Live" : "Not switched on"}</span>
                  </div>
                  <p className="mt-3 font-semibold">{info.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{info.body}</p>
                  <div className="mt-3 flex justify-between border-t pt-3 text-xs">
                    <span className="text-muted-foreground">{accepting(m)} open invoice{accepting(m) === 1 ? "" : "s"} accept it</span>
                    <span className="font-semibold">{moneyRound(byMethod(m))}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="mt-px size-3.5 shrink-0" />Card and wallet details are entered on Stripe&apos;s checkout. Autopilot never sees card numbers or wallet keys.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Links */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="mb-3 flex items-center gap-2 font-semibold"><Link2 className="size-4 text-primary" /> Pay links</p>
            {!canLink ? <p className="text-sm text-muted-foreground">Off in this demo.</p> : active.length === 0 ? (
              <div className="rounded-xl bg-muted/30 py-8 text-center text-sm text-muted-foreground">
                No pay links yet. Create an invoice and choose <span className="font-medium text-foreground">Create &amp; send</span>.
              </div>
            ) : (
              <ul className="space-y-2">
                {active.map(({ link, invoice }) => (
                  <li key={link.invoiceId} className="rounded-xl border p-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/dashboard/money/invoices/${invoice!.id}`} className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{invoice!.client}</p>
                        <p className="text-[11px] text-muted-foreground">{invoice!.number} · {money(link.paid)} of {money(link.total)}</p>
                      </Link>
                      {link.remaining <= 0 ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success"><CheckCircle2 className="size-3.5" />Paid</span> : (
                        <>
                          <Button size="icon" variant="ghost" className="size-8" aria-label="Copy pay link" onClick={() => copy(payUrl(link.token), "Pay link copied")}><Copy className="size-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="size-8" asChild><a href={payUrl(link.token)} target="_blank" rel="noreferrer" aria-label="Open pay page"><ExternalLink className="size-3.5" /></a></Button>
                        </>
                      )}
                    </div>
                    <Progress value={(link.paid / Math.max(link.total, 0.01)) * 100} className="mt-2 h-1.5" />
                    {link.extraPayments > 0 && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning"><AlertCircle className="mt-px size-3.5 shrink-0" />Paid twice: refund the duplicate from Stripe.</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Received */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="mb-3 font-semibold">Received online</p>
            {online.length === 0 ? <p className="rounded-xl bg-muted/30 py-8 text-center text-sm text-muted-foreground">Payments your clients make through pay links show up here.</p> : (
              <ul className="divide-y">
                {online.slice(0, 12).map(({ invoice, part }) => (
                  <li key={`${invoice.id}-${part.id}`} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">{part.paidVia === "crypto" ? <Coins className="size-4" /> : <CreditCard className="size-4" />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{invoice.client} · {part.title}</p><p className="text-[11px] text-muted-foreground">{fmtShortDate(part.paidOn)} · {PAID_VIA_LABEL[part.paidVia!]}</p></div>
                    <p className="text-sm font-semibold text-success">+{money(part.amount)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Next steps for the money */}
      <section className="grid gap-3 sm:grid-cols-2">
        <NextCard href="/dashboard/banking" icon={Landmark} title="Cash out" body="Send what you've earned to your bank or crypto wallet from Banking." />
        <NextCard href="/dashboard/capital" icon={Zap} title="Don't wait to get paid" body="Get an early payment on a confirmed order and repay when the marketplace pays you." />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-3 text-center sm:px-5">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-lg font-bold">{value}</p>
    </div>
  );
}

function NextCard({ href, icon: Icon, title, body }: { href: string; icon: any; title: string; body: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-primary/5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground">{body}</span></span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
