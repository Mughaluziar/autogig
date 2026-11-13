"use client";
import * as React from "react";
import { BadgeCheck, CircleDashed, PackageCheck, RefreshCw, ShieldAlert, ShieldQuestion } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountsPanel } from "@/components/dashboard/orders/accounts-panel";
import { CoveragePanel } from "@/components/dashboard/orders/coverage-panel";
import { EventTimeline, OrderDetailDialog } from "@/components/dashboard/orders/order-detail";
import { EMPTY_FILTERS, OrdersTable } from "@/components/dashboard/orders/orders-table";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { DEMO_ACCOUNTS, DEMO_CAPABILITIES, DEMO_EVENTS, filterDemoOrders, type OrderFilters } from "@/lib/orders-demo";
import { formatMoney, type CapabilityReport, type Order, type OrderAccount, type OrderEvent, type OrdersResponse } from "@/lib/orders";

const POLL_MS = 30_000;
const EMPTY_RESPONSE: OrdersResponse = {
  orders: [],
  summary: { total: 0, byVerification: { verified: 0, pending: 0, failed: 0, rejected: 0, unverifiable: 0 }, verifiedValue: {} },
};
const EMPTY_CAPS: CapabilityReport = { platforms: [], unsupported: [], scheduler: false, inboundEmail: false };

function query(f: OrderFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) if (value.trim()) params.set(key, value.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default function OrdersPage() {
  const demo = !API_URL;
  const [filters, setFilters] = React.useState<OrderFilters>(EMPTY_FILTERS);
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [data, setData] = React.useState<OrdersResponse>(demo ? filterDemoOrders(EMPTY_FILTERS) : EMPTY_RESPONSE);
  const [accounts, setAccounts] = React.useState<OrderAccount[]>(demo ? DEMO_ACCOUNTS : []);
  const [caps, setCaps] = React.useState<CapabilityReport>(demo ? DEMO_CAPABILITIES : EMPTY_CAPS);
  const [events, setEvents] = React.useState<OrderEvent[]>(demo ? DEMO_EVENTS : []);
  const [selected, setSelected] = React.useState<Order | null>(null);
  const [loaded, setLoaded] = React.useState(demo);
  const [tick, setTick] = React.useState(0);
  const [tab, setTab] = React.useState("orders");
  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  const { toast } = useToast();


  // Typing in search shouldn't fire a request per keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);
  const effective = React.useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);

  React.useEffect(() => {
    if (demo) {
      setData(filterDemoOrders(effective));
      return;
    }
    let cancelled = false;
    const load = () => apiGet<OrdersResponse>(`/api/orders${query(effective)}`).then((res) => {
      if (cancelled || !res) return;
      setData(res);
      setLoaded(true);
      // Keep an open detail view current with background syncs.
      setSelected((cur) => (cur ? res.orders.find((o) => o.id === cur.id) ?? cur : cur));
    });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [demo, effective, tick]);

  React.useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void Promise.all([
      apiGet<OrderAccount[]>("/api/orders/accounts"),
      apiGet<CapabilityReport>("/api/orders/capabilities"),
      apiGet<OrderEvent[]>("/api/orders/events?limit=100"),
    ]).then(([a, c, e]) => {
      if (cancelled) return;
      if (a) setAccounts(a);
      if (c) setCaps(c);
      if (e) setEvents(e);
    });
    return () => { cancelled = true; };
  }, [demo, tick]);

  const platforms = React.useMemo(
    () => Array.from(new Set([...caps.platforms.map((p) => p.platform), ...accounts.map((a) => a.platform)])).sort(),
    [caps, accounts],
  );
  const s = data.summary.byVerification;
  const value = Object.entries(data.summary.verifiedValue);
  const failing = accounts.filter((a) => a.status === "needs_reauth" || a.lastSyncStatus === "error");

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order from your connected marketplace accounts, in one place. An order counts as verified only when the platform itself confirms it."
        actions={
          <>
            {demo && <Badge variant="secondary">Sample data</Badge>}
            <Button variant="outline" size="sm" onClick={refresh}><RefreshCw /> Refresh</Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Orders" value={String(data.summary.total)} icon={<PackageCheck className="size-4" />} hint="Matching the filters" />
        <StatCard label="Verified" value={String(s.verified)} icon={<BadgeCheck className="size-4" />}
          hint={value.length ? value.map(([cur, amt]) => formatMoney(amt, cur)).join(" · ") : "Confirmed by the platform"} />
        <StatCard label="Pending" value={String(s.pending)} icon={<CircleDashed className="size-4" />} hint="Awaiting confirmation" />
        <StatCard label="Failed / rejected" value={String(s.failed + s.rejected)} icon={<ShieldAlert className="size-4" />} hint="Needs your attention" />
        <StatCard label="Unverifiable" value={String(s.unverifiable)} icon={<ShieldQuestion className="size-4" />} hint="Confirm on the platform" />
      </div>

      {failing.length > 0 && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4 text-sm">
            <span className="font-medium text-destructive">Sync problems: </span>
            {failing.map((a) => `${a.label} (${a.status === "needs_reauth" ? "reconnect needed" : a.lastSyncError ?? "failing"})`).join("; ")}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="accounts">Accounts ({accounts.length})</TabsTrigger>
          <TabsTrigger value="activity">Audit log</TabsTrigger>
          <TabsTrigger value="coverage">Platform coverage</TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          {loaded || demo ? (
            <OrdersTable orders={data.orders} accounts={accounts} platforms={platforms} filters={filters}
              onFiltersChange={setFilters} onSelect={setSelected} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading orders…</p>
          )}
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsPanel accounts={accounts} capabilities={caps.platforms} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="activity">
          <Card><CardContent className="p-4"><EventTimeline events={events} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="coverage">
          <CoveragePanel report={caps} />
        </TabsContent>
      </Tabs>

      <OrderDetailDialog
        order={selected}
        accounts={accounts}
        onClose={() => setSelected(null)}
        onChanged={(o) => { setSelected(o); refresh(); }}
      />
    </>
  );
}
