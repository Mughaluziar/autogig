"use client";
import { ListingDetail } from "@/components/marketplace/listing-detail";

export default function ListingPage({ params }: { params: { id: string } }) {
  return <ListingDetail id={decodeURIComponent(params.id)} base="/dashboard/marketplace" canRaise={true} />;
}
