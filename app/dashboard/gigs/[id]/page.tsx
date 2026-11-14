"use client";;
import { use } from "react";
import { GigDetail } from "@/components/gigs/gig-detail";
import { decodeId } from "@/components/radar/radar-data";

export default function GigDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <GigDetail id={decodeId(params.id)} />;
}
