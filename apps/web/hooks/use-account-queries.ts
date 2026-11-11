"use client";

import { useCallback, useEffect, useMemo, type SetStateAction } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { accountQueryKey } from "@/lib/query-keys";
import { withTimeout } from "@/lib/request-timeout";
import { getWorkspaceOptions, type WalletProfile } from "@/app/actions/identity";
import { refreshSpendingQueries } from "@/lib/refresh-queries";
import { dashboardRead } from "@/lib/dashboard-read";

export function useAccountScope() {
  const auth = useAuth();
  const address = auth.status === "authenticated" ? auth.address : null;
  const providerUserId = auth.status === "authenticated" ? auth.providerUserId : null;
  const key = useMemo(() => accountQueryKey(providerUserId, address), [providerUserId, address]);
  return { address, key };
}

export function useWorkspaceOptions() {
  const { address, key } = useAccountScope();
  return useQuery({
    queryKey: [...key, "workspaces"], enabled: !!address, refetchOnWindowFocus: "always",
    queryFn: () => withTimeout(getWorkspaceOptions(address!), "Workspaces took too long to load. Please try again."),
  });
}

/** Profile, company selection, permissions, team, policy and budgets share one cache. */
export function useDashboardData<T extends { company: { id: string } }>(
  role: "employer" | "employee",
  initialProfile?: WalletProfile | null, initialDashboard?: T | null,
) {
  const router = useRouter();
  const client = useQueryClient();
  const { address, key } = useAccountScope();
  const profileKey = useMemo(() => [...key, "profile"] as const, [key]);
  const matchingInitial = !!address && initialProfile?.user?.walletAddress === address;
  const profileQuery = useQuery<WalletProfile | null>({
    queryKey: profileKey, enabled: !!address, refetchOnWindowFocus: "always",
    queryFn: ({ signal }) => dashboardRead<WalletProfile | null>("profile", address!, signal),
    initialData: matchingInitial ? initialProfile : undefined,
  });
  const profile = address ? profileQuery.data ?? null : null;
  const companyId = profile?.company?.id ?? null;
  const dashboardKey = useMemo(() => [...key, "dashboard", role, companyId] as const, [key, role, companyId]);
  const dashboardQuery = useQuery<T | null>({
    refetchOnWindowFocus: "always", queryKey: dashboardKey, enabled: !!address && profile?.status === role && !!companyId,
    queryFn: ({ signal }) => dashboardRead<T | null>(role, address!, signal),
    initialData: matchingInitial && initialDashboard?.company.id === companyId ? initialDashboard : undefined,
  });
  useEffect(() => {
    if (!address || !profile) return;
    if (profile.status === "new" || profile.status === "picker" || !profile.company) router.replace("/onboarding");
    else if (profile.status !== role) router.replace(`/${profile.status}`);
  }, [address, profile, role, router]);

  const setProfile = useCallback((update: SetStateAction<WalletProfile | null>) => {
    if (!client.getQueryState(profileKey)) return;
    client.setQueryData<WalletProfile | null>(profileKey, current => typeof update === "function" ? update(current ?? null) : update);
  }, [client, profileKey]);
  const setDashboardState = useCallback((update: SetStateAction<T | null>) => {
    if (!client.getQueryState(dashboardKey)) return;
    client.setQueryData<T | null>(dashboardKey, current => typeof update === "function" ? update(current ?? null) : update);
  }, [client, dashboardKey]);
  const invalidate = useCallback(() => refreshSpendingQueries(client, key),
    [client, key]);
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<T>) => operation(), retry: false,
    onSuccess: async result => { await client.cancelQueries({ queryKey: dashboardKey }); setDashboardState(result); void refreshSpendingQueries(client, key, false).catch(() => undefined); },
  });
  return {
    profile, setProfile, dashboardState: address ? dashboardQuery.data ?? null : null,
    setDashboardState, refresh: invalidate, mutate: mutation.mutateAsync,
    isFetching: profileQuery.isFetching || dashboardQuery.isFetching,
    error: profileQuery.error ?? dashboardQuery.error,
  };
}

/** Refresh once after settlement; a confirmed write is not a reason to poll every query. */
export function useSettlementRefresh() {
  const client = useQueryClient();
  const { key } = useAccountScope();
  return useCallback(() => { void refreshSpendingQueries(client, key).catch(() => undefined); }, [client, key]);
}
