"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SaveSearchDialog({ open, onOpenChange, query, onSave, noun }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  query: string;
  onSave: (name: string, query: string) => Promise<boolean>;
  noun: string;
}) {
  const [name, setName] = React.useState("");
  const [q, setQ] = React.useState(query);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setQ(query);
      const first = query.split(",")[0]?.trim();
      setName(first ? `${first[0].toUpperCase()}${first.slice(1)} ${noun}` : `My ${noun}`);
    }
  }, [open, query, noun]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Save this search</DialogTitle>
        <DialogDescription>Run it again in one tap and see how many new {noun} appeared since last time.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await onSave(name, q);
          setBusy(false);
          if (ok) onOpenChange(false);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ss-name">Name</Label>
          <Input id="ss-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ss-q">Skills or keywords</Label>
          <Input id="ss-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="react, typescript" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="gradient" disabled={busy || !q.trim()}>Save search</Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
