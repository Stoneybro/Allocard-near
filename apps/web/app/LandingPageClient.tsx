"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useQueryClient } from "@tanstack/react-query";
import { accountQueryKey } from "@/lib/query-keys";
import { getWalletProfile } from "@/app/actions/identity";
import { withTimeout } from "@/lib/request-timeout";
import Image from "next/image";
import { Button } from "@/components/ui/button";

const LOGIN_INTENT_KEY = "allocard_pending_login_at";
const LOGIN_INTENT_TTL = 10 * 60_000;

function storeLoginIntent(startedAt: number | null) {
  try {
    if (startedAt === null) sessionStorage.removeItem(LOGIN_INTENT_KEY);
    else sessionStorage.setItem(LOGIN_INTENT_KEY, String(startedAt));
  } catch { /* Sign-in can still finish in this page when storage is unavailable. */ }
}

function routeForStatus(status?: "new" | "picker" | "employer" | "employee" | null) {
  if (status === "employer") return "/employer";
  if (status === "employee") return "/employee";
  return "/onboarding";
}

export function LandingPageClient({
  initialWalletAddress,
}: {
  initialWalletAddress?: string | null;
} = {}) {
  const router = useRouter();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const requestedLogin = useRef<number | null>(null);
  const queuedConnect = useRef(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "routing">("idle");
  const [loginRequested, setLoginRequested] = useState(false);
  const [activeTarget, setActiveTarget] = useState<"nav" | "hero">("hero");
  const isNavigatingRef = useRef(false);

  const isAuthenticated = auth.status === "authenticated" || (auth.status === "connecting" && Boolean(initialWalletAddress));

  // Prefetch dashboard routes so assets are immediately available in browser cache
  useEffect(() => {
    router.prefetch("/employer");
    router.prefetch("/employee");
    router.prefetch("/onboarding");
  }, [router]);

  // Restore explicit sign-in intent after an OAuth reload, never from auth alone.
  useEffect(() => {
    try {
      sessionStorage.removeItem("allocard_user_logging_in");
      const startedAt = Number(sessionStorage.getItem(LOGIN_INTENT_KEY));
      if (startedAt > 0 && startedAt <= Date.now() && Date.now() - startedAt < LOGIN_INTENT_TTL) {
        requestedLogin.current = startedAt;
        // Resume the explicit OAuth interaction stored before the page reload.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoginRequested(true);
      } else storeLoginIntent(null);
    } catch { /* Keep the in-memory flow usable when storage is unavailable. */ }
  }, []);

  const address = auth.status === "authenticated" ? auth.address : null;
  const principal = auth.status === "authenticated" ? auth.providerUserId : null;
  const openWorkspace = useCallback(async () => {
    if (!address || !principal || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    requestedLogin.current = null;
    storeLoginIntent(null);
    setRouteError(null);
    setPhase("routing");
    try {
      const profile = await queryClient.fetchQuery({
        queryKey: [...accountQueryKey(principal, address), "profile"],
        queryFn: () => withTimeout(getWalletProfile(address), "Could not open your workspace. Please try again."),
        staleTime: 15_000,
      });
      router.push(routeForStatus(profile.status));
    } catch (caught) {
      setRouteError(caught instanceof Error ? caught.message : "Could not open your workspace.");
      isNavigatingRef.current = false;
      setPhase("idle");
    }
  }, [address, principal, queryClient, router]);
  useEffect(() => {
    if (!requestedLogin.current) return;
    if (Date.now() - requestedLogin.current >= LOGIN_INTENT_TTL) {
      requestedLogin.current = null;
      queuedConnect.current = false;
      storeLoginIntent(null);
      return;
    }
    // Navigation follows the external Privy authentication event.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (address) void openWorkspace();
    else if (auth.status === "unauthenticated" && queuedConnect.current) {
      queuedConnect.current = false;
      auth.connect();
    }
  }, [address, openWorkspace, auth]);
  const handleGetStarted = (target: "nav" | "hero" = "hero") => {
    setActiveTarget(target);
    if (auth.status !== "authenticated") setLoginRequested(true);
    if (auth.status === "unauthenticated") {
      requestedLogin.current = Date.now();
      storeLoginIntent(requestedLogin.current);
      setRouteError(null);
      auth.connect();
    } else if (auth.status === "authenticated") {
      void openWorkspace();
    } else {
      queuedConnect.current = true;
      requestedLogin.current = Date.now();
      storeLoginIntent(requestedLogin.current);
    }
  };
  const signingIn = loginRequested && auth.status === "connecting";
  const isBusy = phase !== "idle" || signingIn;

  const renderNavButtonContent = () => {
    if (signingIn) return <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />Signing in…</span>;
    if (phase === "routing" && activeTarget === "nav") {
      return (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" />
          <span>Opening…</span>
        </span>
      );
    }
    if (isAuthenticated) {
      return <span>Dashboard</span>;
    }
    return <span>Enter App</span>;
  };

  const renderHeroButtonContent = () => {
    if (signingIn) return <span className="inline-flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Signing in…</span>;
    if (phase === "routing") {
      return (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin text-[#ffffff]" />
          <span>Opening dashboard…</span>
        </span>
      );
    }
    if (isAuthenticated) {
      return (
        <span className="inline-flex items-center justify-center gap-2">
          <span>Go to Dashboard</span>
          <ArrowRight className="size-4" />
        </span>
      );
    }
    return (
      <span className="inline-flex items-center justify-center gap-2">
        <span>Get Started</span>
        <ArrowRight className="size-4" />
      </span>
    );
  };

  return (
    <div className="landing landing-restored min-h-screen font-sans antialiased">

      {(routeError || (auth.status === "unauthenticated" && auth.error)) && (
        <p role="alert" className="fixed bottom-4 left-4 right-4 z-50 rounded-md border bg-[#ffffff] p-4 text-sm text-red-700 shadow-lg">{routeError || (auth.status === "unauthenticated" ? auth.error : "")}</p>
      )}
      <a className="landing-skip" href="#main">Skip to content</a>

      {/* ── Nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-[#eaeaea] bg-[#ffffff]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2 text-xl font-bold tracking-tight text-[#111111]">
            <Image src="/AllocardLogoBlack.svg" alt="Allocard Logo" width={28} height={28} />
            Allocard
          </a>
          <div className="hidden md:flex items-center gap-6">
            <a
              href="https://github.com/Stoneybro/Allocard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#666666] hover:text-[#111111] transition-colors"
            >
              GitHub
            </a>
            <a href="https://github.com/Stoneybro/Allocard#readme" target="_blank" rel="noopener noreferrer" className="text-sm text-[#666666] hover:text-[#111111] transition-colors">Documentation</a>
          </div>
          <Button
            id="nav-cta"
            onClick={() => handleGetStarted("nav")}
            disabled={isBusy}
            className={`h-8 px-4 rounded-md text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer ${
              isAuthenticated
                ? "bg-[#111111] text-[#ffffff] hover:bg-[#333333]"
                : "border border-[#eaeaea] bg-[#ffffff] text-[#111111] hover:bg-[#f7f7f7] hover:border-[#cccccc]"
            }`}
          >
            {renderNavButtonContent()}
          </Button>
        </div>
      </nav>

      <main id="main" className="pt-14">

        {/* ── Hero ── */}
        <section id="hero" className="max-w-6xl mx-auto px-6 pt-32 pb-16 flex flex-col items-center text-center">
          <h1 className="text-5xl sm:text-7xl font-bold tracking-[-0.04em] leading-[1.05] max-w-4xl mb-6 text-[#111111]">
            The corporate expense system<br className="hidden sm:block" /> for teams and autonomous AI.
          </h1>

          <p className="max-w-xl text-base sm:text-lg text-[#666666] leading-relaxed mb-10">
            Give employees and AI agents permission to spend within rules you control. Company funds stay in one treasury until a payment is made.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Button
              id="hero-try-demo"
              onClick={() => handleGetStarted("hero")}
              disabled={isBusy}
              className="h-10 px-6 rounded-md bg-[#111111] text-[#ffffff] text-sm font-medium hover:bg-[#333333] transition-colors disabled:opacity-60 cursor-pointer shadow-xs min-w-[170px]"
            >
              {renderHeroButtonContent()}
            </Button>
            <a
              id="hero-view-github"
              href="https://github.com/Stoneybro/Allocard"
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-6 rounded-md border border-[#eaeaea] text-[#444444] text-sm font-medium hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
              </svg>
              View on GitHub
            </a>
          </div>

          <p className="text-xs text-[#999999] mb-12">
            Built on NEAR Protocol
          </p>

          <div className="w-full max-w-4xl mx-auto flex items-center justify-center">
            <div className="relative w-full drop-shadow-[0_25px_60px_rgba(255,255,255,0.08)] transition-all duration-500 hover:scale-[1.01]">
              <Image
                src="/AllocardTreasuryCard.png"
                alt="Allocard spending authorization"
                width={1572}
                height={694}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </section>

        {/* ── Value Strip ── */}
        <section className="border-y border-[#eaeaea] bg-[#fafafa]">
          <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {[
              "Funds Stay in Your Treasury",
              "Onchain Access Revocation",
              "Multi-Chain Treasury Funding",
              "Google & Email Login",
              "Direct Treasury Payments",
            ].map((label) => (
              <span key={label} className="text-xs font-semibold text-[#666666] tracking-wide whitespace-nowrap">
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* ── Problem ── */}
        <section id="problem" className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-4">The Problem</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] leading-[1.1] text-[#111111] mb-5">
                Giving employees pre-funded wallets or shared company credentials puts your capital at risk.
              </h2>
              <p className="text-[#666666] leading-relaxed text-sm">
                Traditional setups force you to share company credentials or transfer funds directly into employee wallets. Both models surrender custody of company capital before anything is even purchased.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 pt-1">
              {[
                {
                  title: "Shared credentials lead to runaway charges",
                  body: "Broad spending access relies purely on trust. Forgotten subscriptions and unapproved charges only surface weeks later during reconciliation.",
                },
                {
                  title: "Upfront transfers lose treasury custody",
                  body: "Sending tokens directly to personal wallets puts company capital at risk. If private keys leak or funds are misspent, the money is already gone.",
                },
                {
                  title: "Rigid approvals slow teams down",
                  body: "Manual reimbursement cycles and multi-sig bottlenecks force employees to wait days just to pay for necessary software and services.",
                },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-lg border border-[#eaeaea] bg-[#fafafa]">
                  <p className="text-sm font-semibold text-[#111111] mb-1">{title}</p>
                  <p className="text-sm text-[#666666] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="border-t border-[#eaeaea] bg-[#fafafa]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-14">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-4">The Core Innovation</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[#111111] mb-4">
                Permissions under rules, not money transfers.
              </h2>
              <p className="max-w-xl mx-auto text-sm text-[#666666] leading-relaxed">
                Your capital stays in your company treasury. Spending permissions define how much employees can spend, which recipient accounts they can pay, and when access expires. Funds leave the treasury when a payment passes the contract’s checks.
              </p>
            </div>

            <div className="max-w-4xl mx-auto mb-16">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-4 text-center">
                Spending rules enforced onchain
              </p>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { title: "Hard Spending Caps", desc: "Set strict lifetime or periodic budget limits that cannot be exceeded." },
                  { title: "Recurring Allowances", desc: "Reset spending limits at fixed intervals from activation, within the total budget." },
                  { title: "Per-Transaction Caps", desc: "Prevent any single checkout from exceeding approved policy limits." },
                  { title: "Approved Recipients", desc: "Restrict payments to the NEAR recipient accounts selected by your company." },
                  { title: "Access Revocation", desc: "Revoke future spending and release the unused allowance after confirmation." },
                  { title: "Allowance Expiry", desc: "Set an expiry date to end access and release the unused allocation automatically." },
                ].map(({ title, desc }) => (
                  <div key={title} className="p-4 rounded-lg border border-[#eaeaea] bg-[#ffffff]">
                    <p className="text-sm font-semibold text-[#111111] mb-1">{title}</p>
                    <p className="text-xs text-[#666666] leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Spend Rails ── */}
        <section id="spend-rails" className="border-t border-[#eaeaea] bg-[#ffffff]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-14">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-4">Company Spending</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[#111111] mb-4">
                Manage spending from one company treasury.
              </h2>
              <p className="max-w-lg mx-auto text-sm text-[#666666] leading-relaxed">
                Pay vendors directly, configure employee allowances, and manage access through one dashboard.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {[
                {
                  tag: "Direct Spend",
                  pattern: "Direct vendor payment · Native NEAR & NEP-141 · Confirmed settlement",
                  title: "Pay vendors directly from company treasury.",
                  body: "Employees pay permitted recipients directly from the company treasury within their spending limits. The app shows settlement after the payment is confirmed on NEAR.",
                  engine: "Executed via native NEAR treasury delegation contracts with canonical SHA-256 dispatch envelopes.",
                },
                {
                  tag: "Cross-Chain Funding",
                  pattern: "Supported tokens and chains · Intent-based routing · Mainnet integration",
                  title: "Cross-chain funding with Aurora Intents.",
                  body: "Aurora Intents routes supported assets across chains without manual swaps and bridges. The testnet demo uses test USDC; cross-chain funding uses mainnet assets.",
                  engine: "Aurora Intents widget integration for cross-chain funding.",
                },
                {
                  tag: "Cryptographic Delegations",
                  pattern: "Periodic budgets · Vendor whitelists · Per-transaction caps",
                  title: "Grant spending authority without moving funds.",
                  body: "Assign scoped spending permissions with strict periodic resets, approved recipient whitelists, and per-checkout limits. Capital only leaves the treasury when rules are satisfied.",
                  engine: "Cryptographically bound to smart contract caveats with zero upfront capital transfer.",
                },
                {
                  tag: "AI Policy Setup",
                  pattern: "Plain English · User review · Contract-enforced rules",
                  title: "Define spending policies in plain English.",
                  body: "Describe budgets, recipients, and time limits in plain English. Review the proposed settings before signing, or configure them manually.",
                  engine: "NEAR AI Cloud proposes settings; Allocard validates them and the contracts enforce the signed rules.",
                },
              ].map(({ tag, pattern, title, body, engine }) => (
                <div key={tag} className="p-6 rounded-xl border border-[#eaeaea] bg-[#fafafa] flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="self-start text-xs font-semibold px-2.5 py-1 rounded-full border border-[#eaeaea] text-[#555555] bg-[#ffffff]">
                      {tag}
                    </span>
                    <span className="text-xs text-[#999999] mt-1">{pattern}</span>
                  </div>
                  <h3 className="text-base font-semibold text-[#111111] leading-snug">{title}</h3>
                  <p className="text-sm text-[#666666] leading-relaxed">{body}</p>
                  <div className="mt-auto pt-3 border-t border-[#eaeaea]">
                    <p className="text-xs text-[#888888] leading-relaxed">
                      <span className="font-semibold text-[#555555]">System: </span>{engine}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Delegation Canvas ── */}
        <section id="canvas" className="border-t border-[#eaeaea] bg-[#fafafa]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-4">Visual Spend Map</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[#111111] mb-4">
                See your company’s spending permissions.
              </h2>
              <p className="max-w-lg mx-auto text-sm text-[#666666] leading-relaxed">
                View your company treasury, employee permissions, and agent delegations in an interactive tree or table.
              </p>
            </div>

            <div className="w-full rounded-xl border border-[#eaeaea] overflow-hidden shadow-[0_4px_20px_rgb(0,0,0,0.04)] bg-[#ffffff]">
              <div className="border-b border-[#eaeaea] bg-[#fafafa] px-4 py-2.5 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#e0e0e0]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#e0e0e0]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#e0e0e0]" />
                </div>
                <span className="text-xs text-[#999999] ml-2 font-medium">Allocard Visual Spending Canvas</span>
              </div>
              <Image
                src="/delegationCanvas.png"
                alt="Allocard delegation canvas"
                width={1200}
                height={600}
                className="w-full h-auto"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mt-6">
              {[
                { title: "Central Treasury", body: "View your company balance and every active spending authorization in one central interactive canvas." },
                { title: "Granular Authorizations", body: "Set employee budgets and permitted recipients, and inspect the agents delegated under each employee." },
                { title: "Cascading Revocation", body: "Revoke an employee permission to stop future spending across its agent branch and release the unused allocation." },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-lg border border-[#eaeaea] bg-[#ffffff]">
                  <p className="text-sm font-semibold text-[#111111] mb-1">{title}</p>
                  <p className="text-sm text-[#666666] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Enterprise Sovereignty ── */}
        <section id="sovereignty" className="border-t border-[#eaeaea] bg-[#ffffff]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-4">Complete Ownership</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[#111111] mb-4">
                A corporate spend system you truly own.
              </h2>
              <p className="text-sm text-[#666666] leading-relaxed mb-4">
                Your company controls its funds and spending permissions inside the shared NEAR treasury contract. The company owner decides who can spend and sets their limits.
              </p>
              <p className="text-sm text-[#666666] leading-relaxed">
                Allocard has no retained contract administrator key to withdraw company funds or rewrite spending rules. Payments require the appropriate signed authority and must pass the contract’s checks.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  title: "Company-Controlled Funds",
                  body: "Company balances and permissions are isolated in the shared treasury. Employees spend through bounded permissions; unused allowances remain under company control.",
                },
                {
                  title: "AI Policy Extraction",
                  body: "NEAR AI Cloud translates spending instructions into settings for you to review and sign. The contract enforces the supported limits and recipient rules.",
                },
                {
                  title: "Onchain Spending Records",
                  body: "Signed permission creation, revocation, and payment execution can be inspected on NEAR. Company activity views connect these actions to your team.",
                },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-lg border border-[#eaeaea] bg-[#fafafa]">
                  <p className="text-sm font-semibold text-[#111111] mb-1">{title}</p>
                  <p className="text-sm text-[#666666] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

        {/* ── Closing CTA ── */}
        <section id="cta" className="border-t border-[#eaeaea] bg-[#fafafa]">
          <div className="max-w-6xl mx-auto px-6 py-24 flex flex-col items-center text-center">
            <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[#999999] mb-5">
              Email sign-in · Sponsored gas · Contract-enforced permissions
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] leading-[1.05] max-w-xl text-[#111111] mb-5">
              Take total control of your company spend today.
            </h2>
            <p className="text-sm text-[#666666] max-w-md mb-10 leading-relaxed">
              Sign in with email or Google, activate your company treasury, and give employees permission to spend within your rules.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                id="closing-try-demo"
                onClick={() => handleGetStarted("hero")}
                disabled={isBusy}
                className="h-10 px-6 rounded-md bg-[#111111] text-[#ffffff] text-sm font-medium hover:bg-[#333333] transition-colors disabled:opacity-60 cursor-pointer shadow-xs min-w-[170px]"
              >
                {renderHeroButtonContent()}
              </Button>
              <a
                id="closing-view-github"
                href="https://github.com/Stoneybro/Allocard"
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 px-6 rounded-md border border-[#eaeaea] text-[#444444] text-sm font-medium hover:border-[#cccccc] hover:bg-[#ffffff] transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
                </svg>
                View on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#eaeaea] bg-[#ffffff]">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/AllocardLogoBlack.svg" alt="Allocard Logo" width={20} height={20} />
            <span className="text-sm font-semibold text-[#111111]">Allocard</span>
          </div>
          <p className="text-xs text-[#999999] text-center">
            NEAR contracts · Shared treasury · Employee and agent permissions.
          </p>
          <a
            href="https://github.com/Stoneybro/Allocard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#999999] hover:text-[#111111] transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
