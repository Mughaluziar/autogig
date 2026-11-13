import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Loading and error states for a server-backed page. Renders nothing when the data is ready. */
export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) {
    return <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</div>;
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
        <AlertTriangle className="size-6 text-warning" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="size-4" /> Try again</Button>
      </div>
    );
  }
  return null;
}
