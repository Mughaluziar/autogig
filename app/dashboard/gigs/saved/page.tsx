"use client";
import { GigsSubpage } from "@/components/gigs/gigs-subpage";
import { SavedView } from "@/components/radar/saved-view";

export default function GigSavedPage() {
  return (
    <GigsSubpage title="Saved gigs" sub="Gigs you bookmarked and searches you run often.">
      <SavedView kind="gig" />
    </GigsSubpage>
  );
}
