import { Coins, CreditCard, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_METHODS, PAY_METHODS, type Invoice, type PayMethod, type PaidVia } from "@/lib/ledger";

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** $1,234.50 — invoices and payments, to the cent. */
export const money = (n: number) => usd2.format(Number.isFinite(n) ? n : 0);
/** $1,235 — headline stats. */
export const moneyRound = (n: number) => usd0.format(Number.isFinite(n) ? n : 0);
/** $12.3K — chart axes. */
export const moneyCompact = (n: number) => compact.format(Number.isFinite(n) ? n : 0);

export const fmtDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const fmtShortDate = (d?: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en", { month: "short", day: "numeric" }) : "—";
export const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (date: string, days: number) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + days); return ymd(d); };
export const daysUntil = (date: string) => Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const newKey = () => Math.random().toString(36).slice(2, 10);

export const isOnline = (via?: PaidVia) => !!via && via !== "manual";
export const methodsOf = (i: Invoice): PayMethod[] => (i.methods?.length ? i.methods : ALL_METHODS);
export const methodIcon = (m: PayMethod) => (m === "crypto" ? Coins : m === "debit" ? Landmark : CreditCard);
export const detailOf = (data: any, fallback = "Check the details and try again.") =>
  (typeof data?.detail === "string" ? data.detail : fallback);

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const STATUS_TONE: Record<string, string> = {
  Paid: "bg-success/15 text-success ring-success/30",
  Sent: "bg-primary/15 text-primary ring-primary/30",
  Overdue: "bg-destructive/15 text-destructive ring-destructive/30",
  Draft: "bg-muted text-muted-foreground ring-border",
  Partial: "bg-warning/15 text-warning ring-warning/30",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", STATUS_TONE[status] ?? STATUS_TONE.Draft, className)}>
      {status}
    </span>
  );
}

export function MethodChips({ methods, className }: { methods: PayMethod[]; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)} aria-label="Accepted payment methods">
      {methods.map((m) => {
        const Icon = methodIcon(m);
        return (
          <span key={m} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            <Icon className="size-3" />{PAY_METHODS.find((x) => x.id === m)?.short}
          </span>
        );
      })}
    </span>
  );
}

/** Client initials in a soft purple tile. */
export function ClientMark({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-fuchsia-500/20 text-sm font-semibold text-primary", className)}>
      {initials(name)}
    </span>
  );
}
