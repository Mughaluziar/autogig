"use client";
import * as React from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiCall, apiGet } from "@/lib/api";

const DEFAULT = "Drafted with AI assistance and reviewed by the sender.";

/** The line added to every AI-drafted reply when you copy it out. You can reword it; it must still say AI was used. */
export function DisclosureSettings() {
  const [line, setLine] = React.useState(DEFAULT);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  React.useEffect(() => {
    void apiGet<{ aiDisclosure?: string }>("/api/settings").then((s) => { if (s?.aiDisclosure) setLine(s.aiDisclosure); });
  }, []);
  async function save() {
    const res = await apiCall<{ detail?: unknown }>("/api/settings", { aiDisclosure: line }, "PATCH");
    if (res && res.status < 400) setMsg({ ok: true, text: "Saved." });
    else setMsg({ ok: false, text: typeof res?.data?.detail === "string" ? res.data.detail : "Couldn't save." });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot className="size-5" /> AI disclosure line</CardTitle>
        <CardDescription>
          Replies drafted by the AI (including persona drafts) are shown to you to review and edit. When you copy one to send it,
          this line is added so the recipient knows AI helped. Autopilot never sends messages for you, and there is no setting that hides AI use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ai-disclosure">Wording</Label>
          <Input id="ai-disclosure" value={line} maxLength={200} onChange={(e) => { setLine(e.target.value); setMsg(null); }} />
        </div>
        <Button onClick={save} data-testid="disclosure-save">Save wording</Button>
        {msg && <p className={`text-sm ${msg.ok ? "text-muted-foreground" : "text-destructive"}`} role="status">{msg.text}</p>}
      </CardContent>
    </Card>
  );
}
