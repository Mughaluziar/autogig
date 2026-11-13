"use client";
import type { ReactNode } from "react";
import { CheckCircle2, CircleSlash, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DETECTION_LABELS, type CapabilityReport } from "@/lib/orders";

function Yes({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${ok ? "" : "text-muted-foreground"}`}>
      {ok ? <CheckCircle2 className="size-3.5 text-success" /> : <CircleSlash className="size-3.5" />}
      {children}
    </span>
  );
}

export function CoveragePanel({ report }: { report: CapabilityReport }) {
  return (
    <div className="space-y-4">
      {!report.scheduler && (
        <Card>
          <CardContent className="flex gap-2 p-4 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              The background worker isn&apos;t configured (no <code>REDIS_URL</code>), so accounts aren&apos;t polled on a schedule
              and failed checks aren&apos;t retried automatically. Emails are still detected as they arrive, and you can
              use <em>Sync now</em> and <em>Verify now</em> by hand.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-3">
        {report.platforms.map((p) => (
          <Card key={p.platform}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                {p.platform}
                <Badge variant={p.verification === "api" ? (p.apiEnabled ? "success" : "warning") : "secondary"}>
                  {p.verification === "api" ? (p.apiEnabled ? "Verifiable" : "Approval pending") : "Not verifiable"}
                </Badge>
              </CardTitle>
              <CardDescription>
                Detection: {p.detection.map((d) => DETECTION_LABELS[d] ?? d).join(", ") || "none"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-col gap-1">
                <Yes ok={p.canConnectApi}>API connection {p.canConnectApi ? "available" : p.integrationId ? "not enabled here" : "not offered by the platform"}</Yes>
                <Yes ok={p.statusSync && p.apiEnabled}>Status sync (cancellations, completion, refunds)</Yes>
                <Yes ok={p.emailReady}>Notification email {p.emailReady ? "enabled" : p.emailDomains.length ? "not enabled here" : "not supported"}</Yes>
              </div>
              {p.maxCacheHours != null && (
                <p className="text-xs text-muted-foreground">Platform terms: API data is kept at most {p.maxCacheHours}h without a refresh.</p>
              )}
              {p.emailDomains.length > 0 && !p.emailParserValidated && (
                <p className="text-xs text-muted-foreground">Email parsing hasn&apos;t been checked against real notification samples yet.</p>
              )}
              {p.limitations.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {p.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {report.unsupported.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Platforms without order tracking</CardTitle>
            <CardDescription>Track these orders on the platform itself.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {report.unsupported.map((u) => (
                <div key={u.platform} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
                  <dt className="font-medium">{u.platform}</dt>
                  <dd className="text-muted-foreground">{u.reason}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
