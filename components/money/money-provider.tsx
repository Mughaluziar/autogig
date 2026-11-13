"use client";
import * as React from "react";
import { AlertCircle, Copy, ExternalLink, Loader2, Mail, Send } from "lucide-react";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { DEMO_MODE } from "@/lib/auth";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAID_VIA_LABEL, PAY_METHODS, payLinkSnapshot, todayStr, useLedger,
  type Invoice, type Ledger, type PayLinkView,
} from "@/lib/ledger";
import { detailOf, methodsOf, money } from "./format";

/** Pay links live on the server: off in the frontend-only demo. */
export const CAN_LINK = !DEMO_MODE && !!API_URL;

type PayStatus = { live: boolean; cryptoLive: boolean };

type MoneyCtx = {
  L: Ledger;
  canLink: boolean;
  payStatus: PayStatus | null;
  links: PayLinkView[];
  linkBusy: string | null;
  /** Create or refresh the invoice's pay link and open the share sheet. */
  share: (i: Invoice) => Promise<void>;
  /** Create or refresh the link without opening anything; returns the token. */
  ensureLink: (i: Invoice) => Promise<string | null>;
  removeInvoice: (i: Invoice) => void;
  openTxn: (type: "income" | "expense") => void;
  openGoal: () => void;
  copy: (text: string, what?: string) => Promise<boolean>;
  payUrl: (token: string) => string;
  refresh: () => void;
};

const Ctx = React.createContext<MoneyCtx | null>(null);

export function useMoney(): MoneyCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useMoney must be used inside MoneyProvider");
  return ctx;
}

export function MoneyProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const L = useLedger();
  const [payStatus, setPayStatus] = React.useState<PayStatus | null>(null);
  const [links, setLinks] = React.useState<PayLinkView[]>([]);
  const [linkBusy, setLinkBusy] = React.useState<string | null>(null);
  const [shareFor, setShareFor] = React.useState<{ invoiceId: string; url: string; copied: boolean } | null>(null);
  const [txnType, setTxnType] = React.useState<"income" | "expense" | null>(null);
  const [goalOpen, setGoalOpen] = React.useState(false);

  const ledgerRef = React.useRef(L);
  ledgerRef.current = L;
  const toastRef = React.useRef(toast);
  toastRef.current = toast;

  const payUrl = React.useCallback((token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/pay/${token}`, []);

  const copy = React.useCallback(async (text: string, what = "Copied to clipboard") => {
    try {
      await navigator.clipboard.writeText(text);
      toastRef.current({ title: what, variant: "success" });
      return true;
    } catch {
      toastRef.current({ title: "Couldn't copy", description: "Your browser blocked clipboard access. Select the text and copy it by hand." });
      return false;
    }
  }, []);

  // Payments the server confirmed (Stripe webhook) become paid milestones and income here.
  const syncPayments = React.useCallback(async () => {
    if (!CAN_LINK) return;
    const data = await apiGet<{ live: boolean; cryptoLive: boolean; links: PayLinkView[] }>("/api/pay-links");
    if (!data) return;
    setPayStatus({ live: data.live, cryptoLive: data.cryptoLive });
    setLinks(data.links);
    const fresh = ledgerRef.current.applyOnlinePayments(data.links);
    if (fresh.length === 1) {
      const f = fresh[0];
      toastRef.current({ title: "Payment received", description: `${f.invoice.client} paid ${money(f.part.amount)} by ${PAID_VIA_LABEL[f.via]}. Added to your income.`, variant: "success" });
    } else if (fresh.length > 1) {
      toastRef.current({ title: `${fresh.length} payments received`, description: "Added to your income.", variant: "success" });
    }
  }, []);

  React.useEffect(() => {
    if (!CAN_LINK || !L.ready) return;
    syncPayments();
    const timer = setInterval(syncPayments, 60_000);
    window.addEventListener("focus", syncPayments);
    return () => { clearInterval(timer); window.removeEventListener("focus", syncPayments); };
  }, [L.ready, syncPayments]);

  // When an invoice with a pay link changes (a payment marked by hand, an
  // edit), refresh the link so the client always sees, and pays, what's current.
  const pushed = React.useRef<Record<string, string>>({});
  React.useEffect(() => {
    if (!CAN_LINK) return;
    for (const i of L.invoices) {
      if (!i.payToken) continue;
      const body = payLinkSnapshot(i);
      const sig = JSON.stringify(body);
      const prev = pushed.current[i.id];
      pushed.current[i.id] = sig;
      if (prev === undefined || prev === sig) continue;
      apiCall("/api/pay-links", body).then((res) => {
        if (res && res.status !== 200) toastRef.current({ title: "Pay link not updated", description: detailOf(res.data) });
      });
    }
  }, [L.invoices]);

  const ensureLink = React.useCallback(async (i: Invoice): Promise<string | null> => {
    if (!CAN_LINK) {
      toastRef.current({ title: "Pay links need the server", description: "They're off in this demo. You can still track the invoice and mark payments by hand." });
      return null;
    }
    setLinkBusy(i.id);
    const body = payLinkSnapshot(i);
    const res = await apiCall<any>("/api/pay-links", body);
    setLinkBusy(null);
    if (!res) { toastRef.current({ title: "Couldn't reach the server", description: "Try again in a moment." }); return null; }
    if (res.status !== 200 || !res.data?.token) { toastRef.current({ title: "Couldn't create the pay link", description: detailOf(res.data) }); return null; }
    const token: string = res.data.token;
    pushed.current[i.id] = JSON.stringify(body);
    const L2 = ledgerRef.current;
    if (i.payToken !== token || i.status === "Draft") {
      L2.updateInvoice(i.id, { payToken: token, ...(i.status === "Draft" ? { status: "Sent" as const } : {}) });
      if (!i.payToken) L2.logEvent(i.id, "Pay link created", "sent");
    }
    syncPayments();
    return token;
  }, [syncPayments]);

  const share = React.useCallback(async (i: Invoice) => {
    const token = await ensureLink(i);
    if (!token) return;
    const url = payUrl(token);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* the sheet shows the link to copy by hand */ }
    setShareFor({ invoiceId: i.id, url, copied });
  }, [ensureLink, payUrl]);

  const removeInvoice = React.useCallback((i: Invoice) => {
    ledgerRef.current.deleteInvoice(i.id);
    if (CAN_LINK && i.payToken) apiCall(`/api/pay-links/${encodeURIComponent(i.id)}`, undefined, "DELETE");
    toastRef.current({ title: "Invoice deleted", description: i.payToken ? "Its pay link no longer works." : undefined });
  }, []);

  const value: MoneyCtx = {
    L, canLink: CAN_LINK, payStatus, links, linkBusy, share, ensureLink, removeInvoice,
    openTxn: setTxnType, openGoal: () => setGoalOpen(true), copy, payUrl, refresh: syncPayments,
  };

  const shareInvoice = shareFor ? L.invoices.find((x) => x.id === shareFor.invoiceId) : undefined;

  return (
    <Ctx.Provider value={value}>
      {children}
      <TxnDialog type={txnType} onClose={() => setTxnType(null)} L={L} />
      <GoalDialog open={goalOpen} onClose={() => setGoalOpen(false)} L={L} />
      {shareFor && shareInvoice && (
        <ShareDialog
          L={L} invoice={shareInvoice} url={shareFor.url} copied={shareFor.copied} payStatus={payStatus}
          onClose={() => setShareFor(null)} onCopied={() => setShareFor({ ...shareFor, copied: true })}
        />
      )}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Share sheet: copy the link, email it from the app, or preview it    */
/* ------------------------------------------------------------------ */
function ShareDialog({ L, invoice, url, copied, payStatus, onClose, onCopied }: {
  L: Ledger; invoice: Invoice; url: string; copied: boolean; payStatus: PayStatus | null; onClose: () => void; onCopied: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = React.useState(invoice.email ?? "");
  const [message, setMessage] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [emailFallback, setEmailFallback] = React.useState(false);
  const methods = methodsOf(invoice);
  const labels = methods.map((m) => PAY_METHODS.find((x) => x.id === m)!.label.toLowerCase());
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : labels[0];

  const mailto = () => {
    const body = `${message ? `${message}\n\n` : ""}Here's invoice ${invoice.number} for ${money(invoice.amount)}. You can pay it online by ${list}, no account needed:\n${url}\n`;
    return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(`Invoice ${invoice.number}`)}&body=${encodeURIComponent(body)}`;
  };

  const send = async () => {
    const to = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) { toast({ title: "Enter your client's email address" }); return; }
    setSending(true);
    const res = await apiCall<any>(`/api/pay-links/${encodeURIComponent(invoice.id)}/send`, { email: to, message });
    setSending(false);
    if (res?.status === 200) {
      if (!invoice.email) L.updateInvoice(invoice.id, { email: to });
      L.logEvent(invoice.id, `Emailed to ${to}`, "sent");
      toast({ title: "Invoice sent", description: `${to} got an email with the pay link.`, variant: "success" });
      onClose();
      return;
    }
    if (res?.status === 503) { setEmailFallback(true); return; }
    toast({ title: "Email not sent", description: detailOf(res?.data, "Couldn't reach the server. Copy the link instead.") });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Send {invoice.number} to {invoice.client}</DialogTitle>
        <DialogDescription>
          They can see the invoice{invoice.milestones?.length ? " and each milestone" : ""} and pay by {list}, without an account. Payments land in Money automatically.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="share-url">Pay link</Label>
          <div className="flex gap-2">
            <Input id="share-url" readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0" />
            <Button type="button" variant="outline" className="shrink-0" onClick={async () => {
              try { await navigator.clipboard.writeText(url); onCopied(); } catch { toast({ title: "Couldn't copy", description: "Select the link and copy it by hand." }); }
            }}><Copy className="size-4" /> Copy</Button>
          </div>
          {copied && <p className="text-xs text-success">Copied to your clipboard.</p>}
        </div>

        <div className="rounded-xl border bg-muted/30 p-3.5">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Mail className="size-4 text-primary" /> Email it from Autopilot</p>
          <div className="space-y-2">
            <Input type="email" aria-label="Client email" placeholder="client@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Textarea rows={2} aria-label="Message (optional)" placeholder="Add a note (optional)" value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
          </div>
          {emailFallback ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Email sending isn&apos;t set up on this server yet.{" "}
              <a className="font-medium text-primary underline-offset-2 hover:underline" href={mailto()}>Open it in your email app</a> instead.
            </p>
          ) : null}
          <Button type="button" variant="gradient" size="sm" className="mt-3 w-full sm:w-auto" disabled={sending} onClick={send}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send invoice
          </Button>
        </div>

        {payStatus && !payStatus.live && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            Online payment isn&apos;t switched on yet. Your client will see the invoice but can&apos;t pay online until Stripe is connected. Nothing is charged.
          </p>
        )}
        {payStatus?.live && !payStatus.cryptoLive && methods.includes("crypto") && (
          <p className="text-xs text-muted-foreground">Crypto payments aren&apos;t switched on yet, so your client will see card options only for now.</p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Preview</a></Button>
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Record income / expense                                             */
/* ------------------------------------------------------------------ */
function TxnDialog({ type, onClose, L }: { type: "income" | "expense" | null; onClose: () => void; L: Ledger }) {
  const { toast } = useToast();
  const blank = (t: "income" | "expense") => ({ amount: "", date: todayStr(), category: (t === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0], party: "", note: "" });
  const [f, setF] = React.useState(blank("income"));
  const [err, setErr] = React.useState<Record<string, string>>({});
  React.useEffect(() => { if (type) { setF(blank(type)); setErr({}); } }, [type]);
  if (!type) return null;

  const save = () => {
    const e: Record<string, string> = {};
    const amt = Number(f.amount);
    if (!f.amount || !Number.isFinite(amt) || amt <= 0) e.amount = "Enter an amount above 0.";
    else if (amt > 10_000_000) e.amount = "That amount looks too large.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = "Pick a date.";
    setErr(e);
    if (Object.keys(e).length) return;
    L.addTxn({ type, amount: Math.round(amt * 100) / 100, date: f.date, category: f.category, party: f.party.trim(), note: f.note.trim() });
    onClose();
    toast({ title: type === "income" ? "Income recorded" : "Expense recorded", variant: "success" });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>{type === "income" ? "Record income" : "Record expense"}</DialogTitle>
        <DialogDescription>{type === "income" ? "Money you received outside a pay link (pay-link payments are added for you)." : "Something you spent on the business, so your profit stays accurate."}</DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 space-y-1.5"><Label htmlFor="t-amt">Amount ($)</Label><Input id="t-amt" type="number" inputMode="decimal" step="0.01" min="0" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-invalid={!!err.amount} />{err.amount && <p role="alert" className="text-xs text-destructive">{err.amount}</p>}</div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="t-date">Date</Label><Input id="t-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-invalid={!!err.date} />{err.date && <p role="alert" className="text-xs text-destructive">{err.date}</p>}</div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="t-cat">Category</Label><Select id="t-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => <option key={c}>{c}</option>)}</Select></div>
          <div className="min-w-0 space-y-1.5"><Label htmlFor="t-party">{type === "income" ? "From" : "Paid to"}</Label><Input id="t-party" placeholder={type === "income" ? "Client name" : "Vendor"} value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="t-note">Note (optional)</Label><Input id="t-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="gradient">Save</Button></DialogFooter>
      </form>
    </Dialog>
  );
}

function GoalDialog({ open, onClose, L }: { open: boolean; onClose: () => void; L: Ledger }) {
  const { toast } = useToast();
  const [val, setVal] = React.useState("");
  React.useEffect(() => { if (open) setVal(L.goal ? String(L.goal) : ""); }, [open, L.goal]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader><DialogTitle>Monthly income goal</DialogTitle><DialogDescription>How much do you want to earn each month? Leave it empty to clear the goal.</DialogDescription></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); const v = Number(val || 0); if (!Number.isFinite(v) || v < 0) return; L.setGoal(v); onClose(); toast({ title: v ? "Goal saved" : "Goal cleared", variant: "success" }); }}>
        <Label htmlFor="goal">Goal ($ per month)</Label>
        <Input id="goal" type="number" inputMode="decimal" min="0" autoFocus className="mt-1.5" value={val} onChange={(e) => setVal(e.target.value)} />
        <DialogFooter className="mt-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="gradient">Save</Button></DialogFooter>
      </form>
    </Dialog>
  );
}
