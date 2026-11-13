"use client";
import * as React from "react";
import Link from "next/link";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Building2, CreditCard, Landmark, Plus, Send, TrendingUp, Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { usd } from "@/lib/capital";
import { TRANSFER_LABEL, useBankingOverview, type Transfer } from "@/lib/banking";
import { shortDate } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { Figure, Frame, Loading, StatusPill } from "@/components/marketplace/common";
import { bankingLinks } from "./links";
import { CardCountdown } from "./cards";

export const TRANSFER_ICON: Record<Transfer["kind"], typeof Wallet> = {
  deposit: ArrowDownLeft, withdraw: ArrowUpRight, to_usdc: ArrowLeftRight, to_usd: ArrowLeftRight, crypto_send: Send,
};

export function TransferRow({ t }: { t: Transfer }) {
  const Icon = TRANSFER_ICON[t.kind];
  const incoming = t.kind === "deposit";
  const outgoing = t.kind === "withdraw" || t.kind === "crypto_send";
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full",
        incoming ? "bg-success/15 text-success" : outgoing ? "bg-muted text-foreground" : "bg-primary/10 text-primary")}><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{TRANSFER_LABEL[t.kind]}</p>
        <p className="truncate text-xs text-muted-foreground">
          {shortDate(t.createdAt)}{t.bankLabel ? ` · ${t.bankLabel}` : ""}{t.address ? ` · ${t.address.slice(0, 8)}…${t.address.slice(-4)}` : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("text-sm font-semibold tabular-nums", incoming && "text-success", t.status === "failed" && "text-muted-foreground line-through")}>
          {incoming ? "+" : outgoing ? "−" : ""}{usd(t.amountCents)}{t.kind === "to_usd" || t.kind === "crypto_send" ? " USDC" : ""}
        </p>
        {t.status === "failed" && <StatusPill status="cancelled" />}
      </div>
    </li>
  );
}

export function BankingOverviewView({ base, marketBase, full }: { base: string; marketBase: string; full: boolean }) {
  const { data, loaded } = useBankingOverview();
  return (
    <Frame kind="banking" links={bankingLinks(base, { full })} title="Banking"
      description="Your Autopilot balances in dollars and USDC, linked bank accounts, transfers and statements, in one place."
      actions={<Button variant="gradient" asChild><Link href={`${base}/transfers?kind=deposit`}><Plus /> Add money</Link></Button>}>
      {!loaded ? <Loading /> : !data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load banking. Refresh to try again.</p>
      ) : (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/25 via-fuchsia-500/10 to-transparent p-5 sm:p-6">
            <div className="absolute -right-20 -top-20 size-64 rounded-full bg-primary/20 blur-3xl" aria-hidden />
            <p className="relative text-sm text-muted-foreground">Available balance</p>
            <p className="relative mt-1 text-4xl font-extrabold tabular-nums tracking-tight sm:text-5xl">
              {usd(data.balances.usdCents + data.balances.usdcCents)}
            </p>
            <div className="relative mt-4 grid grid-cols-2 gap-4 sm:max-w-md">
              <Figure label="US dollars" value={usd(data.balances.usdCents)} />
              <Figure label="USDC" value={usd(data.balances.usdcCents)} hint={data.limits.network} />
            </div>
            <div className="relative mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button asChild><Link href={`${base}/transfers?kind=deposit`}><ArrowDownLeft /> Add</Link></Button>
              <Button variant="outline" asChild><Link href={`${base}/transfers?kind=withdraw`}><ArrowUpRight /> Withdraw</Link></Button>
              <Button variant="outline" asChild><Link href={`${base}/transfers?kind=to_usdc`}><ArrowLeftRight /> Convert</Link></Button>
              <Button variant="outline" asChild><Link href={`${base}/transfers?kind=crypto_send`}><Send /> Send USDC</Link></Button>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link href={marketBase === "" ? "#" : `${marketBase}/portfolio`} className="panel p-4 transition-colors hover:border-primary/50">
              <Figure label="Invested in raises" value={usd(data.marketplace.investedCents)} hint={`${usd(data.marketplace.distributedCents)} received`} />
            </Link>
            <div className="panel p-4"><Figure label="Early-payment pool" value={usd(data.pool.valueCents)} /></div>
            <div className="panel p-4"><Figure label="In escrow" value={usd(data.marketplace.escrowCents)} hint="Waiting for raises to close" /></div>
            <Link href={`${base}/accounts`} className="panel p-4 transition-colors hover:border-primary/50">
              <Figure label="Linked banks" value={String(data.accounts.length)}
                hint={data.accounts.filter((a) => a.status === "pending").length ? "Verification pending" : data.accounts.length ? "All verified" : "Link one to add money"} />
            </Link>
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="panel min-w-0 p-0">
              <div className="flex items-center justify-between border-b px-5 py-4">
                <h3 className="font-semibold">Recent activity</h3>
                <Link href={`${base}/statements`} className="text-xs font-medium text-primary hover:underline">Statements</Link>
              </div>
              {data.transfers.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  <Wallet className="mx-auto mb-2 size-6" />
                  {data.accounts.length === 0
                    ? <>No activity yet. <Link href={`${base}/accounts`} className="font-medium text-primary">Link a bank account</Link> to add money.</>
                    : "No transfers yet. Add money to invest, repay or convert to USDC."}
                </div>
              ) : (
                <ul className="divide-y">{data.transfers.slice(0, 8).map((t) => <TransferRow key={t.id} t={t} />)}</ul>
              )}
            </section>

            <div className="min-w-0 space-y-4">
              {full && (
                <>
                  <Link href={`${base}/cards`} className="group block overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-900 via-purple-900 to-fuchsia-800 p-5 text-white">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-2 font-semibold"><CreditCard className="size-4" /> Autopilot Cards</p>
                      <span className="text-xs text-white/70 group-hover:text-white">Reserve →</span>
                    </div>
                    <p className="mt-1 text-xs text-white/70">Debit and credit cards built for gig income. Waitlist members first.</p>
                    <div className="mt-4"><CardCountdown compact onDark /></div>
                  </Link>
                  <Link href={`${base}/financing`} className="panel block p-5 transition-colors hover:border-primary/50">
                    <p className="flex items-center gap-2 font-semibold"><Building2 className="size-4 text-primary" /> Up to $250,000 in business financing</p>
                    <p className="mt-1 text-xs text-muted-foreground">Funding based on your verified business performance. Through licensed partners, subject to approval.</p>
                    <p className="mt-3 text-sm font-medium text-primary">
                      {data.applications.find((a) => ["submitted", "in_review"].includes(a.status)) ? "Application in review →" : "See my estimate →"}
                    </p>
                  </Link>
                </>
              )}
              <Link href={marketBase || "#"} className="panel block p-5 transition-colors hover:border-primary/50">
                <p className="flex items-center gap-2 font-semibold"><TrendingUp className="size-4 text-primary" /> Put your balance to work</p>
                <p className="mt-1 text-xs text-muted-foreground">Back verified freelancers and agencies, or the whole platform through the Index.</p>
              </Link>
              <div className="flex items-start gap-2 rounded-xl border bg-card/50 p-4 text-xs text-muted-foreground">
                <Landmark className="mt-0.5 size-4 shrink-0 text-primary" />
                We keep only your routing number and the last four digits of your account number. Link only accounts in your
                own name.
              </div>
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
}
