import type { NavLink } from "@/components/marketplace/common";

/** Banking section tabs. Investors get the money-movement pages only. */
export function bankingLinks(base: string, opts: { full: boolean }): NavLink[] {
  return [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/transfers`, label: "Move money" },
    { href: `${base}/transactions`, label: "Transactions" },
    { href: `${base}/crypto`, label: "Crypto wallet" },
    { href: `${base}/accounts`, label: "Bank accounts" },
    { href: `${base}/statements`, label: "Statements" },
    ...(opts.full ? [{ href: `${base}/cards`, label: "Cards" }, { href: `${base}/financing`, label: "Financing" }] : []),
  ];
}
