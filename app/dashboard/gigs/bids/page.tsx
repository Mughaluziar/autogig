"use client";
import { GigsSubpage } from "@/components/gigs/gigs-subpage";
import { PipelineBoard } from "@/components/radar/pipeline-board";

export default function GigBidsPage() {
  return (
    <GigsSubpage title="My bids" sub="Every bid you've drafted or sent, from first draft to hired.">
      <PipelineBoard kind="gig" />
    </GigsSubpage>
  );
}
