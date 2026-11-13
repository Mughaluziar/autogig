"use client";
import * as React from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/dashboard/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import type { OrderFilters } from "@/lib/orders-demo";
import { ORDER_STATUSES, VERIFICATION_META, formatMoney, titleCase, type Order, type OrderAccount, type VerificationStatus } from "@/lib/orders";
import { formatDate, formatRelative } from "@/lib/utils";

export const EMPTY_FILTERS: OrderFilters = { q: "", platform: "", account: "", status: "", verification: "", from: "", to: "" };

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const meta = VERIFICATION_META[status] ?? VERIFICATION_META.pending;
  return <Badge variant={meta.variant} title={meta.help}>{meta.label}</Badge>;
}

export function OrdersTable({
  orders, accounts, platforms, filters, onFiltersChange, onSelect,
}: {
  orders: Order[];
  accounts: OrderAccount[];
  platforms: string[];
  filters: OrderFilters;
  onFiltersChange: (f: OrderFilters) => void;
  onSelect: (order: Order) => void;
}) {
  const set = (patch: Partial<OrderFilters>) => onFiltersChange({ ...filters, ...patch });
  const active = Object.values(filters).some(Boolean);
  const accountOptions = filters.platform ? accounts.filter((a) => a.platform === filters.platform) : accounts;

  const columns: Column<Order>[] = [
    {
      key: "externalOrderId", header: "Order ID",
      render: (o) => <span className="font-mono text-xs">{o.externalOrderId ?? <span className="text-muted-foreground">no ID</span>}</span>,
    },
    { key: "platform", header: "Platform", render: (o) => <span className="whitespace-nowrap font-medium">{o.platform}</span> },
    { key: "accountLabel", header: "Account", render: (o) => <span className="whitespace-nowrap text-muted-foreground">{o.accountLabel}</span> },
    { key: "clientName", header: "Client", render: (o) => o.clientName ?? o.clientId ?? <span className="text-muted-foreground">—</span> },
    {
      key: "title", header: "Title",
      render: (o) => o.dataExpired
        ? <span className="text-xs italic text-muted-foreground">Expired, refreshes on next sync</span>
        : <span className="line-clamp-2 min-w-[12rem]">{o.title ?? "—"}</span>,
    },
    { key: "amount", header: "Amount", className: "text-right", render: (o) => <span className="whitespace-nowrap tabular-nums">{formatMoney(o.amount, o.currency)}</span> },
    { key: "status", header: "Status", render: (o) => <StatusBadge status={titleCase(o.status)} /> },
    { key: "orderCreatedAt", header: "Created", render: (o) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(o.orderCreatedAt ?? o.detectedAt)}</span> },
    { key: "verification", header: "Verification", render: (o) => <VerificationBadge status={o.verification.status} /> },
    {
      key: "lastSyncedAt", header: "Last sync",
      render: (o) => <span className="whitespace-nowrap text-muted-foreground" title={o.lastSyncedAt ?? "Never synced with the platform API"}>
        {o.lastSyncedAt ? formatRelative(o.lastSyncedAt) : "—"}
      </span>,
    },
  ];

  return (
    <div className="space-y-3">
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search orders" value={filters.q} onChange={(e) => set({ q: e.target.value })}
            placeholder="Order ID, client or title" className="pl-9" />
        </div>
        <Select aria-label="Platform" value={filters.platform} onChange={(e) => set({ platform: e.target.value, account: "" })}>
          <option value="">All platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select aria-label="Account" value={filters.account} onChange={(e) => set({ account: e.target.value })}>
          <option value="">All accounts</option>
          {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
        <Select aria-label="Order status" value={filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </Select>
        <Select aria-label="Verification" value={filters.verification} onChange={(e) => set({ verification: e.target.value })}>
          <option value="">Any verification</option>
          {(Object.keys(VERIFICATION_META) as VerificationStatus[]).map((v) => <option key={v} value={v}>{VERIFICATION_META[v].label}</option>)}
        </Select>
        <Input aria-label="Created from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        <div className="flex gap-2">
          <Input aria-label="Created to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          {active && (
            <Button variant="ghost" size="icon" aria-label="Clear filters" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </Card>
      <div className="overflow-x-auto">
        <DataTable columns={columns} data={orders} onRowClick={onSelect} />
      </div>
    </div>
  );
}
