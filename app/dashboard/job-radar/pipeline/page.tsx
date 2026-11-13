"use client";
import { JobRadarHeader, JobRadarNav } from "@/components/radar/job-radar-feed";
import { PipelineBoard } from "@/components/radar/pipeline-board";

export default function JobPipelinePage() {
  return (
    <div className="space-y-4">
      <JobRadarHeader />
      <JobRadarNav />
      <PipelineBoard kind="job" />
    </div>
  );
}
