"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Moon, Sun } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useQueryClient } from "@tanstack/react-query";
import { accountQueryKey } from "@/lib/query-keys";
import { getWalletProfile } from "@/app/actions/identity";
import { withTimeout } from "@/lib/request-timeout";
import Image from "next/image";
import { Button } from "@/components/ui/button";

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
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("allocard-landing-theme");
      if (saved === "light" || saved === "dark") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTheme(saved);
      }
    } catch { /* Keep the default when browser storage is unavailable. */ }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("allocard-landing-theme", next);
    } catch { /* Switching still works when browser storage is unavailable. */ }
  };
  const auth = useAuth();
  const queryClient = useQueryClient();
  const requestedLogin = useRef(false);
  const queuedConnect = useRef(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "routing">("idle");
  const [activeTarget, setActiveTarget] = useState<"nav" | "hero">("hero");
  const isNavigatingRef = useRef(false);

  const isAuthenticated = auth.status === "authenticated" || (auth.status === "connecting" && Boolean(initialWalletAddress));

  // Prefetch dashboard routes so assets are immediately available in browser cache
  useEffect(() => {
    router.prefetch("/employer");
    router.prefetch("/employee");
    router.prefetch("/onboarding");
  }, [router]);

  // Clean any legacy sessionStorage keys
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("allocard_user_logging_in");
    }
  }, []);

  const address = auth.status === "authenticated" ? auth.address : null;
  const principal = auth.status === "authenticated" ? auth.providerUserId : null;
  const openWorkspace = useCallback(async () => {
    if (!address || !principal || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    requestedLogin.current = false;
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
    if (auth.status === "unauthenticated") {
      requestedLogin.current = true;
      setRouteError(null);
      auth.connect();
    } else if (auth.status === "authenticated") {
      void openWorkspace();
    } else {
      queuedConnect.current = true;
      requestedLogin.current = true;
    }
  };
  const isBusy = phase !== "idle";

  const renderNavButtonContent = () => {
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
    if (phase === "routing") {
      return (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin text-[var(--landing-tone-000000)]" />
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
    <div data-theme={theme} className="landing landing-restored min-h-screen font-sans antialiased">

      {(routeError || (auth.status === "unauthenticated" && auth.error)) && (
        <p role="alert" className="fixed bottom-4 left-4 right-4 z-50 rounded-md border bg-[var(--landing-tone-000000)] p-4 text-sm text-red-700 shadow-lg">{routeError || (auth.status === "unauthenticated" ? auth.error : "")}</p>
      )}
      <a className="landing-skip" href="#main">Skip to content</a>

      {/* ── Nav ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--landing-tone-eeeeee)]">
            <Image src="/AllocardLogoBlack.svg" alt="Allocard Logo" width={28} height={28} />
            Allocard
          </a>
          <div className="hidden md:flex items-center gap-6">
            <a
              href="https://github.com/Stoneybro/Allocard"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--landing-tone-999999)] hover:text-[var(--landing-tone-eeeeee)] transition-colors"
            >
              GitHub
            </a>
            <a href="" onClick={(event) => event.preventDefault()} className="text-sm text-[var(--landing-tone-999999)] hover:text-[var(--landing-tone-eeeeee)] transition-colors">Documentation</a>
          </div>
          <div className="landing-nav-actions">
          <button
            id="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          </button>
          <Button
            id="nav-cta"
            onClick={() => handleGetStarted("nav")}
            disabled={isBusy}
            className={`h-8 px-4 rounded-md text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer ${
              isAuthenticated
                ? "bg-[var(--landing-tone-eeeeee)] text-[var(--landing-tone-000000)] hover:bg-[var(--landing-tone-cccccc)]"
                : "border border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)] text-[var(--landing-tone-eeeeee)] hover:bg-[var(--landing-tone-080808)] hover:border-[var(--landing-tone-333333)]"
            }`}
          >
            {renderNavButtonContent()}
          </Button>
          </div>
        </div>
      </nav>

      <main id="main" className="pt-14">

        {/* ── Hero ── */}
        <section id="hero" className="max-w-6xl mx-auto px-6 pt-32 pb-16 flex flex-col items-center text-center">
          <h1 className="text-5xl sm:text-7xl font-bold tracking-[-0.04em] leading-[1.05] max-w-4xl mb-6 text-[var(--landing-tone-eeeeee)]">
            The corporate expense system<br className="hidden sm:block" /> for teams and autonomous AI.
          </h1>

          <p className="max-w-xl text-base sm:text-lg text-[var(--landing-tone-999999)] leading-relaxed mb-10">
            Give employees and AI agents permission to spend within rules you control. No shared cards, no pre-funded wallets, and no paperwork.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Button
              id="hero-try-demo"
              onClick={() => handleGetStarted("hero")}
              disabled={isBusy}
              className="h-10 px-6 rounded-md bg-[var(--landing-tone-eeeeee)] text-[var(--landing-tone-000000)] text-sm font-medium hover:bg-[var(--landing-tone-cccccc)] transition-colors disabled:opacity-60 cursor-pointer shadow-xs min-w-[170px]"
            >
              {renderHeroButtonContent()}
            </Button>
            <a
              id="hero-view-github"
              href="https://github.com/Stoneybro/Allocard"
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-6 rounded-md border border-[var(--landing-tone-151515)] text-[var(--landing-tone-bbbbbb)] text-sm font-medium hover:border-[var(--landing-tone-333333)] hover:bg-[var(--landing-tone-050505)] transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
              </svg>
              View on GitHub
            </a>
          </div>

          <p className="text-xs text-[var(--landing-tone-666666)] mb-12">
            Built on NEAR Protocol
          </p>

          <div className="w-full max-w-4xl mx-auto flex items-center justify-center">
            <div className="relative w-full drop-shadow-[0_25px_60px_rgba(255,255,255,0.08)] transition-all duration-500 hover:scale-[1.01]">
              <Image
                src="/Allocardmodelcard.png"
                alt="Allocard virtual spending card"
                width={1572}
                height={694}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </section>

        {/* ── Value Strip ── */}
        <section className="border-y border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)]">
          <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {[
              "Zero Money Sent Upfront",
              "Instant 1-Click Revocation",
              "Native NEAR Account Auth",
              "Automated AI Receipt Auditing",
              "Instant Global Settlements",
            ].map((label) => (
              <span key={label} className="text-xs font-semibold text-[var(--landing-tone-999999)] tracking-wide whitespace-nowrap">
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* ── Problem ── */}
        <section id="problem" className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-4">The Problem</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] leading-[1.1] text-[var(--landing-tone-eeeeee)] mb-5">
                Giving employees and AI agents cards or pre-funded wallets puts your capital at risk.
              </h2>
              <p className="text-[var(--landing-tone-999999)] leading-relaxed text-sm">
                Traditional setups force you to hand out shared credit cards or transfer funds directly into employee wallets. Both models give up custody of company capital before anything is even purchased.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 pt-1">
              {[
                {
                  title: "Shared cards lead to runaway charges",
                  body: "Broad credit limits rely on trust. Forgotten subscriptions and unapproved charges only surface weeks later during end-of-month reviews.",
                },
                {
                  title: "Upfront transfers lose treasury custody",
                  body: "Sending tokens directly to employee wallets puts company capital at risk. If a private key leaks or money is misspent, the funds are already gone.",
                },
                {
                  title: "AI agents cannot safely hold funds",
                  body: "Giving an autonomous bot an open credit card or pre-funded wallet is dangerous. One loop or bad prompt can drain your account.",
                },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-lg border border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)]">
                  <p className="text-sm font-semibold text-[var(--landing-tone-eeeeee)] mb-1">{title}</p>
                  <p className="text-sm text-[var(--landing-tone-999999)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section id="how-it-works" className="border-t border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-14">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-4">The Core Innovation</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[var(--landing-tone-eeeeee)] mb-4">
                Permissions under rules, not money transfers.
              </h2>
              <p className="max-w-xl mx-auto text-sm text-[var(--landing-tone-999999)] leading-relaxed">
                Instead of sending funds to an employee or card, your capital stays 100% in your company treasury contract. You grant cryptographic permissions that define exactly what can be bought, up to what cap, and on what schedule. Funds only leave your treasury when a valid transaction matches your rules.
              </p>
            </div>

            <div className="max-w-4xl mx-auto mb-16">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-4 text-center">
                Spending rules enforced onchain
              </p>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { title: "Hard Spending Caps", desc: "Set strict lifetime or periodic budget limits that cannot be exceeded." },
                  { title: "Rolling Periodic Budgets", desc: "Reset team allowances automatically weekly or monthly with zero manual top-ups." },
                  { title: "Per-Transaction Caps", desc: "Prevent any single checkout from exceeding approved policy limits." },
                  { title: "Approved Vendor Whitelists", desc: "Restrict spending authority exclusively to verified vendor accounts or contracts." },
                  { title: "Instant 1-Click Revocation", desc: "Cancel or freeze any spending permission instantly with zero stranded cash." },
                  { title: "AI Agent Sub-Delegations", desc: "Empower autonomous software agents to buy tools within strict mathematical caps." },
                ].map(({ title, desc }) => (
                  <div key={title} className="p-4 rounded-lg border border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)]">
                    <p className="text-sm font-semibold text-[var(--landing-tone-eeeeee)] mb-1">{title}</p>
                    <p className="text-xs text-[var(--landing-tone-999999)] leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Spend Rails ── */}
        <section id="spend-rails" className="border-t border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-14">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-4">Universal Spending Rails</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[var(--landing-tone-eeeeee)] mb-4">
                Every way modern companies spend, unified.
              </h2>
              <p className="max-w-lg mx-auto text-sm text-[var(--landing-tone-999999)] leading-relaxed">
                One company treasury powers direct vendor payments, instant expense reimbursements, overseas contractor payouts, and autonomous AI procurement.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {[
                {
                  tag: "Direct Spend",
                  pattern: "Direct vendor payment · Native NEAR & NEP-141 · Sub-second finality",
                  title: "Pay vendors directly from company treasury.",
                  body: "Employees execute direct business payments within their delegated cap. The exact amount settles in under two seconds on NEAR directly from the company treasury.",
                  engine: "Executed via native NEAR treasury delegation contracts with canonical SHA-256 dispatch envelopes.",
                },
                {
                  tag: "Instant AI Reimbursements",
                  pattern: "Snap receipt · Vision AI extracts items · Instant payout",
                  title: "No more waiting weeks for expense reports.",
                  body: "Employees upload a photo of an out-of-pocket receipt. Vision AI reads the merchant, date, and items, validates policy compliance, and settles the claim in seconds.",
                  engine: "Powered by Alibaba Cloud Qwen 2.5 VL with automated natural-language policy matching.",
                },
                {
                  tag: "Global Remittances",
                  pattern: "Overseas invoices · Live mid-market FX · Zero wire fees",
                  title: "Pay global talent without $45 bank wire fees.",
                  body: "Settle international invoices instantly using digital dollar stables on NEAR. Eliminates multi-day correspondent bank delays and expensive foreign exchange spreads.",
                  engine: "Settles on NEAR in sub-second finality with live multi-currency conversion.",
                },
                {
                  tag: "Cloud & Tooling Agent",
                  pattern: "Scoped micro-budget · AI scours plans · Autonomous procurement",
                  title: "Autonomous tool procurement for your team.",
                  body: "Employees assign a portion of their authorized budget to our Cloud & Tooling Agent to compare and purchase developer infrastructure across NEAR ecosystem partners.",
                  engine: "Cryptographically bound to its cap: impossible for the agent to overspend.",
                },
              ].map(({ tag, pattern, title, body, engine }) => (
                <div key={tag} className="p-6 rounded-xl border border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)] flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="self-start text-xs font-semibold px-2.5 py-1 rounded-full border border-[var(--landing-tone-151515)] text-[var(--landing-tone-aaaaaa)] bg-[var(--landing-tone-000000)]">
                      {tag}
                    </span>
                    <span className="text-xs text-[var(--landing-tone-666666)] mt-1">{pattern}</span>
                  </div>
                  <h3 className="text-base font-semibold text-[var(--landing-tone-eeeeee)] leading-snug">{title}</h3>
                  <p className="text-sm text-[var(--landing-tone-999999)] leading-relaxed">{body}</p>
                  <div className="mt-auto pt-3 border-t border-[var(--landing-tone-151515)]">
                    <p className="text-xs text-[var(--landing-tone-777777)] leading-relaxed">
                      <span className="font-semibold text-[var(--landing-tone-aaaaaa)]">System: </span>{engine}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Delegation Canvas ── */}
        <section id="canvas" className="border-t border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="text-center mb-12">
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-4">Visual Spend Map</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[var(--landing-tone-eeeeee)] mb-4">
                Your entire company spend, live on canvas.
              </h2>
              <p className="max-w-lg mx-auto text-sm text-[var(--landing-tone-999999)] leading-relaxed">
                Replace rigid spreadsheets with an interactive visual tree showing your company treasury, active employee allowances, and AI agent delegations in real time.
              </p>
            </div>

            <div className="w-full rounded-xl border border-[var(--landing-tone-151515)] overflow-hidden shadow-[0_4px_20px_rgb(255,255,255,0.04)] bg-[var(--landing-tone-000000)]">
              <div className="border-b border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)] px-4 py-2.5 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--landing-tone-1f1f1f)]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--landing-tone-1f1f1f)]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--landing-tone-1f1f1f)]" />
                </div>
                <span className="text-xs text-[var(--landing-tone-666666)] ml-2 font-medium">Allocard Visual Spending Canvas</span>
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
                { title: "Central Treasury", body: "View your company balance and every active spending authorization in one central map." },
                { title: "Composable Permissions", body: "Allowances flow from company to employees, and from employees to their AI assistants." },
                { title: "Instant Cascading Revocation", body: "Revoking an employee instantly terminates all child budgets and agent permissions attached to them." },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-lg border border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)]">
                  <p className="text-sm font-semibold text-[var(--landing-tone-eeeeee)] mb-1">{title}</p>
                  <p className="text-sm text-[var(--landing-tone-999999)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Enterprise Sovereignty ── */}
        <section id="sovereignty" className="border-t border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)]">
          <div className="max-w-6xl mx-auto px-6 py-24">
            <div className="grid md:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-4">Complete Ownership</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-[-0.03em] text-[var(--landing-tone-eeeeee)] mb-4">
                A corporate spend system you truly own.
              </h2>
              <p className="text-sm text-[var(--landing-tone-999999)] leading-relaxed mb-4">
                Allocard delivers the power of modern corporate cards without handing custody to third parties. Your treasury contract runs directly on NEAR with zero intermediaries.
              </p>
              <p className="text-sm text-[var(--landing-tone-999999)] leading-relaxed">
                Your funds stay in your custody. Your rules remain under your control. You get the speed of modern automation with the safety of cryptographic guarantees.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {[
                {
                  title: "Zero Custody Risk",
                  body: "Allocard never holds your funds. Everything runs on your native NEAR treasury contract. We cannot freeze your balance or alter your rules.",
                },
                {
                  title: "Private Policy AI",
                  body: "Company expense policies and receipts are evaluated privately with zero data retention using Alibaba Cloud Qwen AI.",
                },
                {
                  title: "Tamper-Proof Audit Trail",
                  body: "Every authorization, budget adjustment, and payment is permanently logged and verifiable on NEAR.",
                },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-lg border border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)]">
                  <p className="text-sm font-semibold text-[var(--landing-tone-eeeeee)] mb-1">{title}</p>
                  <p className="text-sm text-[var(--landing-tone-999999)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

        {/* ── Closing CTA ── */}
        <section id="cta" className="border-t border-[var(--landing-tone-151515)] bg-[var(--landing-tone-050505)]">
          <div className="max-w-6xl mx-auto px-6 py-24 flex flex-col items-center text-center">
            <p className="text-xs font-semibold tracking-[0.15em] uppercase text-[var(--landing-tone-666666)] mb-5">
              Ready in two minutes · Native NEAR accounts · Cryptographic delegation
            </p>
            <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] leading-[1.05] max-w-xl text-[var(--landing-tone-eeeeee)] mb-5">
              Take total control of your company spend today.
            </h2>
            <p className="text-sm text-[var(--landing-tone-999999)] max-w-md mb-10 leading-relaxed">
              Connect your NEAR account, deploy your company treasury contract, and issue your first spending permission in under sixty seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                id="closing-try-demo"
                onClick={() => handleGetStarted("hero")}
                disabled={isBusy}
                className="h-10 px-6 rounded-md bg-[var(--landing-tone-eeeeee)] text-[var(--landing-tone-000000)] text-sm font-medium hover:bg-[var(--landing-tone-cccccc)] transition-colors disabled:opacity-60 cursor-pointer shadow-xs min-w-[170px]"
              >
                {renderHeroButtonContent()}
              </Button>
              <a
                id="closing-view-github"
                href="https://github.com/Stoneybro/Allocard"
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 px-6 rounded-md border border-[var(--landing-tone-151515)] text-[var(--landing-tone-bbbbbb)] text-sm font-medium hover:border-[var(--landing-tone-333333)] hover:bg-[var(--landing-tone-000000)] transition-colors flex items-center justify-center gap-2"
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
      <footer className="border-t border-[var(--landing-tone-151515)] bg-[var(--landing-tone-000000)]">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/AllocardLogoBlack.svg" alt="Allocard Logo" width={20} height={20} />
            <span className="text-sm font-semibold text-[var(--landing-tone-eeeeee)]">Allocard</span>
          </div>
          <p className="text-xs text-[var(--landing-tone-666666)] text-center">
            NEAR Protocol · Built on NEAR with native treasury delegation contracts and AI agents.
          </p>
          <a
            href="https://github.com/Stoneybro/Allocard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--landing-tone-666666)] hover:text-[var(--landing-tone-eeeeee)] transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
