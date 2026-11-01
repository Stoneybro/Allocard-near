"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import {
  clearSession,
  createSession,
  type SessionIdentity,
} from "@/lib/session-client";

export type AuthState =
  | { status: "connecting" }
  | { status: "unauthenticated"; connect: () => void; connecting: boolean }
  | {
      status: "authenticated";
      address: `0x${string}`;
      accountId: string;
      email: string | null;
      disconnect: () => void;
      establishSession: () => Promise<SessionIdentity>;
      selector: WalletSelector | null;
    };

const AuthContext = createContext<AuthState>({ status: "connecting" });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accounts, setAccounts] = useState<Array<{ accountId: string }>>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const sessionIdentityRef = useRef<SessionIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initSelector() {
      try {
        const { setupWalletSelector } = await import("@near-wallet-selector/core");
        const { setupModal } = await import("@near-wallet-selector/modal-ui");
        const { setupMyNearWallet } = await import("@near-wallet-selector/my-near-wallet");
        const { setupMeteorWallet } = await import("@near-wallet-selector/meteor-wallet");

        const _selector = await setupWalletSelector({
          network: "testnet",
          modules: [
            setupMeteorWallet(),
            setupMyNearWallet(),
          ],
        });

        const _modal = setupModal(_selector, {
          contractId: "treasury.allocard.testnet",
          description: "Connect your NEAR testnet account to manage corporate allowances and company treasury.",
        });

        if (cancelled) return;

        setSelector(_selector);
        setModal(_modal);

        const state = _selector.store.getState();
        setAccounts(state.accounts);

        const subscription = _selector.store.observable.subscribe((nextState) => {
          if (!cancelled) {
            setAccounts(nextState.accounts);
          }
        });

        return () => subscription.unsubscribe();
      } catch (err) {
        console.error("Failed to initialize NEAR Wallet Selector", err);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    }

    void initSelector();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeAccount = accounts[0]?.accountId ?? null;

  // Sync server session whenever activeAccount changes
  useEffect(() => {
    if (activeAccount) {
      void createSession(activeAccount, `${activeAccount}@near`).catch((err) => {
        console.warn("Failed to synchronize session with backend", err);
      });
    }
  }, [activeAccount]);

  const establishSession = useCallback(async (): Promise<SessionIdentity> => {
    if (sessionIdentityRef.current && sessionIdentityRef.current.walletAddress === activeAccount) {
      return sessionIdentityRef.current;
    }
    if (!activeAccount) {
      throw new Error("No NEAR account connected");
    }
    const identity = await createSession(activeAccount, `${activeAccount}@near`);
    sessionIdentityRef.current = identity;
    return identity;
  }, [activeAccount]);

  const connect = useCallback(() => {
    if (modal) {
      modal.show();
    }
  }, [modal]);

  const disconnect = useCallback(async () => {
    if (selector) {
      const wallet = await selector.wallet();
      await wallet.signOut();
    }
    try {
      await clearSession();
    } finally {
      sessionIdentityRef.current = null;
      setAccounts([]);
    }
  }, [selector]);

  const state: AuthState = useMemo(() => {
    if (isInitializing) {
      return { status: "connecting" };
    }
    if (activeAccount) {
      return {
        status: "authenticated",
        address: activeAccount as `0x${string}`,
        accountId: activeAccount,
        email: `${activeAccount}@near`,
        disconnect,
        establishSession,
        selector,
      };
    }
    return {
      status: "unauthenticated",
      connect,
      connecting: false,
    };
  }, [isInitializing, activeAccount, disconnect, establishSession, connect, selector]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
