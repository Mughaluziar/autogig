"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { API_URL, apiCall, apiGet } from "@/lib/api";

type ImportResult = { added: number; duplicates: number; found: number };

/**
 * Bring Upwork jobs in without the Upwork API: paste an alert email, or describe
 * one job. Alert emails forwarded to the user's private Autopilot address arrive
 * automatically; this dialog is the manual route and shows that address.
 */
export function UpworkImportDialog({ open, onOpenChange, onImported }: {
  open: boolean; onOpenChange: (v: boolean) => void; onImported: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"paste" | "single">("paste");
  const [text, setText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [skills, setSkills] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [address, setAddress] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !API_URL) return;
    apiGet<{ configured: boolean; address: string | null }>("/api/inbox/address").then((r) => setAddress(r?.address ?? null));
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!API_URL) { setError("Importing needs the backend, which isn't connected in this demo build."); return; }
    const body = mode === "paste"
      ? { subject: "", text, html: "" }
      : { title, url, description, skills: skills.split(",").map((s) => s.trim()).filter(Boolean) };
    setBusy(true);
    const res = await apiCall<ImportResult & { detail?: string }>("/api/upwork/leads/import", body);
    setBusy(false);
    if (!res) { setError("Can't reach the server. Try again in a moment."); return; }
    if (res.status >= 400) { setError(typeof res.data?.detail === "string" ? res.data.detail : "Couldn't import that."); return; }
    const { added, duplicates } = res.data;
    toast({
      title: added ? `${added} Upwork job${added === 1 ? "" : "s"} added` : "Nothing new",
      description: duplicates ? `${duplicates} already in your list.` : "Find them under Upwork (email alert).",
      variant: added ? "success" : undefined,
    });
    setText(""); setTitle(""); setUrl(""); setDescription(""); setSkills("");
    onOpenChange(false);
    onImported();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add Upwork jobs</DialogTitle>
        <DialogDescription>
          No Upwork login or API involved: paste a job-alert email you received, or describe one job. You&apos;ll draft and send the proposal yourself.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex rounded-xl bg-muted p-1 text-xs font-medium" role="tablist">
          {([["paste", "Paste an alert email"], ["single", "One job"]] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)}
              className={mode === v ? "flex-1 rounded-lg bg-background px-2.5 py-1.5 shadow-sm" : "flex-1 rounded-lg px-2.5 py-1.5 text-muted-foreground"}>{l}</button>
          ))}
        </div>
        {mode === "paste" ? (
          <div className="space-y-1.5">
            <Label htmlFor="uw-paste">Alert email text</Label>
            <Textarea id="uw-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)} maxLength={100000}
              placeholder="Paste the whole email, including the job links." />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="uw-title">Job title</Label>
              <Input id="uw-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uw-url">Link to the job on Upwork</Label>
              <Input id="uw-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.upwork.com/jobs/~01…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uw-desc">Description</Label>
              <Textarea id="uw-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uw-skills">Skills (comma-separated)</Label>
              <Input id="uw-skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, Node.js" />
            </div>
          </div>
        )}
        {address && (
          <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
            Automatic: forward your Upwork job-alert emails to <span className="break-all font-mono text-foreground">{address}</span> and new jobs appear here on their own.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="gradient" disabled={busy || (mode === "paste" ? !text.trim() : !title.trim())}>
            {busy ? "Adding…" : "Add to my list"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
