"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPrivyNearTransport, type NearActionSender } from "@/lib/privy-near";
import type { NearCaller } from "@allocard/delegation-sdk";
import { clearSession, createPrivySession, SessionClientError, type SessionIdentity } from "@/lib/session-client";
import { QueryProvider } from "./QueryProvider";
import { accountQueryKey } from "@/lib/query-keys";
import { withTimeout } from "@/lib/request-timeout";

export type AuthState =
  | { status: "connecting" }
  | { status: "unauthenticated"; connect: () => void; connecting: boolean; error?: string }
  | { status: "authenticated"; address: string; accountId: string; providerUserId: string; email: string; authMethod: "privy"; disconnect: () => Promise<void>; establishSession: () => Promise<SessionIdentity>; caller: NearCaller; sendActions: NearActionSender; createAdapterPermission: ReturnType<typeof createPrivyNearTransport>["createAdapterPermission"] };
const AuthContext = createContext<AuthState>({ status: "connecting" });
const privyConfig = {
  loginMethods: ["email", "google"] as ("email" | "google")[],
  embeddedWallets: { ethereum: { createOnLogin: "off" as const }, solana: { createOnLogin: "off" as const } },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  return <QueryProvider>{appId ? (
    <PrivyProvider appId={appId} config={privyConfig}><PrivyAuthBridge>{children}</PrivyAuthBridge></PrivyProvider>
  ) : (
    <AuthContext.Provider value={{ status: "unauthenticated", connecting: false, connect: () => {}, error: "Sign-in is not configured. Contact support." }}>{children}</AuthContext.Provider>
  )}</QueryProvider>;
}

function PrivyAuthBridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<{ principal: string; identity: SessionIdentity } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [retry, setRetry] = useState(0);
  const principal = privy.authenticated ? privy.user?.id ?? null : null;
  const wallet = privy.user?.linkedAccounts.find(account => account.type === "wallet" && account.chainType === "near" && account.walletClientType === "privy");
  const accountId = wallet && "address" in wallet ? wallet.address : null;
  // SDK callback identities may change during OAuth and wallet creation. Keep
  // their latest implementations without making them bootstrap dependencies.
  const sdk = useRef({ createWallet, getAccessToken: privy.getAccessToken, signRawHash, logout: privy.logout, login: privy.login });
  useEffect(() => { sdk.current = { createWallet, getAccessToken: privy.getAccessToken, signRawHash, logout: privy.logout, login: privy.login }; });
  const creation = useRef<{ principal: string; promise: ReturnType<typeof createWallet> } | null>(null);
  const previousPrincipal = useRef<string | null>(null);

  useEffect(() => {
    if (!privy.ready || signingOut) return;
    let cancelled = false;
    const changedPrincipal = previousPrincipal.current !== principal;
    const hadPrincipal = previousPrincipal.current !== null;
    previousPrincipal.current = principal;
    if (changedPrincipal) {
      creation.current = null;
      // Cancel old reads before removing private cached data.
      void queryClient.cancelQueries({ queryKey: ["allocard"] });
      queryClient.removeQueries({ queryKey: ["allocard"] });
    }
    const clearing = changedPrincipal && hadPrincipal ? clearSession() : Promise.resolve();
    if (!principal) {
      void clearing.then(() => { if (!cancelled) { setBusy(false); setSession(null); } }).catch(() => setError("Could not clear your session. Please retry sign-out."));
      return () => { cancelled = true; };
    }
    void (async () => {
      await clearing;
      if (cancelled) return;
      setBusy(true);
      setError(undefined);
      let address = accountId;
      if (!address) {
        if (creation.current?.principal !== principal) {
          creation.current = { principal, promise: withTimeout(sdk.current.createWallet({ chainType: "near" }), "Wallet setup timed out. Please try signing in again.") };
        }
        address = (await creation.current.promise).wallet.address;
      }
      if (cancelled) return;
      const identity = await withTimeout((async () => {
        try {
          const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const existing = await response.json() as SessionIdentity;
            if (existing.providerUserId === principal && existing.walletAddress === address && existing.email) return existing;
          }
        } catch { /* Recover with a fresh Privy proof. */ }
        return createPrivySession(address, () => sdk.current.getAccessToken());
      })(), "Sign-in timed out. Please try again.", 60_000);
      if (identity.providerUserId !== principal) throw new Error("Your account changed. Please sign in again.");
      if (!cancelled) setSession(current => current?.principal === principal && current.identity.walletAddress === identity.walletAddress && current.identity.email === identity.email ? current : { principal, identity });
    })().catch(async caught => {
      if (!cancelled) {
        creation.current = null;
        if (caught instanceof SessionClientError && caught.code === "SESSION_REVOKED") {
          // Privy may restore the token from a sign-in we already revoked.
          // End that provider session so the next click opens a fresh login.
          setSession(null);
          await sdk.current.logout();
          return;
        }
        setError(caught instanceof Error ? caught.message : "Sign-in failed");
      }
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [privy.ready, principal, accountId, retry, queryClient, signingOut]);

  // Keep the same verified identity visible during background synchronization.
  // A different user or wallet can never reuse the previous identity.
  const identity = principal && session?.principal === principal && (!accountId || accountId === session.identity.walletAddress) ? session.identity : null;
  const address = identity?.walletAddress;
  const establishSession = useCallback(async () => {
    if (!address) throw new Error("Sign in again to continue");
    // Renewal does not change the identity or callback reference.
    return createPrivySession(address, () => sdk.current.getAccessToken());
  }, [address]);
  const signHash = useCallback(async (hash: `0x${string}`) => {
    if (!address) throw new Error("Sign in again to continue");
    const result = await signRawHash({ address, chainType: "near", hash });
    return result.signature as `0x${string}`;
  }, [address, signRawHash]);
  useQuery({
    queryKey: ["auth-session", principal], enabled: !!identity,
    queryFn: async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15_000) });
      if (response.status === 401) {
        try { await establishSession(); await queryClient.invalidateQueries({ queryKey: accountQueryKey(principal, address ?? null) }); }
        catch (caught) {
          if (caught instanceof SessionClientError && (caught.status === 401 || caught.status === 403)) {
            setSession(null);
            await queryClient.cancelQueries({ queryKey: ["allocard"] });
            queryClient.removeQueries({ queryKey: ["allocard"] });
            await sdk.current.logout();
          }
          throw caught;
        }
      }
      else if (!response.ok) throw new Error("Session service is temporarily unavailable");
      return true;
    }, initialData: true, refetchInterval: 5 * 60_000, staleTime: 60_000, retry: false,
  });
  const transport = useMemo(() => {
    if (!address || !principal) return null;
    return createPrivyNearTransport(address, signHash);
  }, [address, principal, queryClient, signHash]);
  const disconnect = useCallback(async () => {
    setSigningOut(true);
    setSession(null);
    await queryClient.cancelQueries({ queryKey: ["allocard"] });
    queryClient.removeQueries({ queryKey: ["allocard"] });
    try {
      await clearSession();
    } finally {
      try {
        await sdk.current.logout();
      } finally {
        // Keep protected pages hidden until the landing page has loaded.
        window.location.replace("/");
      }
    }
  }, [queryClient]);
  const connect = useCallback(() => {
    if (sdk.current && principal) setRetry(n => n + 1);
    else sdk.current.login();
  }, [principal]);

  if (signingOut) return <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground" role="status">Signing out…</div>;
  if (identity && transport) return <AuthContext.Provider value={{ status: "authenticated", address: identity.walletAddress, accountId: identity.walletAddress, providerUserId: identity.providerUserId, email: identity.email, authMethod: "privy", disconnect, establishSession, ...transport }}>{children}</AuthContext.Provider>;
  if (!privy.ready || (principal && busy) || (privy.authenticated && !principal)) return <AuthContext.Provider value={{ status: "connecting" }}>{children}</AuthContext.Provider>;
  return <AuthContext.Provider value={{ status: "unauthenticated", connecting: false, error, connect }}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
