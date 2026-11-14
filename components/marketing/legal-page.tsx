import * as React from "react";
import { Badge } from "@/components/ui/badge";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  // Not legal text: every legal page says plainly that it is an unreviewed draft until a lawyer has signed it off.
  return (
    <div className="container max-w-3xl py-16">
      <Badge className="mb-4">Legal</Badge>
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
      <p role="note" data-testid="legal-draft-notice" className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
        <strong>Draft.</strong> This document has not yet been reviewed by a lawyer and is not final. It describes how
        the service is intended to work and is not a statement that it complies with any particular law.
      </p>
      <div className="prose prose-sm mt-8 max-w-none space-y-6 text-muted-foreground [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground">
        {children}
      </div>
    </div>
  );
}
