"use client";

import { useAuth } from "@/components/AuthProvider";
import Link from "next/link";

// ── Shared layout wrapper ────────────────────────────────────────────────────

function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center p-8 bg-white">
      <div className="flex flex-col items-center text-center gap-8 w-full max-w-md">
        {children}
      </div>
    </div>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin text-[#999]"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        d="M12 2a10 10 0 0 1 10 10"
        className="opacity-100"
      />
      <path
        strokeLinecap="round"
        d="M12 2a10 10 0 0 0-10 10"
        className="opacity-20"
      />
    </svg>
  );
}

// ── ConnectRequiredCard ──────────────────────────────────────────────────────

export function ConnectRequiredCard({
  title = "Sign in to Allocard",
  description = "Sign in to open your Allocard workspace.",
}: {
  title?: string;
  description?: string;
}) {
  const auth = useAuth();

  if (auth.status === "connecting") {
    return (
      <AuthScreen>
        <Spinner />
        <p className="text-xl font-bold text-[#111]">Connecting...</p>
      </AuthScreen>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <AuthScreen>
        <div className="w-16 h-16 flex items-center justify-center mb-2">
          <img src="/AllocardLogoBlack.svg" alt="Allocard Logo" className="w-full h-full object-contain" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-bold text-[#111]">{title}</p>
          <p className="text-base text-[#666]">{description}</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-sm mt-2">
          {auth.error && <p role="alert" className="text-sm text-red-600">{auth.error}</p>}
          {/* Primary onboarding: FastAuth / Email / Social */}
          <button
            onClick={() => auth.loginFastAuth()}
            title="Sign in with email or Google"
            disabled={auth.connecting}
            className="h-12 w-full rounded-md bg-[#111] text-white text-base font-medium hover:bg-[#27272a] transition-all disabled:opacity-40 cursor-pointer flex items-center justify-center gap-3 shadow-sm hover:shadow"
          >
            {auth.connecting ? <Spinner /> : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
              </svg>
            )}
            {auth.connecting ? "Connecting..." : "Continue with Email / Google"}
          </button>
          <span className="text-[11px] text-[#888] -mt-1 text-center">
            Your NEAR wallet is created securely when you sign in.
          </span>

          <div className="relative my-2 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[#eaeaea]" />
            </div>
            <span className="relative bg-white px-2 text-[11px] uppercase tracking-wider text-[#999]">
              or existing wallet
            </span>
          </div>

          {/* Secondary / Optional: Existing Web3 Wallet (Meteor, MyNearWallet) */}
          <button
            onClick={auth.connectExistingWallet}
            disabled={auth.connecting}
            className="h-11 w-full rounded-md border border-[#e4e4e7] bg-white text-[#18181b] text-sm font-medium hover:bg-[#fafafa] hover:border-[#d4d4d8] transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            <svg className="w-4 h-4 text-[#52525b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="16" cy="12" r="1.5" />
            </svg>
            Connect existing NEAR wallet
          </button>

          <Link
            href="/"
            className="mt-1 h-10 w-full rounded-md text-[#71717a] text-sm font-medium hover:text-[#18181b] transition-colors flex items-center justify-center"
          >
            Return to Home Page
          </Link>
        </div>
      </AuthScreen>
    );
  }

  return null;
}

// ── useConnectedWalletAddress (legacy compat — thin wrapper over useAuth) ────

/**
 * @deprecated Prefer useAuth() directly.
 */
export function useConnectedWalletAddress() {
  const auth = useAuth();

  if (auth.status === "authenticated") {
    return {
      address: auth.address,
      isConnected: true,
      isAuthLoading: false,
      shouldPromptConnect: false,
    };
  }

  return {
    address: undefined,
    isConnected: false,
    isAuthLoading: auth.status === "connecting",
    shouldPromptConnect: auth.status === "unauthenticated",
  };
}
