"use client";
import { History, KeyRound, LockKeyhole, LogIn, MailCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { kindOf, type ActivityEntry } from "./security";

export function EventIcon({ entry }: { entry: ActivityEntry }) {
  const kind = kindOf(entry);
  const Icon = kind === "signin" ? LogIn : kind === "keys" ? KeyRound : kind === "team" ? Users : kind === "account" ? (/password/i.test(entry.action) ? LockKeyhole : MailCheck) : History;
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", entry.status === "warning" ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary")}>
      <Icon className="size-4" />
    </span>
  );
}
