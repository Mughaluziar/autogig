"use client";
import * as React from "react";
import { Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Mirrors normalize_linked_account in backend/app/routers/auth.py. */
type Rule = { label: string; hosts: string[]; template?: string; pattern?: RegExp; placeholder: string };

export const LINK_PLATFORMS: Record<string, Rule> = {
  upwork: { label: "Upwork", hosts: ["upwork.com"], placeholder: "https://www.upwork.com/freelancers/~01…" },
  fiverr: { label: "Fiverr", hosts: ["fiverr.com"], template: "https://www.fiverr.com/{}", pattern: /^[A-Za-z0-9_]{3,30}$/, placeholder: "Username or profile link" },
  freelancer: { label: "Freelancer.com", hosts: ["freelancer.com"], template: "https://www.freelancer.com/u/{}", pattern: /^[A-Za-z0-9_.-]{3,40}$/, placeholder: "Username or profile link" },
  toptal: { label: "Toptal", hosts: ["toptal.com"], template: "https://www.toptal.com/resume/{}", pattern: /^[A-Za-z0-9-]{3,60}$/, placeholder: "Profile link or resume name" },
  peopleperhour: { label: "PeoplePerHour", hosts: ["peopleperhour.com"], placeholder: "https://www.peopleperhour.com/freelancers/…" },
  guru: { label: "Guru", hosts: ["guru.com"], placeholder: "https://www.guru.com/freelancers/…" },
  contra: { label: "Contra", hosts: ["contra.com"], template: "https://contra.com/{}", pattern: /^[A-Za-z0-9_-]{2,40}$/, placeholder: "Username or profile link" },
  linkedin: { label: "LinkedIn", hosts: ["linkedin.com"], template: "https://www.linkedin.com/in/{}", pattern: /^[A-Za-z0-9_-]{3,100}$/, placeholder: "linkedin.com/in/your-name" },
  github: { label: "GitHub", hosts: ["github.com"], template: "https://github.com/{}", pattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, placeholder: "Username or profile link" },
  other: { label: "Other", hosts: [], placeholder: "https://your-portfolio.com" },
};

/** The profile URL, or an error message. */
export function normalizeLinkedAccount(platform: string, raw: string): { url?: string; error?: string } {
  const rule = LINK_PLATFORMS[platform];
  const value = raw.trim();
  if (!rule) return { error: "Choose a supported platform." };
  if (!value) return { error: "Enter your profile link or username." };
  if (value.length > 300) return { error: "That profile link is too long." };
  const name = platform === "other" ? "" : `${rule.label} `;
  const username = value.replace(/^@+/, "");
  const isUsername = !!rule.pattern && rule.pattern.test(username);
  if (!value.includes("/") && !/^https?:/i.test(value) && (!value.includes(".") || isUsername)) {
    if (rule.template && isUsername) return { url: rule.template.replace("{}", username) };
    return { error: `Paste the full link to your ${name}profile.` };
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { error: `Enter a valid link to your ${name}profile.` };
  }
  const host = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || !host.includes(".")) return { error: `Enter a valid link to your ${name}profile.` };
  if (rule.hosts.length && !rule.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return { error: `That isn't a ${name}link.` };
  if (rule.hosts.length && url.pathname.replace(/\//g, "") === "") return { error: `Link to your ${name}profile, not the home page.` };
  return { url: `https://${host}${url.pathname.replace(/\/+$/, "")}${url.search}` };
}

/**
 * "Link a freelancing account": a platform and the profile on it. The values
 * are read by SignupShell from #linkPlatform and #linkUrl.
 */
export function LinkedAccountField({ required = false }: { required?: boolean }) {
  const [platform, setPlatform] = React.useState("upwork");
  const [value, setValue] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const result = value.trim() ? normalizeLinkedAccount(platform, value) : null;
  const error = touched && (result?.error || (required && !value.trim() ? "Link at least one freelancing account." : ""));

  return (
    <fieldset className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3.5">
      <legend className="sr-only">Link a freelancing account</legend>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Link2 className="size-3.5" />
        </span>
        <div className="min-w-0">
          <Label htmlFor="linkUrl" className="block">Link a freelancing account{required ? "" : " (optional)"}</Label>
          <p className="text-xs text-muted-foreground">We use it to match you to work and show clients your track record.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <Select
          id="linkPlatform"
          aria-label="Platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {Object.entries(LINK_PLATFORMS).map(([id, r]) => (
            <option key={id} value={id}>{r.label}</option>
          ))}
        </Select>
        <Input
          id="linkUrl"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={LINK_PLATFORMS[platform].placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby="linkUrl-hint"
          data-link-error={result?.error ?? ""}
          className={cn("min-w-0", error && "border-destructive focus-visible:ring-destructive")}
        />
      </div>
      <p id="linkUrl-hint" className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
        {error
          ? error
          : result?.url
            ? <>Will link <span className="break-all font-medium text-foreground">{result.url}</span></>
            : platform === "upwork"
              ? "After you confirm your email you can also connect Upwork securely, so jobs and orders sync."
              : "Paste your profile link, or just your username where the platform has one."}
      </p>
    </fieldset>
  );
}
