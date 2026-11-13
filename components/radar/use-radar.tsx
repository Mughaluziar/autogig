"use client";
import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { useDemoStore } from "@/lib/demo-store";
import { API_URL, apiCall, apiGet } from "@/lib/api";
import {
  appToListing, findInScans, isUpwork, kindOf, readScan, similarFrom, skillList, writeScan, type ScanSnapshot,
} from "./radar-data";
import type { Application, ApplyJob, Kind, Listing, ProposalRecord, SavedSearch } from "./types";

const DEFAULT_SKILLS = "react, next.js, typescript";
const detailOf = (data: unknown, fallback: string) =>
  typeof (data as { detail?: unknown })?.detail === "string" ? (data as { detail: string }).detail : fallback;

// ------------------------------------------------------------ profile ----

/** The user's saved skill list (server-side profile), shared by every radar page. */
export function useSkills() {
  const [skills, setSkills] = React.useState(DEFAULT_SKILLS);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    apiGet<{ skills?: string[] }>("/api/radar/profile").then((profile) => {
      if (!alive) return;
      if (profile?.skills?.length) setSkills(profile.skills.join(", "));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);
  return { skills, setSkills, loaded };
}

// -------------------------------------------------------------- saved ----

type SavedData = { jobs: Listing[]; searches: SavedSearch[] };

/**
 * One copy of the server's saved items per signed-in user, shared by every
 * component on the page — so the nav count and the feed never disagree.
 */
const savedStore = {
  owner: "" as string,
  data: null as SavedData | null,
  pending: null as Promise<void> | null,
  subs: new Set<(d: SavedData) => void>(),
  publish(owner: string, d: SavedData) {
    if (owner !== this.owner) return;
    this.data = d;
    this.subs.forEach((fn) => fn(d));
  },
  load(owner: string) {
    if (this.owner !== owner) {
      this.owner = owner;
      this.data = null;
      this.pending = null;
    }
    if (this.data || this.pending) return;
    this.pending = apiGet<Partial<SavedData>>("/api/radar/saved").then((res) => {
      this.pending = null;
      const d = { jobs: res?.jobs ?? [], searches: res?.searches ?? [] };
      if (res) this.publish(owner, d);
      // A failed load isn't cached — the next page visit retries.
      else if (owner === this.owner) this.subs.forEach((fn) => fn(d));
    });
  },
};

/** Saved listings and saved searches — server-side with a backend, the workspace otherwise. */
export function useSaved() {
  const { toast } = useToast();
  const { user } = useAuth();
  const owner = user?.id ?? "";
  const demo = useDemoStore();
  const radar = demo?.state.radar;
  const [data, setData] = React.useState<SavedData | null>(() => (savedStore.owner === owner ? savedStore.data : null));

  React.useEffect(() => {
    if (!API_URL || !owner) return;
    const sub = (d: SavedData) => setData(d);
    savedStore.subs.add(sub);
    savedStore.load(owner);
    if (savedStore.owner === owner && savedStore.data) setData(savedStore.data);
    return () => { savedStore.subs.delete(sub); };
  }, [owner]);

  const remoteJobs = React.useMemo(() => data?.jobs ?? [], [data]);
  const remoteSearches = data?.searches ?? [];
  const loaded = !API_URL || !!data;
  const current = () => savedStore.data ?? { jobs: remoteJobs, searches: remoteSearches };
  const setRemoteJobs = (jobs: Listing[]) => savedStore.publish(owner, { ...current(), jobs });
  const setRemoteSearches = (searches: SavedSearch[]) => savedStore.publish(owner, { ...current(), searches });

  const savedIds = React.useMemo(
    () => (API_URL ? remoteJobs.map((j) => j.id) : radar?.saved ?? []),
    [remoteJobs, radar?.saved]
  );
  const searches: SavedSearch[] = API_URL ? remoteSearches : ((radar?.savedSearches ?? []) as SavedSearch[]);

  const toggle = async (job: Listing) => {
    if (!API_URL) {
      const saved = demo?.radarToggleSaved(job.id);
      toast({ title: saved ? "Saved for later" : "Removed from saved" });
      return;
    }
    const already = savedIds.includes(job.id);
    const { truncated: _t, ...row } = job;
    const res = await apiCall<{ jobs?: Listing[] }>(
      `/api/radar/saved-jobs/${encodeURIComponent(job.id)}`,
      already ? {} : { ...row, kind: kindOf(job), description: (row.description ?? "").slice(0, 4000) },
      already ? "DELETE" : "PUT",
    );
    if (res && res.status < 400) {
      setRemoteJobs(res.data.jobs ?? []);
      toast({ title: already ? "Removed from saved" : "Saved for later" });
    } else {
      toast({ title: "Couldn't update saved items", description: detailOf(res?.data, "Check your connection and try again.") });
    }
  };

  const saveSearch = async (name: string, query: string): Promise<boolean> => {
    if (!query.trim()) return false;
    if (!API_URL) {
      demo?.radarSaveSearch(name || "Search", query.trim());
      toast({ title: "Search saved", variant: "success" });
      return true;
    }
    const res = await apiCall<{ searches?: SavedSearch[] }>("/api/radar/saved-searches", {
      name: name.trim() || "Search", query: query.trim(), alertEnabled: true,
    });
    if (res && res.status < 400) {
      setRemoteSearches(res.data.searches ?? []);
      toast({ title: "Search saved", description: "Strong matches are included in your scheduled alerts.", variant: "success" });
      return true;
    }
    toast({ title: "Couldn't save search", description: detailOf(res?.data, "Check your connection and try again.") });
    return false;
  };

  const removeSearch = async (s: SavedSearch) => {
    if (!API_URL) {
      demo?.radarRemoveSearch(s.id);
      return;
    }
    const res = await apiCall<{ searches?: SavedSearch[] }>(`/api/radar/saved-searches/${encodeURIComponent(s.id)}`, {}, "DELETE");
    if (res && res.status < 400) setRemoteSearches(res.data.searches ?? []);
    else toast({ title: "Couldn't remove search", description: detailOf(res?.data, "Check your connection and try again.") });
  };

  return { jobs: API_URL ? remoteJobs : [], savedIds, searches, toggle, saveSearch, removeSearch, loaded };
}

// ------------------------------------------------------------ pipeline ----

/** Applications or bids actually sent in the last 7 days, for one product or both. */
export function sentThisWeek(apps: Application[], kind?: Kind): number {
  const weekAgo = Date.now() - 7 * 86_400_000;
  return apps.filter((a) =>
    (!kind || (kind === "gig" ? a.kind === "gig" : a.kind !== "gig"))
    && a.stage !== "Saved" && a.stage !== "Drafted"
    && Date.parse(a.submittedAt || a.appliedAt) > weekAgo).length;
}

export function usePipeline() {
  const demo = useDemoStore();
  const radar = demo?.state.radar;
  const apps = React.useMemo(() => (radar?.applications ?? []) as Application[], [radar?.applications]);
  const tracked = React.useCallback((jobId: string) => apps.find((a) => a.jobId === jobId), [apps]);
  return {
    /** False until the workspace has loaded — don't prefill forms from `apps` before then. */
    hydrated: demo?.hydrated ?? false,
    apps,
    tracked,
    /** Sent in the last 7 days — pass a kind to count one product only. */
    weekly: (kind?: Kind) => sentThisWeek(apps, kind),
    goal: radar?.weeklyGoal ?? 10,
    streak: radar?.scanStreak ?? 0,
    lastScanDate: radar?.lastScanDate ?? "",
    track: (job: Listing, stage: Application["stage"] = "Saved", proposal = "") =>
      demo?.radarTrackJob(job, stage, proposal) as Application | undefined,
    patch: (id: string, patch: Partial<Application>) => demo?.radarPatchApp(id, patch),
    remove: (id: string) => demo?.radarRemoveApp(id),
    setGoal: (g: number) => demo?.radarSetGoal(g),
    dismiss: (jobId: string) => demo?.radarDismiss(jobId),
    dismissed: radar?.dismissed ?? [],
  };
}

// ---------------------------------------------------------------- feed ----

export function useRadarFeed(kind: Kind) {
  const { toast } = useToast();
  const { user } = useAuth();
  const demo = useDemoStore();
  const radar = demo?.state.radar;
  const { skills, setSkills } = useSkills();
  const [snap, setSnap] = React.useState<ScanSnapshot | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Restore the last scan from this browser so returning to the page isn't empty.
  React.useEffect(() => {
    setSnap(readScan(user?.id, kind));
  }, [user?.id, kind]);

  // "New since your last visit" — pinned to the value before this visit's scans.
  const visitRef = React.useRef<string | null>(null);
  if (visitRef.current === null && demo?.hydrated && radar) visitRef.current = radar.lastVisitAt || "";
  const lastVisit = visitRef.current ? Date.parse(visitRef.current) : 0;
  const isNew = React.useCallback(
    (j: Listing) => lastVisit > 0 && Date.parse(j.postedAt || "") > lastVisit,
    [lastVisit]
  );

  const scan = async (q?: string) => {
    const query = (q ?? skills).trim();
    setLoading(true);
    if (q !== undefined) setSkills(q);
    await apiCall("/api/radar/profile", { skills: skillList(query) }, "PUT");
    const res = await apiGet<{ jobs: Listing[]; sources: string[]; fetchedAt: string }>(
      `/api/radar/jobs?q=${encodeURIComponent(query)}&limit=60&kind=${kind}`
    );
    setLoading(false);
    if (!res) {
      toast({
        title: "Scan failed",
        description: API_URL ? "The server didn't answer — try again in a moment." : "Job feeds need the backend; this demo has no server connected.",
      });
      return;
    }
    const next: ScanSnapshot = { query, fetchedAt: res.fetchedAt, jobs: res.jobs ?? [], sources: res.sources ?? [] };
    setSnap(next);
    writeScan(user?.id, kind, next);
    const fresh = next.jobs.filter(isNew).length;
    demo?.radarRecordScan(query, fresh);
    const noun = kind === "gig" ? "gigs" : "roles";
    toast({
      title: `${next.jobs.length} ${noun} found`,
      description: fresh > 0 ? `${fresh} posted since your last visit` : "Nothing new since your last visit",
    });
  };

  return {
    skills, setSkills, scan, loading, isNew,
    jobs: snap?.jobs ?? [],
    sources: snap?.sources ?? [],
    fetchedAt: snap?.fetchedAt ?? "",
    lastQuery: snap?.query ?? "",
  };
}

// ------------------------------------------------------------- listing ----

const detailCache = new Map<string, { listing: Listing; similar: Listing[] }>();

/**
 * One listing for the detail/apply pages: the server's copy (full text) when
 * it has one, else this browser's last scan, else the pipeline row.
 */
export function useListing(id: string) {
  const { user } = useAuth();
  const demo = useDemoStore();
  const apps = (demo?.state.radar?.applications ?? []) as Application[];
  const cached = detailCache.get(id);
  const [state, setState] = React.useState<{ listing: Listing | null; similar: Listing[]; loading: boolean; partial: boolean }>(
    () => cached ? { ...cached, loading: false, partial: false } : { listing: null, similar: [], loading: true, partial: false }
  );

  React.useEffect(() => {
    let alive = true;
    const hit = detailCache.get(id);
    if (hit) {
      setState({ ...hit, loading: false, partial: false });
      return;
    }
    const local = findInScans(user?.id, id);
    if (local) {
      setState({ listing: local.listing, similar: similarFrom(local.listing, local.pool), loading: !!API_URL, partial: true });
    }
    if (!API_URL) {
      if (!local) setState((s) => ({ ...s, loading: false }));
      return;
    }
    apiGet<{ job: Listing; similar: Listing[] }>(`/api/radar/jobs/${encodeURIComponent(id)}`).then((res) => {
      if (!alive) return;
      if (res?.job) {
        const entry = { listing: res.job, similar: res.similar?.length ? res.similar : local ? similarFrom(res.job, local.pool) : [] };
        detailCache.set(id, entry);
        setState({ ...entry, loading: false, partial: false });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    });
    return () => { alive = false; };
  }, [id, user?.id]);

  // Last resort: the copy kept on the pipeline row.
  const app = apps.find((a) => a.jobId === id);
  if (!state.listing && !state.loading && app) {
    return { listing: appToListing(app), similar: [], loading: false, partial: true };
  }
  return state;
}

// ------------------------------------------------------------ proposal ----

export function useProposal(listing: Listing | null, skills: string) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { tracked, track, hydrated } = usePipeline();
  const [text, setText] = React.useState("");
  const [proposalId, setProposalId] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const loadedFor = React.useRef("");

  // Pick up an existing draft (server first, then the pipeline row).
  React.useEffect(() => {
    if (!listing || !hydrated || loadedFor.current === listing.id) return;
    loadedFor.current = listing.id;
    const fromApp = tracked(listing.id)?.proposal ?? "";
    if (fromApp) setText(fromApp);
    if (!API_URL) return;
    apiGet<ProposalRecord[]>("/api/radar/proposals").then((items) => {
      const draft = items?.find((p) => p.jobId === listing.id && p.status === "draft");
      if (draft) {
        setProposalId(draft.id);
        setText((cur) => cur || draft.body);
      }
    });
  }, [listing, tracked, hydrated]);

  const generate = async (tone = "professional") => {
    if (!listing) return;
    setGenerating(true);
    const res = await apiCall<{ proposal: string; proposalId: string; aiGenerated: boolean }>("/api/radar/proposal", {
      jobId: listing.id, jobTitle: listing.title, jobDescription: (listing.description ?? "").slice(0, 4000), jobUrl: listing.url,
      platform: listing.source, matchScore: listing.matchScore, skills, userName: user?.name ?? "", tone,
    });
    setGenerating(false);
    if (res?.data?.proposal) {
      setText(res.data.proposal);
      setProposalId(res.data.proposalId ?? "");
      track(listing, "Drafted", res.data.proposal);
      toast(res.data.aiGenerated
        ? { title: "Draft ready", description: "Read it through and make it yours before sending." }
        : { title: "Template draft", description: "AI is offline, so this is a template. Edit freely." });
    } else {
      toast({ title: "Couldn't write a draft", description: API_URL ? "The server didn't answer — try again." : "AI drafts need the backend." });
    }
  };

  const save = async () => {
    if (!listing || !text.trim()) return;
    setSaving(true);
    const app = tracked(listing.id);
    track(listing, app && app.stage !== "Saved" ? app.stage : "Drafted", text);
    if (API_URL && proposalId) {
      const res = await apiCall(`/api/radar/proposals/${encodeURIComponent(proposalId)}`, { body: text }, "PUT");
      if (!res || res.status >= 400) toast({ title: "Saved here, not on the server", description: detailOf(res?.data, "Check your connection.") });
      else toast({ title: "Draft saved", variant: "success" });
    } else {
      toast({ title: "Draft saved", variant: "success" });
    }
    setSaving(false);
  };

  return { text, setText, generate, generating, save, saving };
}

// ---------------------------------------------------------- auto-apply ----

const AUTO_STEPS = ["Open the job posting", "Read the application form", "Fill your details",
  "Attach resume / portfolio", "Answer screening questions", "Submit the application"];
const simSteps = (approved: boolean) => AUTO_STEPS.map((s, i) =>
  i === AUTO_STEPS.length - 1 && !approved ? { step: s, status: "paused", detail: "Awaiting your approval." } : { step: s, status: "done" });

/**
 * The automation engine (routers/automation.py): prepares the application,
 * pauses before submitting, and only a real worker send spends a bid credit —
 * the server does that on approval and answers 402 when none are left.
 */
export function useAutoApply(listing: Listing | null, payload: () => { instructions: string; fields: Record<string, unknown> }) {
  const { toast } = useToast();
  const { demoMode } = useAuth();
  const { track } = usePipeline();
  const [job, setJob] = React.useState<ApplyJob | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [outOfCredits, setOutOfCredits] = React.useState(false);

  // Restore a job already prepared for this listing.
  React.useEffect(() => {
    if (!listing || !API_URL) return;
    let alive = true;
    apiGet<(ApplyJob & { url?: string; kind?: string; createdAt?: string })[]>("/api/automation/jobs").then((jobs) => {
      const mine = jobs?.find((j) => j.kind === "auto_apply" && j.url === listing.url && j.status !== "cancelled");
      if (alive && mine) setJob(mine);
    });
    return () => { alive = false; };
  }, [listing]);

  const offline = () => toast({ title: "Can't reach the server", description: "Nothing was changed — try again." });

  const prepare = async () => {
    if (!listing) return;
    if (isUpwork(listing)) {
      toast({ title: "Submit Upwork proposals yourself", description: "Copy the draft and send it on upwork.com. Autopilot never applies on Upwork for you." });
      return;
    }
    setBusy(true);
    const p = payload();
    const res = await apiCall<ApplyJob>("/api/automation/jobs", {
      kind: "auto_apply", platform: listing.source, title: `${listing.title} @ ${listing.company}`, url: listing.url, ...p,
    });
    setBusy(false);
    if (!res && !demoMode) return offline();
    if (res && res.status >= 400) {
      toast({ title: "Couldn't prepare the application", description: detailOf(res.data, "Please try again.") });
      return;
    }
    setJob(res?.data ?? { id: `local-${listing.id}`, status: "needs_approval", engine: "simulation", steps: simSteps(false) });
    toast({ title: "Application prepared", description: "Every step is ready. Review it, then approve to submit." });
  };

  const approve = async () => {
    if (!listing || !job) return;
    setBusy(true);
    const res = await apiCall<ApplyJob>(`/api/automation/jobs/${job.id}/approve`, {});
    setBusy(false);
    if (!res && !demoMode) return offline();
    if (res && res.status === 402) {
      setOutOfCredits(true);
      return;
    }
    if (res && res.status >= 400) {
      toast({ title: "Couldn't approve", description: detailOf(res.data, "Please try again.") });
      return;
    }
    const done: ApplyJob = res?.data ?? { ...job, status: "completed", steps: simSteps(true) };
    setJob(done);
    if (done.status !== "completed") {
      toast({ title: "Not sent", description: done.steps.find((s) => s.status === "failed")?.detail ?? "The automation didn't finish." });
    } else if (done.engine === "worker") {
      track(listing, "Applied", payload().fields.proposal as string);
      toast({ title: "Submitted", description: "Tracked as Applied in your pipeline.", variant: "success" });
    } else {
      toast({ title: "Simulation finished — nothing was sent", description: "Submit it yourself on the original posting, then mark it applied." });
    }
  };

  const cancel = async () => {
    if (!job) return;
    const res = await apiCall<ApplyJob>(`/api/automation/jobs/${job.id}/cancel`, {});
    if (!res && !demoMode) return offline();
    if (res && res.status >= 400) {
      toast({ title: "Couldn't cancel", description: detailOf(res.data, "Please try again.") });
      return;
    }
    setJob(null);
  };

  return { job, busy, prepare, approve, cancel, outOfCredits, setOutOfCredits };
}

/** Plan and bid credits (server-owned with a backend). */
export function useCredits() {
  const demo = useDemoStore();
  const m = demo?.state.monetization;
  return { isPro: m?.plan === "pro", bidCredits: m?.bidCredits ?? 0 };
}
