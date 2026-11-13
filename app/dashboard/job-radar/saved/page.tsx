"use client";
import { JobRadarHeader, JobRadarNav } from "@/components/radar/job-radar-feed";
import { SavedView } from "@/components/radar/saved-view";

export default function JobSavedPage() {
  return (
    <div className="space-y-4">
      <JobRadarHeader />
      <JobRadarNav />
      <SavedView kind="job" />
    </div>
  );
}
