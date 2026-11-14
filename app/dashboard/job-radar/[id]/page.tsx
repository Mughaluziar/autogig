"use client";;
import { use } from "react";
import { JobDetail } from "@/components/radar/job-detail";
import { decodeId } from "@/components/radar/radar-data";

export default function JobDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <JobDetail id={decodeId(params.id)} />;
}
