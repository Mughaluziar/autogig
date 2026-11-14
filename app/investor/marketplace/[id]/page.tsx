"use client";;
import { use } from "react";
import { ListingDetail } from "@/components/marketplace/listing-detail";

export default function ListingPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return <ListingDetail id={decodeURIComponent(params.id)} base="/investor/marketplace" canRaise={false} />;
}
