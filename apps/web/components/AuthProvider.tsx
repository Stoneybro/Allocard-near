"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { createPrivyNearTransport, type NearActionSender } from "@/lib/privy-near";
import type { NearCaller } from "@allocard/delegation-sdk";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { clearSession, createSession, type SessionIdentity } from "@/lib/session-client";
import { DEFAULT_TREASURY_CONTRACT } from "@/lib/chain";
export type AuthMethod = "privy" | "fast-auth" | "wallet-selector";
export type AuthState =
  | { status: "connecting" }
  | { status: "unauthenticated"; connect: () => void; connectExistingWallet: () => void; loginFastAuth: (options?: { redirectUri?: string }) => Promise<void>; connecting: boolean; error?: string }
  | { status: "authenticated"; address: `0x${string}`; accountId: string; email: string | null; authMethod: AuthMethod; disconnect: () => void; establishSession: () => Promise<SessionIdentity>; selector: WalletSelector | null; caller?: NearCaller; sendActions?: NearActionSender; connectExistingWallet: () => void };
const AuthContext = createContext<AuthState>({ status: "connecting" });
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <WalletAuthProvider>{children}</WalletAuthProvider>;
  return <PrivyProvider appId={appId} config={{ loginMethods: ["email", "google"], embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } } }}><PrivyAuthBridge>{children}</PrivyAuthBridge></PrivyProvider>;
}
function PrivyAuthBridge({ children }: { children: React.ReactNode }) {
  const privy = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const creation = useRef<ReturnType<typeof createWallet> | null>(null);
  const wallet = privy.user?.linkedAccounts.find(account => account.type === "wallet" && account.chainType === "near" && account.walletClientType === "privy");
  const accountId = wallet && "address" in wallet ? wallet.address : null;
  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    if (!privy.ready || !privy.authenticated) return;
    setBusy(true); setError(undefined);
    void (async () => {
      let address = accountId;
      if (!address) {
        const created = await (creation.current ??= createWallet({ chainType: "near" }).catch(error => { creation.current = null; throw error; }));
        address = created.wallet.address;
      }
      const accessToken = await privy.getAccessToken();
      const response = await fetch("/api/auth/session", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, accountId: address }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign-in verification failed");
      if (!cancelled) setIdentity(result);
    })().catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Sign-in failed"); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [privy.ready, privy.authenticated, accountId, retry]);
  const transport = useMemo(() => identity ? createPrivyNearTransport(identity.walletAddress, async hash => {
    const result = await signRawHash({ address: identity.walletAddress, chainType: "near", hash });
    return result.signature as `0x${string}`;
  }) : null, [identity, signRawHash]);
  if (!privy.ready || busy) return <AuthContext.Provider value={{ status: "connecting" }}>{children}</AuthContext.Provider>;
  if (!identity || !transport) return <AuthContext.Provider value={{ status: "unauthenticated", connecting: false, error, connect: () => privy.login(), connectExistingWallet: () => privy.login(), loginFastAuth: async () => { if (privy.authenticated) setRetry(n => n + 1); else privy.login(); } }}>{children}</AuthContext.Provider>;
  return <AuthContext.Provider value={{ status: "authenticated", accountId: identity.walletAddress, address: identity.walletAddress as `0x${string}`, email: identity.email, authMethod: "privy", selector: null, caller: transport.caller, sendActions: transport.sendActions, establishSession: async () => identity, connectExistingWallet: () => privy.login(), disconnect: async () => { setIdentity(null); await clearSession(); await privy.logout(); } }}>{children}</AuthContext.Provider>;
}
function WalletAuthProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false; let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupMyNearWallet }] = await Promise.all([
          import("@near-wallet-selector/core"), import("@near-wallet-selector/modal-ui"), import("@near-wallet-selector/meteor-wallet"), import("@near-wallet-selector/my-near-wallet"),
        ]);
        const next = await setupWalletSelector({ network: "testnet", modules: [setupMeteorWallet(), setupMyNearWallet()] });
        if (cancelled) return;
        setSelector(next); setModal(setupModal(next, { contractId: DEFAULT_TREASURY_CONTRACT, description: "Connect a NEAR testnet wallet, then sign the Allocard login message." }));
        setAccountId(next.store.getState().accounts[0]?.accountId ?? null);
        const subscription = next.store.observable.subscribe(state => { if (!cancelled) setAccountId(state.accounts[0]?.accountId ?? null); });
        unsubscribe = () => subscription.unsubscribe();
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Wallet initialization failed"); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    if (!accountId || !selector) return;
    setSigning(true); setError(undefined);
    void createSession(accountId, selector).then(next => { if (!cancelled) setIdentity(next); })
      .catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Sign-in failed"); })
      .finally(() => { if (!cancelled) setSigning(false); });
    return () => { cancelled = true; };
  }, [accountId, selector, retry]);
  const connectExistingWallet = useCallback(() => { if (accountId) setRetry(value => value + 1); else modal?.show(); }, [accountId, modal]);
  const disconnect = useCallback(async () => {
    setIdentity(null);
    try { await clearSession(); } finally { await (await selector?.wallet())?.signOut(); setAccountId(null); }
  }, [selector]);
  const state: AuthState = useMemo(() => {
    if (loading || signing) return { status: "connecting" };
    if (identity && identity.walletAddress === accountId) return {
      status: "authenticated", address: identity.walletAddress as `0x${string}`, accountId: identity.walletAddress,
      email: identity.email, authMethod: "wallet-selector", selector, disconnect, connectExistingWallet,
      establishSession: async () => { if (!selector) throw new Error("Wallet unavailable"); return createSession(identity.walletAddress, selector); },
    };
    return { status: "unauthenticated", connect: connectExistingWallet, connectExistingWallet, connecting: signing, error,
      loginFastAuth: async () => { setError("Email/social signing is not ready. Connect a NEAR wallet for the verified testnet flow."); },
    };
  }, [loading, signing, identity, accountId, selector, disconnect, connectExistingWallet, error]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
