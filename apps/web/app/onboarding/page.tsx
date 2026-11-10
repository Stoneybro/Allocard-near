"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Loader2, LogOut, RefreshCw, Users } from "lucide-react";
import { useWorkspaceOptions, useAccountScope } from "@/hooks/use-account-queries";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { ConnectRequiredCard } from "@/components/auth-state";
import { acceptEmployeeMembership, createEmployerAccount, setWorkspaceContext, type WalletProfile } from "@/app/actions/identity";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";



export default function OnboardingPage() {
  const auth = useAuth();
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const actionInFlight = useRef(false);
  const address = auth.status === "authenticated" ? auth.address : null;
  const workspaces = useWorkspaceOptions();
  const memberships = workspaces.data?.memberships ?? [];
  const pending = workspaces.data?.pending ?? [];
  const loading = auth.status === "connecting" || (!!address && workspaces.isPending);
  const loadError = workspaces.error?.message ?? null;
  const queryClient = useQueryClient();
  const { key } = useAccountScope();

  const performAction = (actionKey: string, action: () => Promise<WalletProfile>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActiveAction(actionKey);
    setActionError(null);
    startTransition(async () => {
      try {
        const profile = await action();
        if ((profile.status !== "employer" && profile.status !== "employee") || !profile.company) {
          throw new Error("Your workspace is not ready. Please try again.");
        }
        // Replace the pre-onboarding profile before dashboard guards can read it.
        // Cancel old reads so they cannot overwrite the confirmed membership.
        await queryClient.cancelQueries({ queryKey: key });
        await queryClient.invalidateQueries({ queryKey: key, refetchType: "none" });
        queryClient.setQueryData([...key, "profile"], profile);
        router.replace(`/${profile.status}`);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      } finally {
        actionInFlight.current = false;
        setActiveAction(null);
      }
    });
  };

  if (auth.status === "unauthenticated") {
    return <ConnectRequiredCard title="Sign in to Allocard" description="Use Google or email to create or join a company workspace." />;
  }

  const busy = loading || isPending;
  const hasEmployerWorkspace = memberships.some((membership) => membership.canEmployer);
  const email = auth.status === "authenticated" ? auth.email : null;

  return (
    <main className="min-h-dvh bg-muted/30 text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight" aria-label="Allocard home">
            <Image src="/AllocardLogoBlack.svg" alt="" width={28} height={28} />
            <span className="hidden min-[380px]:inline">Allocard</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <div className="min-w-0 text-right">
              <p className="text-[11px] text-muted-foreground">Signed in as</p>
              <div className="flex h-5 items-center justify-end">
                {email ? <span className="truncate text-sm font-medium" title={email}>{email}</span> : <Skeleton className="h-4 w-36" />}
              </div>
            </div>
            <Button variant="ghost" size="sm" disabled={auth.status !== "authenticated" || isPending} onClick={() => { if (auth.status === "authenticated") void auth.disconnect(); }}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <div className="mb-8 max-w-xl space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Your workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Welcome to Allocard</h1>
          <p className="text-sm leading-6 text-muted-foreground sm:text-base">Create a company to manage team spending, or join the team that invited you.</p>
        </div>
        {actionError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Could not complete that action</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
        <div className="grid items-stretch gap-6 md:grid-cols-2">
          <Card className="min-h-[520px] gap-6 rounded-2xl bg-background py-7 shadow-none sm:py-8">
            <CardHeader className="gap-2 px-6 sm:px-8">
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-muted/50"><Building2 className="size-5" /></div>
              <CardTitle className="text-xl font-semibold tracking-tight">{hasEmployerWorkspace ? "Your companies" : "Create a company"}</CardTitle>
              <CardDescription className="leading-6">{hasEmployerWorkspace ? "Open a workspace to manage your team and spending permissions." : "Set budgets, add your team, and manage spending in one place."}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col px-6 sm:px-8" aria-busy={loading}>
              {loading ? (
                <div className="flex flex-1 flex-col gap-3" role="status">
                  <span className="sr-only">Loading your workspaces</span>
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="mt-3 h-11 w-full" />
                </div>
              ) : loadError ? (
                <Alert variant="destructive">
                  <AlertTitle>Workspaces could not load</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : hasEmployerWorkspace ? (
                <div className="flex flex-col gap-3">
                  {memberships.filter((membership) => membership.canEmployer).map((membership) => (
                    <div key={membership.companyId} className="space-y-4 rounded-xl border bg-muted/20 p-4">
                      <h2 className="break-words font-medium">{membership.companyName}</h2>
                      <Button className="w-full" disabled={busy} onClick={() => performAction(membership.companyId + "employer", async () => {
                        return setWorkspaceContext({ walletAddress: address!, companyId: membership.companyId, role: "employer" });
                      })}>
                        {activeAction === membership.companyId + "employer" ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                        Open company dashboard
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <form className="flex flex-1 flex-col gap-5" onSubmit={(event) => {
                  event.preventDefault();
                  if (busy || !address || companyName.trim().length < 2) return;
                  const formattedName = companyName.trim().split(" ").map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : "").join(" ");
                  performAction("create", async () => {
                    const profile = await createEmployerAccount({ walletAddress: address, companyName: formattedName });
                    toast.success("Company Account Created", { description: `${formattedName} workspace is ready.` });
                    return profile;
                  });
                }}>
                  <fieldset disabled={busy} className="flex min-w-0 flex-col gap-2.5">
                    <Label htmlFor="company-name">Company name</Label>
                    <Input id="company-name" name="companyName" placeholder="e.g. Acme Labs" autoComplete="organization" required minLength={2} maxLength={80} value={companyName} onChange={(event) => setCompanyName(event.target.value)} className="h-10 bg-background" />
                  </fieldset>
                  <Button className="mt-auto h-11 w-full" type="submit" disabled={busy || companyName.trim().length < 2}>
                    {activeAction === "create" ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                    {activeAction === "create" ? "Creating company…" : "Create company account"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
          <Card className="min-h-[520px] gap-6 rounded-2xl bg-background py-7 shadow-none sm:py-8">
            <CardHeader className="gap-2 px-6 sm:px-8">
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl border bg-muted/50"><Users className="size-5" /></div>
              <CardTitle className="text-xl font-semibold tracking-tight">Join a company</CardTitle>
              <CardDescription className="leading-6">Company invitations appear here.</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-44 flex-1 flex-col gap-4 px-6 sm:px-8" aria-busy={loading}>
              {loading ? (
                <div className="space-y-3" role="status">
                  <span className="sr-only">Checking company invitations</span>
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : loadError ? (
                <p className="text-sm leading-6 text-muted-foreground">We couldn’t check your invitations. Refresh access to try again.</p>
              ) : (
                <>
                  {memberships.filter((membership) => membership.canEmployee).map((membership) => (
                    <div key={membership.companyId} className="space-y-3 rounded-xl border bg-muted/20 p-4">
                      <h2 className="break-words font-medium">{membership.companyName}</h2>
                      <Button variant="outline" className="w-full" disabled={busy} onClick={() => performAction(membership.companyId + "employee", async () => {
                        return setWorkspaceContext({ walletAddress: address!, companyId: membership.companyId, role: "employee" });
                      })}>
                        {activeAction === membership.companyId + "employee" ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                        Open employee dashboard
                      </Button>
                    </div>
                  ))}
                  {pending.map((membership) => (
                    <div key={membership.id} className="space-y-3 rounded-xl border bg-muted/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 break-words font-medium">{membership.companyName}</h2>
                        <Badge variant="secondary" className="shrink-0">Invitation</Badge>
                      </div>
                      <Button className="w-full" disabled={busy} onClick={() => performAction(membership.id, async () => {
                        const profile = await acceptEmployeeMembership({ walletAddress: address!, companyId: membership.companyId });
                        toast.success("Invitation Accepted", { description: `You have joined ${membership.companyName}.` });
                        return profile;
                      })}>
                        {activeAction === membership.id ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                        Accept invitation
                      </Button>
                    </div>
                  ))}
                  {pending.length === 0 && !memberships.some((membership) => membership.canEmployee) && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">No invitations yet</p>
                      <p className="text-sm leading-6 text-muted-foreground">Ask your employer to add <strong className="break-all font-semibold text-foreground">{email}</strong> in their dashboard, then refresh access to see your invitation.</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
            <CardFooter className="px-6 pb-7 pt-0 sm:px-8 sm:pb-8">
              <Button variant="outline" className="h-11 w-full" disabled={busy || isRefreshing || workspaces.isFetching} onClick={async () => {
                setIsRefreshing(true);
                try { await workspaces.refetch(); }
                finally { setIsRefreshing(false); }
              }}>
                <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
                {isRefreshing ? "Refreshing…" : loadError ? "Try again" : "Refresh access"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  );
}
