"use client";
/**
 * Browser-wallet discovery with EIP-6963 (multi-wallet discovery), so MetaMask, Coinbase Wallet, Rabby, Brave,
 * Trust, OKX and any other extension that follows the standard appear side by side instead of fighting over
 * `window.ethereum`. No dependency, no key handling: the wallet keeps the keys, this code only asks it for an address
 * and, when the token program is on, for a signature on a message. It never asks for a transaction.
 * Wallets that connect through a QR code (WalletConnect) need a Reown project id: see docs/open-source-evaluation.md.
 */
import * as React from "react";

export type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
export type DiscoveredWallet = { id: string; name: string; icon: string | null; provider: Eip1193 };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const isAddress = (value: unknown): value is string => typeof value === "string" && ADDRESS.test(value);

/** Only data: images are used as icons, so a wallet announcement can never make the page load a remote URL. */
const safeIcon = (icon: unknown): string | null =>
  typeof icon === "string" && /^data:image\/(png|svg\+xml|webp|jpeg|gif);/.test(icon) && icon.length < 100_000 ? icon : null;

type Announcement = { info?: { uuid?: unknown; name?: unknown; icon?: unknown }; provider?: unknown };

/** Pure: turn an EIP-6963 announcement into a wallet, or null when it is malformed. */
export function fromAnnouncement(detail: Announcement | undefined): DiscoveredWallet | null {
  const info = detail?.info;
  const provider = detail?.provider as Eip1193 | undefined;
  if (!info || typeof info.uuid !== "string" || typeof info.name !== "string" || !provider || typeof provider.request !== "function") return null;
  return { id: info.uuid.slice(0, 80), name: info.name.slice(0, 40), icon: safeIcon(info.icon), provider };
}

export function discoverWallets(onChange: (wallets: DiscoveredWallet[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const found = new Map<string, DiscoveredWallet>();
  const emit = () => onChange([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
  const listener = (event: Event) => {
    const wallet = fromAnnouncement((event as CustomEvent<Announcement>).detail);
    if (wallet) { found.set(wallet.id, wallet); emit(); }
  };
  window.addEventListener("eip6963:announceProvider", listener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Older wallets only inject window.ethereum: offer it when nothing announced itself.
  const legacy = window.setTimeout(() => {
    const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (found.size === 0 && injected && typeof injected.request === "function") {
      found.set("legacy", { id: "legacy", name: "Browser wallet", icon: null, provider: injected });
      emit();
    }
  }, 400);
  return () => { window.removeEventListener("eip6963:announceProvider", listener); window.clearTimeout(legacy); };
}

export function useWallets(): { wallets: DiscoveredWallet[]; searched: boolean } {
  const [wallets, setWallets] = React.useState<DiscoveredWallet[]>([]);
  const [searched, setSearched] = React.useState(false);
  React.useEffect(() => {
    const stop = discoverWallets(setWallets);
    const done = window.setTimeout(() => setSearched(true), 600);
    return () => { stop(); window.clearTimeout(done); };
  }, []);
  return { wallets, searched };
}

/** Ask the wallet to share one account (the wallet shows its own approval prompt). */
export async function connect(wallet: DiscoveredWallet): Promise<{ address: string; chainId: number | null }> {
  const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as unknown;
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (!isAddress(address)) throw new Error("The wallet did not share a valid account.");
  let chainId: number | null = null;
  try {
    const hex = (await wallet.provider.request({ method: "eth_chainId" })) as string;
    chainId = Number.parseInt(hex, 16);
  } catch { /* the chain is informational only */ }
  return { address, chainId: Number.isFinite(chainId) ? chainId : null };
}

/** personal_sign of a UTF-8 message with the chosen wallet. Never a transaction. */
export async function signWith(wallet: DiscoveredWallet, address: string, message: string): Promise<string> {
  const hex = "0x" + Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return (await wallet.provider.request({ method: "personal_sign", params: [hex, address] })) as string;
}

export const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum", 56: "BNB Smart Chain", 137: "Polygon", 8453: "Base", 84532: "Base Sepolia", 11155111: "Sepolia" };
