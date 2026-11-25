"use client";
import * as React from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, CheckCheck, Loader2, MessageSquarePlus, RefreshCw, Search, Send } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadState } from "@/components/shared/load-state";
import {
  fetchThreadOptions, MAX_MESSAGE, newClientId, startConversation, useConversation, useThreads,
  type Message, type Thread, type ThreadOption,
} from "@/lib/messages";
import { cn, formatDate, formatRelative } from "@/lib/utils";

export type InboxSide = "freelancer" | "agency";

const STATUS: Record<string, string> = {
  open: "open for bids", awarded: "awarded", closed: "closed", submitted: "submitted", rejected: "not selected",
  withdrawn: "withdrawn", active: "active", completed: "completed",
};
const label = (s: string | null | undefined) => (s ? STATUS[s] ?? s : "");

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return formatDate(d);
}

/**
 * The messages inbox: thread list on the left, the open conversation on the right (one at a time on a phone).
 * The parent owns which thread is open, so it can live in the URL.
 */
export function Inbox({ side, selectedId, onSelect }: { side: InboxSide; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { threads, loading, error, reload } = useThreads();
  const [query, setQuery] = React.useState("");
  const [composing, setComposing] = React.useState(false);
  const shown = (threads ?? []).filter((t) => {
    const q = query.trim().toLowerCase();
    return !q || t.title.toLowerCase().includes(q) || t.counterpart.name.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden rounded-xl border bg-card">
      {/* Thread list */}
      <aside className={cn("w-full flex-col border-r lg:flex lg:w-80 lg:shrink-0", selectedId ? "hidden" : "flex")} aria-label="Conversations">
        <div className="flex items-center gap-2 border-b p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search conversations" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 pl-8" />
          </div>
          <Button size="sm" variant="gradient" onClick={() => setComposing(true)} aria-label="New message" data-testid="new-message">
            <MessageSquarePlus className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-3"><LoadState loading={loading} error={error} onRetry={reload} /></div>
          {threads && !threads.length && (
            <div className="p-4">
              <EmptyState title="No conversations yet" description={side === "freelancer"
                ? "Ask an agency about an open spec, or talk about a bid or contract. Start with New message."
                : "Message a freelancer who bid on one of your specs or holds your contract. Start with New message."}
                action={<Button size="sm" variant="outline" onClick={() => setComposing(true)}><MessageSquarePlus className="size-4" /> New message</Button>} />
            </div>
          )}
          {threads && threads.length > 0 && !shown.length && <p className="p-4 text-sm text-muted-foreground">No conversation matches &ldquo;{query}&rdquo;.</p>}
          <ul className="divide-y" data-testid="thread-list">
            {shown.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onSelect(t.id)} aria-current={t.id === selectedId ? "true" : undefined}
                  className={cn("flex w-full gap-3 p-3 text-left transition-colors hover:bg-accent/60", t.id === selectedId && "bg-primary/10")}>
                  <Avatar name={t.counterpart.name || "?"} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", t.unread ? "font-semibold" : "font-medium")}>{t.counterpart.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{t.lastMessageAt ? formatRelative(t.lastMessageAt) : ""}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{t.title}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={cn("flex-1 truncate text-xs", t.unread ? "text-foreground" : "text-muted-foreground")}>
                        {t.lastPreview ? `${t.lastFromMe ? "You: " : ""}${t.lastPreview}` : t.lastMessageAt ? "Message removed" : "No messages yet"}
                      </span>
                      {t.unread > 0 && <Badge variant="destructive" className="h-5 px-1.5" aria-label={`${t.unread} unread`}>{t.unread}</Badge>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Conversation */}
      <section className={cn("min-w-0 flex-1 flex-col lg:flex", selectedId ? "flex" : "hidden")} aria-label="Conversation">
        {selectedId ? (
          <Conversation key={selectedId} side={side} threadId={selectedId} onBack={() => onSelect(null)} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState title="Select a conversation" description="Pick a conversation on the left, or start a new one." />
          </div>
        )}
      </section>

      <NewMessageDialog side={side} open={composing} onOpenChange={setComposing}
        onStarted={(id) => { setComposing(false); onSelect(id); void reload(); }} />
    </div>
  );
}

function ContextLine({ side, thread }: { side: InboxSide; thread: Thread }) {
  const c = thread.context;
  if (!c) return null;
  const contractsHref = side === "freelancer" ? "/freelancer/contracts" : "/dashboard/pool?tab=contracts";
  const parts: React.ReactNode[] = [];
  if (c.contractStatus) parts.push(<Link key="c" href={contractsHref} className="font-medium text-primary hover:underline">Contract {label(c.contractStatus)}</Link>);
  else if (c.bidStatus) parts.push(<span key="b">{side === "freelancer" ? "Your bid" : "Their bid"}: {label(c.bidStatus)}</span>);
  if (c.specStatus && !c.contractStatus) parts.push(<span key="s">Spec {label(c.specStatus)}</span>);
  return <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <span aria-hidden>·</span>}{p}</React.Fragment>)}</p>;
}

function Conversation({ side, threadId, onBack }: { side: InboxSide; threadId: string; onBack: () => void }) {
  const convo = useConversation(threadId);
  const { thread, messages } = convo;
  const [draft, setDraft] = React.useState("");
  const scroller = React.useRef<HTMLDivElement>(null);
  const keepOffset = React.useRef<number | null>(null);
  const stickToBottom = React.useRef(true);

  // Stay at the bottom when new messages arrive (unless you scrolled up to read); keep your place when older ones load.
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stickToBottom.current || messages[messages.length - 1]?.pending) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const older = () => {
    const el = scroller.current;
    if (el) keepOffset.current = el.scrollHeight - el.scrollTop;
    void convo.loadOlder();
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.trim() || draft.length > MAX_MESSAGE) return;
    convo.send(draft);
    setDraft("");
    stickToBottom.current = true;
  };

  // "Seen" goes under your newest message the other person has read.
  const seenSeq = thread?.theirReadSeq ?? 0;
  const lastSeen = [...messages].reverse().find((m) => m.fromMe && !m.pending && !m.failed && m.seq <= seenSeq)?.id;
  const canSend = thread?.canSend !== false;

  return (
    <>
      <header className="flex items-center gap-3 border-b p-3">
        <Button size="sm" variant="ghost" className="lg:hidden" onClick={onBack} aria-label="Back to conversations"><ArrowLeft className="size-4" /></Button>
        {thread ? (
          <>
            <Avatar name={thread.counterpart.name || "?"} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{thread.counterpart.name} <span className="font-normal text-muted-foreground">· {thread.counterpart.role === "agency" ? "Agency" : "Freelancer"}</span></p>
              <p className="truncate text-xs text-muted-foreground">{thread.title}</p>
              <ContextLine side={side} thread={thread} />
            </div>
          </>
        ) : <div className="flex-1" />}
      </header>

      <div ref={scroller} onScroll={onScroll} className="flex-1 space-y-1 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Messages" data-testid="message-log">
        {convo.error && (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <AlertCircle className="size-6 text-warning" />{convo.error}
            <Button size="sm" variant="outline" onClick={() => void convo.reload()}><RefreshCw className="size-4" /> Try again</Button>
          </div>
        )}
        {!thread && !convo.error && <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>}
        {thread && convo.hasOlder && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="ghost" disabled={convo.loadingOlder} onClick={older}>
              {convo.loadingOlder && <Loader2 className="size-4 animate-spin" />} Load earlier messages
            </Button>
          </div>
        )}
        {thread && !messages.length && !convo.loading && (
          <p className="py-10 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || day(prev.createdAt) !== day(m.createdAt);
          return (
            <React.Fragment key={m.id}>
              {newDay && <p className="py-2 text-center text-[11px] font-medium text-muted-foreground">{day(m.createdAt)}</p>}
              <Bubble m={m} seen={m.id === lastSeen} onRetry={() => convo.retry(m)} onDiscard={() => convo.discard(m)} />
            </React.Fragment>
          );
        })}
      </div>

      <form onSubmit={submit} className="border-t p-3">
        {thread && !canSend ? (
          <p className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground"><AlertCircle className="size-4 shrink-0" />{thread.cannotSendReason || "This conversation is closed."}</p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <Textarea aria-label="Message" placeholder="Write a message…" rows={2} value={draft} disabled={!thread}
                className="max-h-40 min-h-[44px] flex-1 resize-none" data-testid="message-input"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
              <Button type="submit" variant="gradient" disabled={!thread || !draft.trim() || draft.length > MAX_MESSAGE} aria-label="Send message" data-testid="message-send">
                <Send className="size-4" />
              </Button>
            </div>
            <p className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Enter to send · Shift+Enter for a new line</span>
              {draft.length > MAX_MESSAGE - 500 && <span className={cn(draft.length > MAX_MESSAGE && "text-destructive")}>{draft.length}/{MAX_MESSAGE}</span>}
            </p>
          </>
        )}
      </form>
    </>
  );
}

function Bubble({ m, seen, onRetry, onDiscard }: { m: Message; seen: boolean; onRetry: () => void; onDiscard: () => void }) {
  return (
    <div className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
      <div className="max-w-[80%]">
        <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
          m.fromMe ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted",
          m.pending && "opacity-70", m.failed && "bg-destructive/15 text-foreground", m.removed && "italic text-muted-foreground")}>
          {m.removed ? "Message removed: the sender deleted their account." : m.body}
        </div>
        <p className={cn("mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground", m.fromMe && "justify-end")}>
          {m.failed ? (
            <span className="text-destructive">{m.failed} <button type="button" className="font-medium underline" onClick={onRetry}>Retry</button> · <button type="button" className="underline" onClick={onDiscard}>Discard</button></span>
          ) : m.pending ? "Sending…" : (
            <>
              {!m.fromMe && m.senderName && <span>{m.senderName} ·</span>}
              {time(m.createdAt)}
              {m.fromMe && (seen ? <span className="inline-flex items-center gap-0.5"><CheckCheck className="size-3" /> Seen</span> : <Check className="size-3" aria-label="Sent" />)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** "New message": pick what (and, for an agency, who) the conversation is about, then write the first message. */
function NewMessageDialog({ side, open, onOpenChange, onStarted }: {
  side: InboxSide; open: boolean; onOpenChange: (v: boolean) => void; onStarted: (threadId: string) => void;
}) {
  const [options, setOptions] = React.useState<ThreadOption[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [choice, setChoice] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const clientId = React.useRef(newClientId());
  const key = (o: ThreadOption) => `${o.specId}:${o.freelancerId ?? ""}`;

  React.useEffect(() => {
    if (!open) return;
    setOptions(null); setFailed(false); setChoice(""); setText(""); setError(""); clientId.current = newClientId();
    void fetchThreadOptions().then((o) => { if (o) { setOptions(o); setChoice(o[0] ? key(o[0]) : ""); } else setFailed(true); });
  }, [open]);

  const picked = options?.find((o) => key(o) === choice);
  const groups: [ThreadOption["context"], string][] = side === "freelancer"
    ? [["contract", "Your contracts"], ["bid", "Your bids"], ["open", "Open specs"]]
    : [["contract", "Contracts"], ["bid", "Bids on your specs"]];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !text.trim()) return;
    setBusy(true);
    setError("");
    const res = await startConversation({ specId: picked.specId, freelancerId: picked.freelancerId, message: text, clientId: clientId.current });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onStarted(res.threadId!);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>New message</DialogTitle>
        <DialogDescription>{side === "freelancer"
          ? "Write to the agency behind a spec: a question before you bid, or about your bid or contract."
          : "Write to a freelancer who bid on one of your specs or holds one of your contracts."}</DialogDescription>
      </DialogHeader>
      {failed ? <p className="text-sm text-destructive">Couldn&apos;t load who you can message. Close this and try again.</p>
        : !options ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>
          : !options.length ? (
            <p className="text-sm text-muted-foreground">{side === "freelancer"
              ? "There's nobody to message yet: no spec is open for bids and you have no bids or contracts."
              : "There's nobody to message yet: none of your specs has a bid."}</p>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nm-about">{side === "freelancer" ? "About" : "To"}</Label>
                <Select id="nm-about" value={choice} onChange={(e) => { setChoice(e.target.value); clientId.current = newClientId(); }}>
                  {groups.map(([ctx, name]) => {
                    const list = options.filter((o) => o.context === ctx);
                    return list.length ? (
                      <optgroup key={ctx} label={name}>
                        {list.map((o) => <option key={key(o)} value={key(o)}>{side === "agency" ? `${o.freelancerName} · ${o.title}` : o.title}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </Select>
                {picked && <p className="text-xs text-muted-foreground">{picked.detail}{picked.threadId ? " · you already have a conversation about this; the message goes there" : ""}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nm-text">Message</Label>
                <Textarea id="nm-text" rows={4} maxLength={MAX_MESSAGE} value={text} onChange={(e) => { setText(e.target.value); clientId.current = newClientId(); }} required />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" variant="gradient" disabled={busy || !text.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send</Button>
              </DialogFooter>
            </form>
          )}
    </Dialog>
  );
}

/**
 * "Message the agency / freelancer" from somewhere else (a spec, a bid, a contract): writes the first message
 * and hands back the conversation, which the caller usually opens.
 */
export function StartConversationDialog({ target, onClose, onStarted }: {
  target: { specId: string; freelancerId?: string; title: string; to: string } | null;
  onClose: () => void;
  onStarted: (threadId: string) => void;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const clientId = React.useRef(newClientId());
  React.useEffect(() => { setText(""); setError(""); clientId.current = newClientId(); }, [target?.specId, target?.freelancerId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !text.trim()) return;
    setBusy(true);
    setError("");
    const res = await startConversation({ specId: target.specId, freelancerId: target.freelancerId, message: text, clientId: clientId.current });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onStarted(res.threadId!);
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Message {target?.to}</DialogTitle>
        <DialogDescription>About &ldquo;{target?.title}&rdquo;. Replies show up in Messages.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <Textarea aria-label="Message" rows={4} maxLength={MAX_MESSAGE} value={text} onChange={(e) => { setText(e.target.value); clientId.current = newClientId(); }} required autoFocus />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gradient" disabled={busy || !text.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
