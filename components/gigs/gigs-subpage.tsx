"use client";
import * as React from "react";
import { BidScoreboard, GigsNav } from "./gigs-market";

/** Header for the Gigs sub-pages: the marketplace look, compact. */
export function GigsSubpage({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/15 via-fuchsia-500/[0.07] to-cyan-500/10 p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Gigs</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
          </div>
          <BidScoreboard />
        </div>
      </section>
      <GigsNav />
      {children}
    </div>
  );
}
