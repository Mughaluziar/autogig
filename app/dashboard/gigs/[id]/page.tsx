"use client";
import { GigDetail } from "@/components/gigs/gig-detail";
import { decodeId } from "@/components/radar/radar-data";

export default function GigDetailPage({ params }: { params: { id: string } }) {
  return <GigDetail id={decodeId(params.id)} />;
}
