"use client";
import * as React from "react";
import { API_URL, apiCall, apiFetch, hasSessionHint } from "@/lib/api";

/**
 * Messages between a freelancer and an agency (backend/app/routers/pool_messages.py). One thread per spec and
 * freelancer. Everything here talks to the server: there is no demo data, so without a backend the pages say so.
 *
 * Freshness is by polling while the tab is visible: the open conversation asks for anything newer every few
 * seconds, the thread list and the unread badge less often. Sends are optimistic and carry a client id, so a
 * retry after a network error can never store the same message twice.
 */

export type ThreadContext = { specStatus: string | null; bidStatus: string | null; contractId: string | null; contractStatus: string | null };
export type Thread = {
  id: string; specId: string; title: string; counterpart: { name: string; role: "agency" | "freelancer" };
  lastMessageAt: string | null; lastPreview: string; lastFromMe: boolean; unread: number;
  lastSeq: number; myReadSeq: number; theirReadSeq: number; createdAt?: string;
  context?: ThreadContext; canSend?: boolean; cannotSendReason?: string;
};
export type Message = {
  id: string; threadId: string; seq: number; body: string; removed: boolean; fromMe: boolean;
  senderRole: "agency" | "freelancer"; senderName: string; createdAt: string | null; clientId: string | null;
  /** Local only: sent from this tab and not yet confirmed, or the send failed. */
  pending?: boolean; failed?: string;
};
export type ThreadOption = {
  specId: string; title: string; context: "contract" | "bid" | "open"; detail: string; threadId: string | null;
  freelancerId?: string; freelancerName?: string;
};

export const MAX_MESSAGE = 4000;
const CONVERSATION_POLL_MS = 4000;
const LIST_POLL_MS = 15000;
const BADGE_POLL_MS = 60000;
/** Fired after this tab reads or sends, so the unread badge refreshes at once instead of at its next poll. */
export const MESSAGES_CHANGED = "messages:changed";

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
const announce = () => typeof window !== "undefined" && window.dispatchEvent(new Event(MESSAGES_CHANGED));

function errorText(status: number, data: any, fallback: string): string {
  if (typeof data?.detail === "string") return data.detail;
  if (status === 429) return "You're sending messages too quickly. Wait a moment and try again.";
  return fallback;
}

export function newClientId(): string {
  const raw = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `c${raw.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 64);
}

/** Calls `fn` now and then every `ms` while the tab is visible, and again when it becomes visible. */
function usePolling(fn: () => void, ms: number, enabled: boolean) {
  const ref = React.useRef(fn);
  ref.current = fn;
  React.useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (visible()) ref.current(); };
    const timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [ms, enabled]);
}

/** The caller's threads, latest activity first. */
export function useThreads(enabled = true) {
  const [threads, setThreads] = React.useState<Thread[] | null>(null);
  const [error, setError] = React.useState("");
  const on = enabled && Boolean(API_URL);
  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch("/api/pool/threads");
      if (res.ok) { setThreads((await res.json()) as Thread[]); setError(""); }
      else setError(res.status === 403 ? "Your account type can't use messages." : "Couldn't load your conversations. Try again.");
    } catch {
      setError("Can't reach the server. Try again in a moment.");
    }
  }, []);
  React.useEffect(() => { if (on) void load(); }, [on, load]);
  usePolling(load, LIST_POLL_MS, on);
  React.useEffect(() => {
    if (!on) return;
    window.addEventListener(MESSAGES_CHANGED, load);
    return () => window.removeEventListener(MESSAGES_CHANGED, load);
  }, [on, load]);
  return { threads, loading: on && threads === null && !error, error, reload: load };
}

/** Total unread messages, for the navigation badge. 0 while signed out or without a backend. */
export function useUnreadMessages(enabled: boolean): number {
  const [count, setCount] = React.useState(0);
  const on = enabled && Boolean(API_URL);
  const load = React.useCallback(async () => {
    if (!hasSessionHint()) return;
    try {
      const res = await apiFetch("/api/pool/threads/unread");
      if (res.ok) setCount(Number((await res.json()).unread) || 0);
    } catch { /* the badge just keeps its last value */ }
  }, []);
  React.useEffect(() => { if (on) void load(); }, [on, load]);
  usePolling(load, BADGE_POLL_MS, on);
  React.useEffect(() => {
    if (!on) return;
    window.addEventListener(MESSAGES_CHANGED, load);
    return () => window.removeEventListener(MESSAGES_CHANGED, load);
  }, [on, load]);
  return on ? count : 0;
}

type Page = { thread: Thread; messages: Message[]; hasMore: boolean };

/** Confirmed messages in seq order, then this tab's unconfirmed ones. A confirmed message replaces the
 *  optimistic copy that carried the same client id (whether it arrived by the send's answer or by polling). */
function merge(current: Message[], incoming: Message[]): Message[] {
  const arrived = new Set(incoming.map((m) => m.clientId).filter(Boolean));
  const confirmed = new Map<string, Message>();
  for (const m of current) if (!m.pending && !m.failed) confirmed.set(m.id, m);
  for (const m of incoming) confirmed.set(m.id, m);
  const local = current.filter((m) => (m.pending || m.failed) && !(m.clientId && arrived.has(m.clientId)));
  return [...[...confirmed.values()].sort((a, b) => a.seq - b.seq), ...local];
}

/** One conversation: its messages (oldest first), polling for new ones, sending, and read markers. */
export function useConversation(threadId: string | null) {
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [hasOlder, setHasOlder] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [error, setError] = React.useState("");
  const current = React.useRef<string | null>(threadId);
  current.current = threadId;
  const messagesRef = React.useRef<Message[]>([]);
  messagesRef.current = messages;
  const readSent = React.useRef(0);

  const lastSeq = () => messagesRef.current.reduce((n, m) => (m.pending || m.failed ? n : Math.max(n, m.seq)), 0);

  const load = React.useCallback(async () => {
    if (!threadId || !API_URL) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/pool/threads/${encodeURIComponent(threadId)}/messages`);
      if (current.current !== threadId) return;
      if (!res.ok) { setError(res.status === 404 ? "This conversation doesn't exist, or isn't yours." : "Couldn't load this conversation."); return; }
      const page = (await res.json()) as Page;
      setThread(page.thread);
      setMessages(page.messages);
      setHasOlder(page.hasMore);
    } catch {
      if (current.current === threadId) setError("Can't reach the server. Try again in a moment.");
    } finally {
      if (current.current === threadId) setLoading(false);
    }
  }, [threadId]);

  React.useEffect(() => {
    setThread(null);
    setMessages([]);
    setHasOlder(false);
    readSent.current = 0;
    void load();
  }, [load]);

  const poll = React.useCallback(async () => {
    if (!threadId || !API_URL || !thread) return;
    try {
      const res = await apiFetch(`/api/pool/threads/${encodeURIComponent(threadId)}/messages?after=${lastSeq()}&limit=100`);
      if (!res.ok || current.current !== threadId) return;
      const page = (await res.json()) as Page;
      // Polling returns the counters only; keep the context and send state from the first load.
      setThread((t) => (t ? { ...t, ...page.thread, context: t.context, canSend: t.canSend, cannotSendReason: t.cannotSendReason } : page.thread));
      if (page.messages.length) setMessages((cur) => merge(cur, page.messages));
    } catch { /* try again next tick */ }
  }, [threadId, thread]);
  usePolling(poll, CONVERSATION_POLL_MS, Boolean(threadId && thread));

  // Mark read what this tab is showing, while it is visible.
  const newest = messages.reduce((n, m) => (m.pending || m.failed ? n : Math.max(n, m.seq)), 0);
  React.useEffect(() => {
    if (!threadId || !thread || !newest || newest <= Math.max(readSent.current, thread.myReadSeq) || !visible()) return;
    readSent.current = newest;
    void apiCall<{ readSeq: number; unread: number }>(`/api/pool/threads/${encodeURIComponent(threadId)}/read`, { seq: newest }).then((res) => {
      if (res?.status === 200 && current.current === threadId) {
        setThread((t) => (t ? { ...t, myReadSeq: res.data.readSeq, unread: res.data.unread } : t));
        announce();
      }
    });
  }, [threadId, thread, newest]);

  const loadOlder = React.useCallback(async () => {
    if (!threadId || !hasOlder || loadingOlder) return;
    const oldest = messagesRef.current.find((m) => !m.pending && !m.failed)?.seq;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await apiFetch(`/api/pool/threads/${encodeURIComponent(threadId)}/messages?before=${oldest}&limit=50`);
      if (!res.ok) {
        setError("Couldn't load older messages. Try again.");
      } else if (current.current === threadId) {
        const page = (await res.json()) as Page;
        setMessages((cur) => merge(cur, page.messages));
        setHasOlder(page.hasMore);
        setError("");
      }
    } catch {
      setError("Couldn't load older messages. Try again.");
    } finally {
      setLoadingOlder(false);
    }
  }, [threadId, hasOlder, loadingOlder]);

  const deliver = React.useCallback(async (draft: Message) => {
    const res = await apiCall<any>(`/api/pool/threads/${encodeURIComponent(draft.threadId)}/messages`, { body: draft.body, clientId: draft.clientId });
    if (current.current !== draft.threadId) return;
    if (res && res.status === 200) {
      const sent = res.data as Message;
      setMessages((cur) => merge(cur, [sent]));
      setThread((t) => (t ? { ...t, lastSeq: Math.max(t.lastSeq, sent.seq), myReadSeq: Math.max(t.myReadSeq, sent.seq) } : t));
      announce();
      return;
    }
    const failed = res ? errorText(res.status, res.data, "Not sent.") : "Not sent: can't reach the server.";
    if (res?.status === 409) setThread((t) => (t ? { ...t, canSend: false, cannotSendReason: failed } : t));
    setMessages((cur) => cur.map((m) => (m.clientId === draft.clientId && m.pending ? { ...m, pending: false, failed } : m)));
  }, []);

  const send = React.useCallback((text: string) => {
    const body = text.trim();
    if (!threadId || !body) return;
    const draft: Message = {
      id: `local-${newClientId()}`, threadId, seq: Number.MAX_SAFE_INTEGER, body, removed: false, fromMe: true,
      senderRole: "freelancer", senderName: "", createdAt: new Date().toISOString(), clientId: newClientId(), pending: true,
    };
    setMessages((cur) => [...cur, draft]);
    void deliver(draft);
  }, [threadId, deliver]);

  /** Send a failed message again. Same client id: the server stores it at most once. */
  const retry = React.useCallback((msg: Message) => {
    setMessages((cur) => cur.map((m) => (m.id === msg.id ? { ...m, pending: true, failed: undefined } : m)));
    void deliver({ ...msg, pending: true, failed: undefined });
  }, [deliver]);

  const discard = React.useCallback((msg: Message) => {
    setMessages((cur) => cur.filter((m) => m.id !== msg.id));
  }, []);

  return { thread, messages, hasOlder, loading, loadingOlder, error, reload: load, loadOlder, send, retry, discard };
}

/** Start (or reopen) the conversation about a spec, with a first message. Resolves to the thread id or an error. */
export async function startConversation(input: { specId: string; freelancerId?: string; message: string; clientId?: string }): Promise<{ threadId?: string; error?: string }> {
  const res = await apiCall<any>("/api/pool/threads", input);
  if (!res) return { error: "Can't reach the server. Nothing was sent." };
  if (res.status !== 200) return { error: errorText(res.status, res.data, "Couldn't send that message.") };
  announce();
  return { threadId: res.data.thread.id as string };
}

export async function fetchThreadOptions(): Promise<ThreadOption[] | null> {
  try {
    const res = await apiFetch("/api/pool/threads/options");
    return res.ok ? ((await res.json()) as ThreadOption[]) : null;
  } catch {
    return null;
  }
}
