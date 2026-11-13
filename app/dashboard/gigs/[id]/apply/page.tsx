"use client";
import { GigApply } from "@/components/gigs/gig-apply";
import { decodeId } from "@/components/radar/radar-data";

export default function GigApplyPage({ params }: { params: { id: string } }) {
  return <GigApply id={decodeId(params.id)} />;
}
