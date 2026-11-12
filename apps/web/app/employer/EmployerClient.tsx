"use client";

import { useSettlementRefresh } from "@/hooks/use-account-queries";
import { prepareRootPermission, releaseUnsubmittedRootPermission, matchingRootTerms, assertRootPermissionRetrySafe } from "@/lib/root-permission-intent";
import { buildPolicySpec, emptyCaveatForm, hasFormErrors, splitAddresses, validateCaveatForm, type CaveatForm } from "@/lib/policy-configuration";
import { PolicyConfigurationDrawer } from "./PolicyConfigurationDrawer";
import { describePolicyActivationError } from "@/lib/policy-activation-error";
import { readPendingNearTransaction } from "@/lib/near-pending-transaction";
import { DashboardLoading } from "@/components/dashboard-loading";

import { useDashboardData, useAccountScope } from "@/hooks/use-account-queries";
import { useQuery } from "@tanstack/react-query";
import { withTimeout } from "@/lib/request-timeout";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  LayoutGridIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ACTIVATION_USDC, FAUCET_USDC, MOCK_USDC_ACCOUNT_ID, NEAR_DECIMALS, SPENDING_DECIMALS, SPENDING_ASSET, TOKEN_SYMBOL, getAddressExplorerUrl, getTxExplorerUrl } from "@/lib/chain";
import { formatWalletAddress } from "@/lib/wallet";
import { parseTreasuryReference, type PermissionSpec } from "@allocard/delegation-sdk";
import {
  getUnifiedNearCaller,
  createNearRpcCaller,
  getTreasuryClient,
  parseTokenAmount,
  formatTokenAmount,
} from "@/lib/near";
import {
  activateDelegation,
  createEmployeeDelegation,
  addEmployeeByEmail,
  getCompanyDashboardState,
  setWorkspaceContext,
  removePendingDelegation,
  revokeDelegation,
  saveDelegationCaveats,
  updateDelegationPosition,
  type CompanyDashboardState,
  type WalletProfile,
} from "@/app/actions/identity";
import { useAuth } from "@/components/AuthProvider";
import { DashboardFlowCanvas } from "@/components/dashboard-flow-canvas";
import { DelegationCardsView } from "@/components/delegation-cards-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardShell } from "@/components/dashboard-shell";
import { SectionCards } from "@/components/section-cards";
import { SmartAccountActivationButton } from "@/components/smart-account-activation-button";
import { TopUpTreasuryDialog } from "@/components/top-up-treasury-dialog";
import { Button } from "@/components/ui/button";


import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityLogTable } from "./ActivityLogTable";
import { cn } from "@/lib/utils";
import { getEmployeeDisplayIdentity } from "@/lib/wallet";

type DelegationRow = CompanyDashboardState["delegations"][number];
function caveatRecord(caveat: DelegationRow["caveats"][number]) {
  return caveat.caveatValue && typeof caveat.caveatValue === "object"
    ? (caveat.caveatValue as Record<string, unknown>)
    : {};
}

function formFromDelegation(delegation: DelegationRow | null): CaveatForm {
  if (!delegation) return emptyCaveatForm;

  const nextForm = { ...emptyCaveatForm };

  for (const caveat of delegation.caveats) {
    const value = caveatRecord(caveat);

    if (caveat.caveatType === "nativeTokenTransferAmount") {
      const yocto = value.maxAmount ?? value.amount;
      nextForm.maxAmountNear = typeof yocto === "string" ? yoctoToNearInput(yocto) : "";
      if (typeof value.expiresAt === "string") nextForm.expiresAt = value.expiresAt;
    }

    if (caveat.caveatType === "nativeTokenPeriodTransfer") {
      const period = value.period;
      const amount = value.periodAmount ?? value.amount;
      nextForm.period =
        period === "hourly" ||
        period === "daily" ||
        period === "weekly" ||
        period === "monthly"
          ? period
          : "daily";
      nextForm.periodAmountNear =
        typeof amount === "string" ? yoctoToNearInput(amount) : "";
    }

    if (caveat.caveatType === "valueLte") {
      const maxValue = value.maxValue ?? value.valueYocto;
      nextForm.perTransactionCapNear =
        typeof maxValue === "string" ? yoctoToNearInput(maxValue) : "";
    }

    if (caveat.caveatType === "allowedTargets" && Array.isArray(value.targets)) {
      nextForm.allowedTargets = value.targets.join("\n");
    }

    if (caveat.caveatType === "limitedCalls") {
      nextForm.limitedCallsEnabled = true;
      nextForm.limitedCalls =
        typeof value.limit === "number" ? String(value.limit) : "1";
    }
  }

  nextForm.policyPrompt = delegation.policyPrompt ?? "";
  const permission = delegation.signedDelegation as PermissionSpec | null;
  if (permission?.expires_at_ms) nextForm.expiresAt = new Date(Number(permission.expires_at_ms)).toISOString();

  return nextForm;
}

function yoctoToNearInput(amount: string) {
  return formatTokenAmount(amount, SPENDING_DECIMALS);
}

function formatAllowanceNear(raw: string): string {
  try {
    const formatted = formatTokenAmount(raw, SPENDING_DECIMALS);
    // Trim trailing zeros: "0.010000000000000000" -> "0.01"
    return formatted.replace(/(\.[0-9]*?)0+$/, "$1").replace(/\.$/, "");
  } catch {
    return raw;
  }
}

function buildServerCaveats(form: CaveatForm) {
  return {
    maxAmountNear: form.maxAmountNear.trim(),
    period: form.period,
    periodAmountNear: form.periodAmountNear.trim() || form.maxAmountNear.trim(),
    perTransactionCapNear: form.perTransactionCapNear.trim(),
    allowedTargets: splitAddresses(form.allowedTargets),
    redeemers: [],
    limitedCalls: form.limitedCallsEnabled ? Number(form.limitedCalls) : null,
    customCaveats: [],
    ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
  };
}

export function EmployerClient({
  initialProfile,
  initialDashboardState,
}: {
  initialProfile?: WalletProfile | null;
  initialDashboardState?: CompanyDashboardState | null;
} = {}) {
  const router = useRouter();
  const auth = useAuth();
  const refreshAfterSettlement = useSettlementRefresh();
  const currentAuthAddress = auth.status === "authenticated" ? (auth.address) : undefined;
  const { profile, setProfile, dashboardState, setDashboardState, mutate: mutateDashboard, refresh: refreshDashboard, error: queryError } =
    useDashboardData<CompanyDashboardState>("employer", initialProfile, initialDashboardState);
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(
    null,
  );
  const [policyScope, setPolicyScope] = useState("");
  const [caveatForm, setCaveatForm] = useState<CaveatForm>(emptyCaveatForm);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [activationStage, setActivationStage] = useState("");
  const [activationError, setActivationError] = useState<string | null>(null);
  const [recoveringPermission, setRecoveringPermission] = useState(false);
  const policyDrafts = useRef(new Map<string, CaveatForm>());
  useEffect(() => {
    policyDrafts.current.clear();
  }, [currentAuthAddress, dashboardState?.company.id]);
  const [actionError, setError] = useState<string | null>(null);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);

  const error = actionError ?? queryError?.message;

  const company = dashboardState?.company ?? profile?.company ?? null;
  const companyName = company?.name ?? "Allocard";
  const smartAccountLabel = company?.smartAccountAddress
    ? formatWalletAddress(company.smartAccountAddress)
    : "Treasury pending";

  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<"cards" | "canvas">("cards");
  const [isToppingUp, setIsToppingUp] = useState(false);
  const [isTopUpDialogOpen, setIsTopUpDialogOpen] = useState(false);
  const { key: accountKey } = useAccountScope();
  const treasuryBalance = useQuery({
    queryKey: [...accountKey, "treasury", company?.id, company?.smartAccountAddress],
    enabled: !!currentAuthAddress && !!company?.smartAccountAddress,
    queryFn: () => withTimeout((async () => {
      const client = getTreasuryClient(createNearRpcCaller(), company!.smartAccountAddress!);
      const config = await client.getConfig();
      if (config.schema_version >= (client.companyId ? 5 : 4)) {
        const budget = await client.getTreasuryBudget(SPENDING_ASSET);
        return { balance: formatTokenAmount(budget.available, SPENDING_DECIMALS), allocated: formatTokenAmount(budget.allocated, SPENDING_DECIMALS), unallocated: formatTokenAmount(budget.unallocated, SPENDING_DECIMALS), reservationsSupported: true };
      }
      const ledger = await client.getAssetLedger(SPENDING_ASSET);
      return { balance: formatTokenAmount(ledger?.available ?? "0", SPENDING_DECIMALS), allocated: null, unallocated: null, reservationsSupported: false };
    })(), "Treasury balance took too long to load."),
    refetchOnWindowFocus: "always",
  });
  const treasuryBudget = treasuryBalance.data;
  const ethBalance = treasuryBudget?.balance;
  const fetchBalance = useCallback(async () => { await treasuryBalance.refetch(); }, [treasuryBalance.refetch]);

  const handleTopUpTreasury = useCallback(async () => {
    if (!company?.smartAccountAddress) return;
    setIsToppingUp(true);
    try {
      if (MOCK_USDC_ACCOUNT_ID) {
        const key = `allocard-faucet:${MOCK_USDC_ACCOUNT_ID}:${company.id}`;
        const claimId = localStorage.getItem(key) ?? crypto.randomUUID();
        localStorage.setItem(key, claimId);
        const response = await fetch("/api/treasury/faucet", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: company.id, claimId }),
          signal: AbortSignal.timeout(120_000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "The faucet claim could not be confirmed");
        localStorage.removeItem(key);
        toast.success(`${Number(FAUCET_USDC).toLocaleString()} test USDC added`);
        refreshAfterSettlement();
        return;
      }
      if (auth.status === "authenticated") {
        const caller = await getUnifiedNearCaller(auth);
        if (caller.functionCall) {
          if (auth.sendActions) {
            const { functionCall } = await import("near-api-js/lib/transaction");
            const scope = parseTreasuryReference(company.smartAccountAddress);
            const args = scope.companyId ? { company_id: scope.companyId } : {};
            await auth.sendActions({ receiverId: scope.contractId, actions: [
              functionCall("top_up_storage", args, BigInt("40000000000000"), BigInt(parseTokenAmount("0.5", NEAR_DECIMALS))),
              functionCall("top_up_operating", args, BigInt("40000000000000"), BigInt(parseTokenAmount("0.2", NEAR_DECIMALS))),
              functionCall("deposit_native", args, BigInt("40000000000000"), BigInt(parseTokenAmount("1", NEAR_DECIMALS))),
            ] });
          } else throw new Error("A signing wallet is required");
          toast.success("Treasury Pools Funded", {
            description: "1.7 NEAR deposited across storage reserve, operating budget, and native treasury on NEAR Testnet.",
          });
          refreshAfterSettlement();
          return;
        }
      }
      window.open("https://near-faucet.io", "_blank");
    } catch (err) {
      toast.error("Treasury funding did not complete", { description: err instanceof Error ? err.message : "Check the transaction before retrying" });
    } finally {
      setIsToppingUp(false);
    }
  }, [company, auth, refreshAfterSettlement]);

  // Root allocations are funded on the reservation release; legacy balances are not guarantees.

  const selectedDelegation = useMemo(
    () =>
      policyScope === `${currentAuthAddress}:${dashboardState?.company.id}` ? dashboardState?.delegations.find(
        (delegation) => delegation.id === selectedDelegationId,
      ) ?? null : null,
    [dashboardState?.delegations, dashboardState?.company.id, currentAuthAddress, policyScope, selectedDelegationId],
  );

  const selectedDelegateeIdentity = useMemo(() => {
    if (!selectedDelegation) return null;
    if (selectedDelegation.delegateeType === "user" && selectedDelegation.delegateeId) {
      const emp = dashboardState?.employees.find((item) => item.id === selectedDelegation.delegateeId);
      return emp ? getEmployeeDisplayIdentity(emp) : { label: "Employee", fullEmail: null };
    }
    if (selectedDelegation.delegateeType === "agent" && selectedDelegation.delegateeId) {
      const ag = dashboardState?.agents.find((item) => item.id === selectedDelegation.delegateeId);
      return { label: ag?.name ?? "AI agent", fullEmail: null };
    }
    return null;
  }, [selectedDelegation, dashboardState?.employees, dashboardState?.agents]);

  const canvasEmployees = useMemo(
    () =>
      dashboardState?.employees.map((employee) => {
        const identity = getEmployeeDisplayIdentity(employee);
        return {
          id: employee.id,
          label: identity.label,
          fullEmail: identity.fullEmail,
          smartAccountAddress: employee.smartAccountAddress,
        };
      }) ?? [],
    [dashboardState?.employees],
  );

  // Extract the configured spending allowance and remaining balance for each delegation.
  const canvasDelegations = useMemo(() => {
    if (!dashboardState) return [];
    return dashboardState.delegations.map((delegation) => {
      const allowanceCaveat = delegation.caveats.find(
        (c) => c.caveatType === "nativeTokenTransferAmount",
      );
      let allowance: string | undefined;
      if (delegation.status === "active" && allowanceCaveat) {
        const val = allowanceCaveat.caveatValue as Record<string, unknown>;
        const yoctoStr = String(val.maxAmount ?? val.amount ?? "");
        if (yoctoStr) allowance = formatAllowanceNear(yoctoStr);
      }
      return { ...delegation, allowance, remainingNear: delegation.remainingNear };
    });
  }, [dashboardState]);

  const canvasCompany = useMemo(
    () => (company ? { ...company, ethBalance } : null),
    [company, ethBalance],
  );

  const runDashboardMutation = useCallback(
    (mutation: () => Promise<CompanyDashboardState>) => {
      startTransition(async () => {
        try {
          await mutateDashboard(mutation);
        } catch (caughtError) {
          toast.error(
            caughtError instanceof Error
              ? caughtError.message
              : "Dashboard update failed",
          );
        }
      });
    },
    [mutateDashboard],
  );

  const handleConfigureDelegation = useCallback(
    (delegationId: string) => {
      const delegation =
        dashboardState?.delegations.find((item) => item.id === delegationId) ??
        null;

      let form = policyDrafts.current.get(delegationId) ?? formFromDelegation(delegation);
      let recovery = false;
      setActivationError(null);
      try {
        const key = `allocard:root-permission:${currentAuthAddress}:${company?.smartAccountAddress}:${delegationId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          const saved = localStorage.getItem(key);
          if (saved) {
            const intent = JSON.parse(saved);
            const terms = JSON.parse(intent.terms);
            const caveats = terms.caveats;
            form = { ...emptyCaveatForm, ...caveats, allowedTargets: (caveats.allowedTargets ?? []).join("\n"),
              limitedCallsEnabled: caveats.limitedCalls != null, limitedCalls: String(caveats.limitedCalls ?? 1),
              policyPrompt: terms.policy ?? "", expiresAt: intent.spec.expires_at_ms ? new Date(Number(intent.spec.expires_at_ms)).toISOString() : "" };
            recovery = true;
          }
        }
      } catch (caught) { setActivationError(caught instanceof Error ? caught.message : "Could not load recovery state"); }
      setPolicyScope(`${currentAuthAddress}:${company?.id}`);
      setSelectedDelegationId(delegationId);
      setCaveatForm(form);
      setRecoveringPermission(recovery);
    },
    [dashboardState?.delegations, currentAuthAddress, company],
  );

  const handleDropEmployee = useCallback(
    (input: {
      employeeId: string;
      canvasPositionX: number;
      canvasPositionY: number;
    }) =>
      runDashboardMutation(async () => {
        const nextState = await createEmployeeDelegation({
          walletAddress: currentAuthAddress as string,
          ...input,
        });
        toast.info("Employee Added to Canvas", {
          description: "Click Configure to set spending rules and caveats.",
        });
        return nextState;
      }),
    [runDashboardMutation, currentAuthAddress],
  );

  const handleAddEmployee = useCallback(
    (employeeId: string) =>
      runDashboardMutation(async () => {
        const nextState = await createEmployeeDelegation({
          walletAddress: currentAuthAddress as string,
          employeeId,
          canvasPositionX: 420,
          canvasPositionY: 220,
        });
        toast.info("Employee Delegation Created", {
          description: "Click Configure to set spending rules and caveats.",
        });
        return nextState;
      }),
    [runDashboardMutation, currentAuthAddress],
  );

  const handleRevokeDelegation = useCallback(
    (delegationId: string) => {
      const targetDelegation = dashboardState?.delegations.find((d) => d.id === delegationId);
      const employee = targetDelegation?.delegateeType === "user"
        ? dashboardState?.employees.find((e) => e.id === targetDelegation.delegateeId)
        : null;
      const agent = targetDelegation?.delegateeType === "agent"
        ? dashboardState?.agents.find((a) => a.id === targetDelegation.delegateeId)
        : null;
      const targetName = employee
        ? getEmployeeDisplayIdentity(employee).label
        : (agent?.name ?? "Delegation");
      const targetAddress = employee?.smartAccountAddress || employee?.walletAddress || agent?.signerAddress || "";

      runDashboardMutation(async () => {
        if (targetDelegation?.status === "active") {
          if (auth.status !== "authenticated" || !company?.smartAccountAddress || !targetDelegation.delegationHash) throw new Error("Missing signed treasury permission");
          const caller = await getUnifiedNearCaller(auth);
          await getTreasuryClient(caller, company.smartAccountAddress).revokePermission(targetDelegation.delegationHash);
        }
        const nextState = await revokeDelegation({
          walletAddress: currentAuthAddress as string,
          delegationId,
        });

        toast.success("Delegation Revoked", {
          description: `Spending authority for ${targetName} has been revoked on NEAR Testnet.`,
          action: targetAddress ? {
            label: "View Explorer",
            onClick: () => window.open(getAddressExplorerUrl(targetAddress), "_blank"),
          } : undefined,
        });

        return nextState;
      });

      setSelectedDelegationId((current) => (current === delegationId ? null : current));
    },
    [dashboardState, currentAuthAddress, runDashboardMutation, auth, company],
  );

  const handleRemoveDelegation = useCallback(
    (delegationId: string) => {
      runDashboardMutation(async () => {
        const nextState = await removePendingDelegation({
          walletAddress: currentAuthAddress as string,
          delegationId,
        });
        toast.success("Delegation Removed", {
          description: "Pending delegation configuration has been removed from canvas.",
        });
        return nextState;
      });
      setSelectedDelegationId((current) =>
        current === delegationId ? null : current,
      );
    },
    [currentAuthAddress, runDashboardMutation],
  );

  const handleMoveDelegation = useCallback(
    (input: {
      delegationId: string;
      canvasPositionX: number;
      canvasPositionY: number;
    }) =>
      runDashboardMutation(() =>
        updateDelegationPosition({ walletAddress: currentAuthAddress as string, ...input }),
      ),
    [runDashboardMutation, currentAuthAddress],
  );

  const handleSmartAccountActivated = async (smartAccountAddress: string | null) => {
    if (!smartAccountAddress) return;

    toast.success("Treasury Account Active", {
      description: `Company Treasury is active on NEAR Testnet (${smartAccountAddress})`,
      action: {
        label: "View Explorer",
        onClick: () => window.open(getAddressExplorerUrl(smartAccountAddress), "_blank"),
      },
    });

    setProfile((currentProfile) => {
      if (!currentProfile || currentProfile.status !== "employer") {
        return currentProfile;
      }

      return {
        ...currentProfile,
        company: currentProfile.company
          ? { ...currentProfile.company, smartAccountAddress }
          : currentProfile.company,
      };
    });

    setDashboardState((currentState) =>
      currentState
        ? {
            ...currentState,
            company: { ...currentState.company, smartAccountAddress },
          }
        : currentState,
    );

    setTimeout(() => {
      void fetchBalance();
    }, 1000);
  };

  const resolveDelegateAddress = (delegation: DelegationRow) => {
    if (delegation.delegateeType === "user" && delegation.delegateeId) {
      const employee = dashboardState?.employees.find(
        (item) => item.id === delegation.delegateeId,
      );

      const target = employee?.walletAddress;
      if (!target) {
        throw new Error("The employee account must be active first");
      }

      return target;
    }

    if (delegation.delegateeType === "agent" && delegation.delegateeId) {
      const agent = dashboardState?.agents.find(
        (item) => item.id === delegation.delegateeId,
      );

      const target = agent?.smartAccountAddress || agent?.signerAddress;
      if (!target) {
        throw new Error("The agent account is not configured yet");
      }

      return target;
    }

    throw new Error("Delegation target is incomplete");
  };

  const handleActivateDelegation = () => {
    if (!selectedDelegation) return;
    if (selectedDelegation.status === "active") { toast.error("Revoke the existing permission before replacing it"); return; }

    // A previously confirmed grant has already reserved its funds. Recovery is
    // synchronization, not a second allocation, so do not reject it as unfunded.
    let recovering = false;
    try { recovering = !!localStorage.getItem(`allocard:root-permission:${currentAuthAddress}:${company?.smartAccountAddress}:${selectedDelegation.id}`); } catch { /* Signing later requires durable recovery storage. */ }
    const errors = validateCaveatForm(caveatForm, recovering ? null : treasuryBudget?.unallocated ?? null, Date.now(), recovering);
    if (hasFormErrors(errors)) { setActivationError(Object.values(errors).join(" ")); return; }
    setActivationError(null);
    setActivationStage("Checking treasury and policy…");

    startTransition(async () => {
      try {
        const recoveryKey = `allocard:root-permission:${currentAuthAddress}:${company?.smartAccountAddress}:${selectedDelegation.id}`;
        const recovery = localStorage.getItem(recoveryKey);
        const terms = JSON.stringify({ caveats: buildServerCaveats(caveatForm), policy: caveatForm.policyPrompt });
        if (recovery && !matchingRootTerms(JSON.parse(recovery).terms, terms)) throw new Error("Restore the previous allowance rules to recover its pending activation before changing them.");
        await saveDelegationCaveats({
          walletAddress: currentAuthAddress as string,
          delegationId: selectedDelegation.id,
          caveats: buildServerCaveats(caveatForm),
          policyPrompt: caveatForm.policyPrompt,
        });

        if (!company?.smartAccountAddress) {
          throw new Error("Activate the company treasury first");
        }

        const delegateAddress = resolveDelegateAddress(selectedDelegation);
        const spec = recovery ? JSON.parse(recovery).spec as PermissionSpec : buildPolicySpec(caveatForm, delegateAddress);

        if (auth.status !== "authenticated") throw new Error("Connect the company owner wallet");
        const caller = await getUnifiedNearCaller(auth);
        if (!caller.functionCall) throw new Error("A signing wallet is required");
        const client = getTreasuryClient(caller, company.smartAccountAddress);
        const config = await client.getConfig();
        if (config.schema_version < (client.companyId ? 5 : 4)) throw new Error("Migrate this treasury to the reservation release before creating new employee allowances.");
        if (config.owner !== auth.accountId) throw new Error("This wallet does not own the company treasury");
        if (config.paused) throw new Error("ALLOCARD_PAUSED");
        const intentKey = `allocard:root-permission:${auth.accountId}:${company.smartAccountAddress}:${selectedDelegation.id}`;
        if (!recovery) {
          const freshBudget = await client.getTreasuryBudget(SPENDING_ASSET);
          const latestErrors = validateCaveatForm(caveatForm, formatTokenAmount(freshBudget.unallocated, SPENDING_DECIMALS));
          if (hasFormErrors(latestErrors)) throw new Error(Object.values(latestErrors).join(" "));
        }
        const intent = prepareRootPermission(localStorage, intentKey, JSON.stringify({ caveats: buildServerCaveats(caveatForm), policy: caveatForm.policyPrompt }), spec);
        let permissionId = intent.permissionId;
        if (!permissionId) {
          assertRootPermissionRetrySafe(intent, Boolean(readPendingNearTransaction(auth.accountId)));
          localStorage.setItem(intentKey, JSON.stringify({ ...intent, attempted: true }));
          setActivationStage("Waiting for wallet signature and network confirmation…");
          try { permissionId = await client.createRootPermission(intent.spec); }
          catch (caught) {
            releaseUnsubmittedRootPermission(localStorage, intentKey, caught);
            setRecoveringPermission(Boolean(localStorage.getItem(intentKey)));
            throw caught;
          }
          localStorage.setItem(intentKey, JSON.stringify({ ...intent, permissionId }));
          setRecoveringPermission(true);
        }
        setActivationStage("Confirming permission and saving access…");
        const confirmed = await client.getPermission(permissionId);
        if (!confirmed || confirmed.delegate !== delegateAddress || confirmed.revoked) throw new Error("Permission was not confirmed on-chain");

        const employee = selectedDelegation.delegateeType === "user"
          ? dashboardState?.employees.find((e) => e.id === selectedDelegation.delegateeId)
          : null;
        const targetName = employee
          ? getEmployeeDisplayIdentity(employee).label
          : "Employee";

        const activated = await activateDelegation({
            walletAddress: currentAuthAddress as string,
            delegationId: selectedDelegation.id,
            delegationHash: permissionId,
            signedDelegation: intent.spec,
          });
        localStorage.removeItem(intentKey);
        policyDrafts.current.delete(selectedDelegation.id);
        setRecoveringPermission(false);
        setDashboardState(current => current && ({ ...current, delegations: current.delegations.map(row => row.id === activated.id ? activated : row) }));
        refreshAfterSettlement();
        setSelectedDelegationId(null);

        toast.success("Delegation Activated", {
          description: `Assigned ${caveatForm.maxAmountNear} ${TOKEN_SYMBOL} spending limit to ${targetName} on NEAR Testnet`,
          action: {
            label: "View Explorer",
            onClick: () => window.open(getAddressExplorerUrl(delegateAddress), "_blank"),
          },
        });
      } catch (caughtError) {
        const message = describePolicyActivationError(caughtError);
        setActivationError(message);
        toast.error(message);
      } finally { setActivationStage(""); }
    });
  };

  const handleAddEmployeeByEmail = useCallback(async (email: string) => {
    setIsAddingEmployee(true);
    try {
      const addr = (currentAuthAddress || (profile && "user" in profile && profile.user ? profile.user.walletAddress : undefined)) as string;
      const result = await addEmployeeByEmail({ walletAddress: addr, email });
      if (result.status === "already_pending") {
        toast.warning("Employee email already added", {
          description: "Share the Allocard link and ask them to sign in with this email.",
        });
      } else if (result.status === "already_active") {
        toast.info("Employee Already Active", {
          description: "This employee already has access to the workspace.",
        });
      } else {
        toast.success("Employee email added", {
          description: "Share the Allocard link. They can sign in with the added email and accept access.",
          action: { label: "Copy app link", onClick: () => { void navigator.clipboard.writeText(window.location.origin).catch(() => toast.info(window.location.origin)); } },
        });
      }
      void refreshDashboard().catch(() => toast.error("Employee added. Refresh the team list to see the update."));
    } catch (caught) {
      toast.error("Invitation Failed", {
        description: caught instanceof Error ? caught.message : "Could not add employee.",
      });
      throw caught;
    } finally {
      setIsAddingEmployee(false);
    }
  }, [currentAuthAddress, profile, refreshDashboard]);

  useEffect(() => {
    if (auth.status === "unauthenticated") {
      router.replace("/");
    }
  }, [auth.status, router]);

  if (auth.status === "unauthenticated") {
    return <DashboardLoading role="employer" />;
  }

  if (auth.status === "connecting") return <DashboardLoading />;

  if (error && !dashboardState) {
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center gap-8 bg-white p-8">
        <div className="flex flex-col items-center gap-6 text-center max-w-md">
          <div className="w-16 h-16 flex items-center justify-center mb-2">
            <img src="/AllocardLogoBlack.svg" alt="Allocard Logo" className="w-full h-full object-contain opacity-50 grayscale" />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-bold text-[#111]">Dashboard failed to load</p>
            <p className="text-base text-[#666] leading-relaxed">{error}</p>
          </div>
          <div className="flex flex-col gap-3 w-full max-w-xs mt-2">
            <button
              onClick={() => window.location.reload()}
              className="h-12 w-full rounded-md bg-[#111] text-white text-base font-semibold hover:bg-[#333] transition-colors cursor-pointer"
            >
              Reload page
            </button>
            <Link href="/" className="h-12 w-full rounded-md border border-[#eaeaea] bg-white text-[#111] text-base font-semibold hover:bg-[#f5f5f5] transition-colors flex items-center justify-center">
              Return to Home Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboardState || !company) {
    return <DashboardLoading />;
  }

  return (
    <DashboardShell
      activationRequired={!company.smartAccountAddress}
      demoGuide={{
        scope: `${currentAuthAddress}:${company.id}`,
        step: !company.smartAccountAddress ? 0
          : dashboardState.delegations.some(row => row.status === "active" && row.delegatorType === "company" && row.delegateeType === "user" && !row.parentDelegationId) ? 4
          : dashboardState.employees.length > 0 ? 3
          : dashboardState.pendingEmployees.length > 0 ? 2 : 1,
      }}
      companyName={companyName}
      employees={dashboardState.employees.map((employee) => {
        const identity = getEmployeeDisplayIdentity(employee);
        return {
          id: employee.id,
          label: identity.label,
          fullEmail: identity.fullEmail,
          detail: employee.smartAccountAddress
            ? formatWalletAddress(employee.smartAccountAddress)
            : "Treasury pending",
        };
      })}
      pendingEmployees={dashboardState.pendingEmployees}
      onInviteEmployeeByEmail={handleAddEmployeeByEmail}
      agents={[]}
      onAddEmployee={(employeeId) =>
        runDashboardMutation(() =>
          createEmployeeDelegation({
            walletAddress: currentAuthAddress as string,
            employeeId,
            canvasPositionX: 420,
            canvasPositionY: 120 + dashboardState.delegations.length * 90,
          }),
        )
      }
      onRefreshEmployees={() => {
        startRefreshTransition(async () => {
          await refreshDashboard();
        });
      }}
      companyId={(profile && "user" in profile && profile.user && profile.user.companyId) || undefined}
      workspaceOptions={(profile && "workspaces" in profile && profile.workspaces) || []}
      onWorkspaceChange={(companyId, role) => {
        startTransition(async () => {
          try {
            await setWorkspaceContext({ walletAddress: currentAuthAddress as string, companyId, role });
            setDashboardState(null);
            setProfile(null);
            window.location.assign(role === "employer" ? "/employer" : "/employee");
          } catch (caught) {
            toast.error(caught instanceof Error ? caught.message : "Could not switch workspace");
          }
        });
      }}
      employeesRefreshing={isRefreshing}
      roleLabel="Company owner"
      smartAccountLabel={smartAccountLabel}
      smartAccountAddress={company?.smartAccountAddress}
      title="Company dashboard"
    >
      <div className="flex min-h-full flex-col gap-4">
        {error && <p role="alert" className="text-sm text-muted-foreground">{error}</p>}
        {/* Smart account activation panel */}
        {company && !company.smartAccountAddress && (
          <section aria-labelledby="company-activation-title" className="grid w-full max-w-3xl gap-5 rounded-xl border border-border p-5 sm:p-6 lg:grid-cols-2 lg:gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 id="company-activation-title" className="text-lg font-semibold tracking-tight">Set up company spending</h2>
                <p className="text-sm leading-6 text-muted-foreground">{MOCK_USDC_ACCOUNT_ID ? `Start with ${Number(ACTIVATION_USDC).toLocaleString("en-US")} test USDC in your company treasury.` : "Activate to start setting team spending limits."}</p>
              </div>
              <SmartAccountActivationButton
                companyKey={company.id}
                walletAddress={currentAuthAddress!}
                existingSmartAccountAddress={company.smartAccountAddress}
                onActivated={(result) => handleSmartAccountActivated(result.smartAccountAddress)}
              />
            </div>
            <div className="space-y-2 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <h3 className="text-sm font-medium">Before you try the demo</h3>
              <p className="text-sm leading-6 text-muted-foreground">Have a second email you can access and an incognito window ready. It’s an extra step so you can try both the employer and employee roles.</p>
            </div>
          </section>
        )}

        {company.smartAccountAddress && treasuryBudget?.reservationsSupported === false && <p role="status" className="text-xs leading-5 text-muted-foreground">This treasury uses the previous release: employee allowances are not reserved. Migrate to the reservation release before assigning new allowances.</p>}
        <SectionCards
          employeeCount={dashboardState.summary.employeeCount}
          balanceLoading={treasuryBalance.isPending && !!company.smartAccountAddress}
          smartAccountBalance={company.smartAccountAddress ? ethBalance ?? "—" : "0"}
          activeDelegationCount={dashboardState.summary.activeDelegationCount}
          delegatedNativeNearAllowance={treasuryBudget?.allocated ?? dashboardState.summary.delegatedNativeNearAllowance}
          unallocatedBalance={treasuryBudget?.unallocated ?? undefined}
          reservationsSupported={treasuryBudget?.reservationsSupported}
          onTopUp={() => setIsTopUpDialogOpen(true)}
          isToppingUp={isToppingUp}
        />

        <TopUpTreasuryDialog
          open={isTopUpDialogOpen}
          onOpenChange={setIsTopUpDialogOpen}
          treasuryAddress={company.smartAccountAddress}
          adminAddress={currentAuthAddress}
          currentBalance={ethBalance}
          onDirectTopUp={handleTopUpTreasury}
          isToppingUp={isToppingUp}
        />

        <Tabs defaultValue="canvas" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="canvas">Delegations</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
          </TabsList>

          <TabsContent value="canvas" className="mt-0">
            {!isMobile && viewMode === "canvas" ? (
              <DashboardFlowCanvas
                company={canvasCompany ?? company}
                headerAction={
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setViewMode("cards")}
                    >
                      <LayoutGridIcon className="size-3.5" />
                      Table View
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        startRefreshTransition(async () => {
                          await refreshDashboard();
                        });
                      }}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? "Refreshing..." : "Refresh"}
                    </Button>
                  </div>
                }
                employees={canvasEmployees}
                agents={dashboardState.agents.map((agent) => ({
                  id: agent.id,
                  name: agent.name,
                  smartAccountAddress: agent.smartAccountAddress,
                }))}
                delegations={canvasDelegations}
                onConfigureDelegation={handleConfigureDelegation}
                onDropEmployee={handleDropEmployee}
                onMoveDelegation={handleMoveDelegation}
                onRevokeDelegation={handleRevokeDelegation}
                onRemoveDelegation={handleRemoveDelegation}
              />
            ) : (
              <DelegationCardsView
                company={canvasCompany ?? company}
                employees={canvasEmployees}
                agents={dashboardState.agents.map((agent) => ({
                  id: agent.id,
                  name: agent.name,
                  smartAccountAddress: agent.smartAccountAddress,
                }))}
                delegations={canvasDelegations}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                headerAction={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      startRefreshTransition(async () => {
                        await refreshDashboard();
                      });
                    }}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </Button>
                }
                onConfigureDelegation={handleConfigureDelegation}
                onRevokeDelegation={handleRevokeDelegation}
                onRemoveDelegation={handleRemoveDelegation}
                onAddEmployee={handleAddEmployee}
              />
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Employer Activity Log</h3>
              <p className="text-sm text-muted-foreground mb-6">
                A unified view of all direct employee spends and corporate expense delegations within your company.
              </p>
              <ActivityLogTable companyId={company.id} />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {selectedDelegation && <PolicyConfigurationDrawer
        key={`${currentAuthAddress}:${company?.id}:${selectedDelegation.id}`}
        open mobile={isMobile}
        identity={selectedDelegateeIdentity?.label ?? "Employee"}
        account={(() => { try { return resolveDelegateAddress(selectedDelegation); } catch { return ""; } })()}
        companyId={company?.id ?? ""}
        status={selectedDelegation.status}
        form={caveatForm} setForm={next => { setCaveatForm(next); setActivationError(null); }}
        balance={treasuryBudget?.unallocated ?? null}
        busy={isPending} stage={activationStage} error={activationError}
        recovery={recoveringPermission}
        onClose={() => { policyDrafts.current.set(selectedDelegation.id, caveatForm); setSelectedDelegationId(null); }}
        onActivate={handleActivateDelegation}
        onRevoke={() => { const id = selectedDelegation.id; setSelectedDelegationId(null); handleRevokeDelegation(id); }}
      />}

    </DashboardShell>
  );
}

