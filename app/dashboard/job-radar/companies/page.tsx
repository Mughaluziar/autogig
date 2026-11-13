"use client";
import { CompanyBoards } from "@/components/dashboard/company-boards";
import { JobRadarHeader, JobRadarNav } from "@/components/radar/job-radar-feed";
import { API_URL } from "@/lib/api";

export default function JobCompaniesPage() {
  return (
    <div className="space-y-4">
      <JobRadarHeader />
      <JobRadarNav />
      {API_URL ? (
        <CompanyBoards />
      ) : (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Watching company career boards needs the backend; this demo has no server connected.
        </p>
      )}
    </div>
  );
}
