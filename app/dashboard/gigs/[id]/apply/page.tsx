"use client";;
import { use } from "react";
import { GigApply } from "@/components/gigs/gig-apply";
import { decodeId } from "@/components/radar/radar-data";

export default function GigApplyPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <GigApply id={decodeId(params.id)} />;
}
