"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Confirm = { title: string; body: string; confirmLabel?: string; action: () => Promise<void> | void };

/** "Are you sure?" for destructive actions (remove, revoke, leave). */
export function ConfirmDialog({ confirm, onClose }: { confirm: Confirm | null; onClose: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={!!confirm} onOpenChange={(v) => !v && !busy && onClose()}>
      {confirm && (
        <>
          <DialogHeader>
            <DialogTitle>{confirm.title}</DialogTitle>
            <DialogDescription>{confirm.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await confirm.action();
                } finally {
                  setBusy(false);
                  onClose();
                }
              }}
            >
              {busy ? "Working…" : confirm.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
