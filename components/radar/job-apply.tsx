"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, ClipboardCopy, ExternalLink, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { PaywallDialog } from "@/components/dashboard/paywall";
import { useAuth } from "@/lib/auth";
import { useWorkspaceSlice } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import { CompanyAvatar, Chip, MatchRing } from "./bits";
import { BASE, facets, hostOf, jobPay, listingHref } from "./radar-data";
import { useAutoApply, useListing, usePipeline, useProposal, useSkills } from "./use-radar";
import { AutoApplyPanel, Composer, StepHeading, copyText, proposalChecks } from "./apply-parts";
import { DetailSkeleton, NotFound } from "./job-detail";

/** Reused on every application — saved with the user's workspace. */
type ApplicantProfile = {
  headline: string;
  summary: string;
  links: { portfolio: string; resume: string; linkedin: string; github: string };
  /** Answers worth reusing (start date, salary, work authorization…), by question. */
  library: Record<string, string>;
};
const EMPTY_PROFILE: ApplicantProfile = { headline: "", summary: "", links: { portfolio: "", resume: "", linkedin: "", github: "" }, library: {} };

const STANDARD_QUESTIONS = [
  { q: "Why are you interested in this role?", reusable: false },
  { q: "When can you start?", reusable: true },
  { q: "What are your salary or rate expectations?", reusable: true },
  { q: "Are you authorized to work where this role is based?", reusable: true },
];
const LINKS: { key: keyof ApplicantProfile["links"]; label: string; ph: string }[] = [
  { key: "portfolio", label: "Portfolio", ph: "https://yoursite.com" },
  { key: "resume", label: "Resume link", ph: "https://drive.google.com/…" },
  { key: "linkedin", label: "LinkedIn", ph: "https://linkedin.com/in/you" },
  { key: "github", label: "GitHub", ph: "https://github.com/you" },
];

export function JobApply({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { listing, loading } = useListing(id);
  const { skills } = useSkills();
  const pipe = usePipeline();
  const proposal = useProposal(listing, skills);
  const [profile, setProfile, ready] = useWorkspaceSlice<ApplicantProfile>("radar.profile", EMPTY_PROFILE);
  const [draftProfile, setDraftProfile] = React.useState<ApplicantProfile>(EMPTY_PROFILE);
  const [answers, setAnswers] = React.useState<{ q: string; a: string }[]>([]);
  const [newQ, setNewQ] = React.useState("");
  const [opened, setOpened] = React.useState(false);
  const app = listing ? pipe.tracked(listing.id) : undefined;

  // Load the saved profile once the workspace is ready.
  const profileLoaded = React.useRef(false);
  React.useEffect(() => {
    if (!ready || profileLoaded.current) return;
    profileLoaded.current = true;
    setDraftProfile({ ...EMPTY_PROFILE, ...profile, links: { ...EMPTY_PROFILE.links, ...profile.links } });
  }, [ready, profile]);

  // Answers: this application's, else the standard set prefilled from the library.
  const answersLoaded = React.useRef("");
  React.useEffect(() => {
    if (!listing || !ready || answersLoaded.current === listing.id) return;
    answersLoaded.current = listing.id;
    setAnswers(app?.answers?.length ? app.answers
      : STANDARD_QUESTIONS.map(({ q }) => ({ q, a: profile.library?.[q] ?? "" })));
  }, [listing, ready, app, profile.library]);

  const auto = useAutoApply(listing, () => ({
    instructions: proposal.text ? `Use this cover letter: ${proposal.text}` : "Fill the application with my profile.",
    fields: { proposal: proposal.text, company: listing?.company, skills, profile: draftProfile, answers },
  }));

  if (!listing) return loading ? <DetailSkeleton /> : <NotFound kind="job" />;

  const f = facets(listing);
  const pay = jobPay(listing);
  const host = hostOf(listing.url) || listing.source;
  const { checks } = proposalChecks(proposal.text, listing);
  const answered = answers.filter((x) => x.a.trim()).length;
  const profileDone = !!(draftProfile.headline.trim() && draftProfile.summary.trim());
  const ready3 = [
    { label: "Cover letter written", ok: proposal.text.trim().length > 40 },
    { label: "Profile summary", ok: profileDone },
    { label: `Screening answers (${answered}/${answers.length})`, ok: answers.length > 0 && answered === answers.length },
  ];

  const saveProfile = () => {
    setProfile(() => ({ ...draftProfile }));
    toast({ title: "Profile saved", description: "It's reused for every application.", variant: "success" });
  };

  const persistAnswers = () => {
    const row = app ?? pipe.track(listing, "Drafted", proposal.text);
    if (row) pipe.patch(row.id, { answers });
    const reusable = new Set(STANDARD_QUESTIONS.filter((s) => s.reusable).map((s) => s.q));
    const lib = Object.fromEntries(answers.filter((x) => reusable.has(x.q) && x.a.trim()).map((x) => [x.q, x.a.trim()]));
    if (Object.keys(lib).length) setProfile((cur) => ({ ...cur, library: { ...cur.library, ...lib } }));
  };

  const packet = () => [
    proposal.text.trim(),
    draftProfile.headline || draftProfile.summary ? `\n— ${user?.name ?? ""}${draftProfile.headline ? `, ${draftProfile.headline}` : ""}\n${draftProfile.summary}` : "",
    ...LINKS.filter((l) => draftProfile.links[l.key]).map((l) => `${l.label}: ${draftProfile.links[l.key]}`),
    ...(answered ? ["", "Screening answers:", ...answers.filter((x) => x.a.trim()).map((x) => `${x.q}\n${x.a.trim()}`)] : []),
  ].filter((x) => x !== undefined).join("\n").trim();

  const copyAll = async () => {
    persistAnswers();
    const ok = await copyText(packet());
    toast(ok ? { title: "Application copied", description: `Paste it into the form on ${host}.`, variant: "success" }
      : { title: "Couldn't copy", description: "Your browser blocked the clipboard — select the text and copy it yourself." });
  };

  const markApplied = () => {
    persistAnswers();
    pipe.track(listing, "Applied", proposal.text);
    toast({ title: "Marked as applied", description: "It's on your board — follow up in a few days.", variant: "success" });
    router.push(`${BASE.job}/pipeline`);
  };

  return (
    <div className="space-y-5">
      <Link href={listingHref("job", listing.id)} className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 shrink-0" /> <span className="truncate">{listing.title}</span>
      </Link>

      <header className="flex items-start gap-4">
        <CompanyAvatar name={listing.company} size={52} className="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Application</p>
          <h1 className="text-xl font-bold leading-tight tracking-tight md:text-2xl">{listing.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{listing.company}{pay && ` · ${pay}`}{f.workplace && ` · ${f.workplace}`}</p>
        </div>
        <MatchRing score={listing.matchScore} size={52} className="hidden sm:block" />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <section className="panel space-y-4 p-5">
            <StepHeading n={1} title="Cover letter" sub="Start from an AI draft written for this listing, then make it sound like you." />
            <Composer listing={listing} label="Cover letter" text={proposal.text} setText={proposal.setText}
              generate={(tone) => void proposal.generate(tone)} generating={proposal.generating}
              save={() => void proposal.save()} saving={proposal.saving}
              placeholder={`Hi ${listing.company} team — …`} />
          </section>

          <section className="panel space-y-4 p-5">
            <StepHeading n={2} title="Your profile" sub="Saved to your workspace and reused on every application." />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ap-headline">Headline</Label>
                <Input id="ap-headline" value={draftProfile.headline} maxLength={120}
                  onChange={(e) => setDraftProfile({ ...draftProfile, headline: e.target.value })}
                  placeholder="Senior React engineer · 7 years shipping SaaS dashboards" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ap-summary">Summary</Label>
                <Textarea id="ap-summary" rows={4} value={draftProfile.summary} maxLength={1200}
                  onChange={(e) => setDraftProfile({ ...draftProfile, summary: e.target.value })}
                  placeholder="Two or three sentences: what you do best, a result you're proud of, what you want next." />
              </div>
              {LINKS.map((l) => (
                <div key={l.key} className="space-y-1.5">
                  <Label htmlFor={`ap-${l.key}`}>{l.label}</Label>
                  <Input id={`ap-${l.key}`} type="url" inputMode="url" value={draftProfile.links[l.key]} placeholder={l.ph}
                    onChange={(e) => setDraftProfile({ ...draftProfile, links: { ...draftProfile.links, [l.key]: e.target.value } })} />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={saveProfile} disabled={!ready}>Save profile</Button>
            </div>
          </section>

          <section className="panel space-y-4 p-5">
            <StepHeading n={3} title="Screening answers" sub="Most forms ask these. Start date, pay and work authorization answers are remembered for next time." />
            <div className="space-y-3">
              {answers.map((x, i) => (
                <div key={`${x.q}-${i}`} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`ans-${i}`} className="flex-1">{x.q}</Label>
                    {!STANDARD_QUESTIONS.some((s) => s.q === x.q) && (
                      <button aria-label="Remove question" className="text-muted-foreground hover:text-foreground"
                        onClick={() => setAnswers(answers.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
                    )}
                  </div>
                  <Textarea id={`ans-${i}`} rows={2} value={x.a} onBlur={persistAnswers}
                    onChange={(e) => setAnswers(answers.map((y, j) => (j === i ? { ...y, a: e.target.value } : y)))} />
                </div>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              if (!newQ.trim()) return;
              setAnswers([...answers, { q: newQ.trim(), a: "" }]);
              setNewQ("");
            }}>
              <Input value={newQ} onChange={(e) => setNewQ(e.target.value)} placeholder="Add a question from the form" maxLength={200} />
              <Button type="submit" variant="outline" className="shrink-0"><Plus /> Add</Button>
            </form>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="space-y-4 lg:sticky lg:top-0">
            <section className="panel space-y-3 p-5">
              <StepHeading n={4} title="Send it" sub={`You submit on ${host} — Autopilot never applies without you.`} />
              <ul className="space-y-1.5">
                {ready3.map((r) => (
                  <li key={r.label} className={cn("flex items-center gap-2 text-xs", r.ok ? "text-foreground" : "text-muted-foreground")}>
                    {r.ok ? <CheckCircle2 className="size-3.5 text-success" /> : <Circle className="size-3.5" />} {r.label}
                  </li>
                ))}
                <li className="pl-5 text-[11px] text-muted-foreground">{checks.filter((c) => c.ok).length}/{checks.length} cover-letter checks passed</li>
              </ul>
              <div className="space-y-2 pt-1">
                <Button variant="outline" className="w-full justify-start" onClick={() => void copyAll()} disabled={!proposal.text.trim()}>
                  <ClipboardCopy /> 1 · Copy my application
                </Button>
                <Button variant="outline" className="w-full justify-start" asChild>
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
                    <ExternalLink /> 2 · Open the form on {host}
                  </a>
                </Button>
                <Button variant={opened ? "gradient" : "outline"} className="w-full justify-start" onClick={markApplied}>
                  <Send /> 3 · I&apos;ve applied — track it
                </Button>
              </div>
              {app && app.stage !== "Saved" && app.stage !== "Drafted" && (
                <Chip tone="success" className="w-full justify-center py-1 text-xs">Already marked {app.stage.toLowerCase()}</Chip>
              )}
            </section>

            <AutoApplyPanel job={auto.job} busy={auto.busy} onPrepare={() => void auto.prepare()}
              onApprove={() => void auto.approve()} onCancel={() => void auto.cancel()} disabled={!proposal.text.trim()}
              note="The automation engine prepares every step and pauses before submitting. On accounts without a connected browser worker it runs as a labelled simulation and sends nothing." />
            <PaywallDialog open={auto.outOfCredits} onOpenChange={auto.setOutOfCredits} kind="bids" />
          </div>
        </aside>
      </div>
    </div>
  );
}
