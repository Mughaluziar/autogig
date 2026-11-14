"use client";;
import { use } from "react";
import { JobApply } from "@/components/radar/job-apply";
import { decodeId } from "@/components/radar/radar-data";

export default function JobApplyPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <JobApply id={decodeId(params.id)} />;
}
