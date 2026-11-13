"use client";
import { RaiseForm } from "@/components/marketplace/raise-form";

export default function RaisePage() {
  return <RaiseForm base="/dashboard/marketplace" verifyHref="/dashboard/capital" accountsHref="/dashboard/orders" />;
}
