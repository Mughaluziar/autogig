"use client";
import { JobApply } from "@/components/radar/job-apply";
import { decodeId } from "@/components/radar/radar-data";

export default function JobApplyPage({ params }: { params: { id: string } }) {
  return <JobApply id={decodeId(params.id)} />;
}
