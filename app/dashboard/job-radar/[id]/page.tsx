"use client";
import { JobDetail } from "@/components/radar/job-detail";
import { decodeId } from "@/components/radar/radar-data";

export default function JobDetailPage({ params }: { params: { id: string } }) {
  return <JobDetail id={decodeId(params.id)} />;
}
