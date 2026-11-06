"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { createPrivyNearTransport, type NearActionSender } from "@/lib/privy-near";
import type { NearCaller } from "@allocard/delegation-sdk";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { clearSession, createPrivySession, createSession, type SessionIdentity } from "@/lib/session-client";
import { DEFAULT_TREASURY_CONTRACT } from "@/lib/chain";
export type AuthMethod = "privy" | "fast-auth" | "wallet-selector";
export type AuthState =
  | { status: "connecting" }
  | { status: "unauthenticated"; connect: () => void; connectExistingWallet: () => void; loginFastAuth: (options?: { redirectUri?: string }) => Promise<void>; connecting: boolean; error?: string }
  | { status: "authenticated"; address: `0x${string}`; accountId: string; email: string | null; authMethod: AuthMethod; disconnect: () => void; establishSession: () => Promise<SessionIdentity>; selector: WalletSelector | null; caller?: NearCaller; sendActions?: NearActionSender; connectExistingWallet: () => void };
const AuthContext = createContext<AuthState>({ status: "connecting" });
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [method, setMethod] = useState<"privy" | "wallet" | null>(null);
  useEffect(() => {
    // Hydrate the browser-only login preference after the server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMethod(localStorage.getItem("allocard_auth_method") === "wallet" ? "wallet" : "privy");
  }, []);
  const switchMethod = async (next: "privy" | "wallet") => {
    await clearSession();
    localStorage.setItem("allocard_auth_method", next);
    setMethod(next);
  };
  if (!appId) return <WalletAuthProvider>{children}</WalletAuthProvider>;
  if (!method) return <AuthContext.Provider value={{ status: "connecting" }}>{children}</AuthContext.Provider>;
  return <PrivyProvider appId={appId} config={{ loginMethods: ["email", "google"], embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } } }}><>{method === "wallet" ? <WalletAuthProvider onEmail={() => switchMethod("privy")}>{children}</WalletAuthProvider> : <PrivyAuthBridge onExistingWallet={() => switchMethod("wallet")}>{children}</PrivyAuthBridge>}</></PrivyProvider>;
}
function PrivyAuthBridge({ children, onExistingWallet }: { children: React.ReactNode; onExistingWallet: () => Promise<void> }) {
  const privy = usePrivy();
  const { createWallet } = useCreateWallet();
  const { getAccessToken } = privy;
  const { signRawHash } = useSignRawHash();
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const wasAuthenticated = useRef(false);
  const creation = useRef<ReturnType<typeof createWallet> | null>(null);
  const wallet = privy.user?.linkedAccounts.find(account => account.type === "wallet" && account.chainType === "near" && account.walletClientType === "privy");
  const accountId = wallet && "address" in wallet ? wallet.address : null;
  useEffect(() => {
    let cancelled = false;
    // Synchronize local identity with changes from the external authentication SDK.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(null);
    if (!privy.ready || !privy.authenticated) {
      setBusy(false);
      creation.current = null;
      if (wasAuthenticated.current) void clearSession().catch(caught => setError(caught.message));
      wasAuthenticated.current = false;
      return;
    }
    wasAuthenticated.current = true;
    setBusy(true); setError(undefined);
    void (async () => {
      let address = accountId;
      if (!address) {
        const created = await (creation.current ??= createWallet({ chainType: "near" }).catch(error => { creation.current = null; throw error; }));
        address = created.wallet.address;
      }
      if (cancelled) return;
      const result = await createPrivySession(address, () => getAccessToken());
      if (!cancelled) setIdentity(result);
    })().catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Sign-in failed"); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [privy.ready, privy.authenticated, accountId, retry, createWallet, getAccessToken]);
  const transport = useMemo(() => identity ? createPrivyNearTransport(identity.walletAddress, async hash => {
    const result = await signRawHash({ address: identity.walletAddress, chainType: "near", hash });
    return result.signature as `0x${string}`;
  }) : null, [identity, signRawHash]);
  if (!privy.ready || busy) return <AuthContext.Provider value={{ status: "connecting" }}>{children}</AuthContext.Provider>;
  if (!identity || !transport) return <AuthContext.Provider value={{ status: "unauthenticated", connecting: false, error, connect: () => privy.login(), connectExistingWallet: () => { void onExistingWallet().catch(caught => setError(caught.message)); }, loginFastAuth: async () => { if (privy.authenticated) setRetry(n => n + 1); else privy.login(); } }}>{children}</AuthContext.Provider>;
  return <AuthContext.Provider value={{ status: "authenticated", accountId: identity.walletAddress, address: identity.walletAddress as `0x${string}`, email: identity.email, authMethod: "privy", selector: null, caller: transport.caller, sendActions: transport.sendActions, establishSession: async () => {
    const next = await createPrivySession(identity.walletAddress, () => getAccessToken());
    setIdentity(next);
    return next;
  }, connectExistingWallet: () => { void onExistingWallet().catch(caught => setError(caught.message)); }, disconnect: async () => { setIdentity(null); try { await clearSession(); } finally { await privy.logout(); } } }}>{children}</AuthContext.Provider>;
}
function WalletAuthProvider({ children, onEmail }: { children: React.ReactNode; onEmail?: () => Promise<void> }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const previousAccount = useRef<string | null>(null);
  const autoConnect = Boolean(onEmail);
  useEffect(() => {
    let cancelled = false; let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupMyNearWallet }] = await Promise.all([
          import("@near-wallet-selector/core"), import("@near-wallet-selector/modal-ui"), import("@near-wallet-selector/meteor-wallet"), import("@near-wallet-selector/my-near-wallet"),
        ]);
        const next = await setupWalletSelector({ network: "testnet", modules: [setupMeteorWallet(), setupMyNearWallet()] });
        if (cancelled) return;
        const nextModal = setupModal(next, { contractId: DEFAULT_TREASURY_CONTRACT, description: "Connect a NEAR testnet wallet, then sign the Allocard login message." });
        setSelector(next); setModal(nextModal);
        if (autoConnect && !next.store.getState().accounts.length) nextModal.show();
        setAccountId(next.store.getState().accounts[0]?.accountId ?? null);
        const subscription = next.store.observable.subscribe(state => { if (!cancelled) setAccountId(state.accounts[0]?.accountId ?? null); });
        unsubscribe = () => subscription.unsubscribe();
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Wallet initialization failed"); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; unsubscribe?.(); };
  }, [autoConnect]);
  useEffect(() => {
    let cancelled = false;
    // Discard the previous identity as the wallet SDK changes its selected account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdentity(null);
    if (previousAccount.current && previousAccount.current !== accountId) {
      void clearSession().catch(caught => setError(caught.message));
    }
    previousAccount.current = accountId;
    if (!accountId || !selector) { setSigning(false); return; }
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
      loginFastAuth: async () => { if (onEmail) { await onEmail(); return; } setError("Email/social signing is not ready. Connect a NEAR wallet for the verified testnet flow."); },
    };
  }, [loading, signing, identity, accountId, selector, disconnect, connectExistingWallet, error, onEmail]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
