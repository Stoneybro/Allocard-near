"use client";

import { useDashboardData, useAccountScope } from "@/hooks/use-account-queries";
import { useQuery, useMutation } from "@tanstack/react-query";
import { withTimeout } from "@/lib/request-timeout";
import { toast } from "sonner";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  LoaderCircleIcon,
  ShieldCheckIcon,
  BotIcon,
  ExternalLink,
  BanIcon,
  ShieldAlertIcon,
  LayoutGridIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TOKEN_SYMBOL, getAddressExplorerUrl, getTxExplorerUrl } from "@/lib/chain";
import { isValidWalletAddress, formatWalletAddress } from "@/lib/wallet";
import { parseTreasuryReference, type PermissionSpec } from "@allocard/delegation-sdk";
import {
  getUnifiedNearCaller,
  createNearRpcCaller,
  getTreasuryClient,
  parseTokenAmount,
  formatTokenAmount,
} from "@/lib/near";
import {
  updateCompanyPolicy,
  activateDelegation,
  createAgentDelegation,
  prepareReimbursementBudget,
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
import {
  ConnectRequiredCard,
} from "@/components/auth-state";
import { useAuth } from "@/components/AuthProvider";
import { DashboardFlowCanvas } from "@/components/dashboard-flow-canvas";
import { DelegationCardsView } from "@/components/delegation-cards-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardShell } from "@/components/dashboard-shell";
import { isReimbursementAgent } from "@/lib/reimbursements/shared";
import { ReimbursementsCard } from "@/components/reimbursements-card";
import { SectionCards } from "@/components/section-cards";
import { SmartAccountActivationButton } from "@/components/smart-account-activation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_COMPANY_POLICY } from "@/lib/policy";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityLogTable } from "./ActivityLogTable";
import { cn } from "@/lib/utils";
import { generateEmployeeReferenceId } from "@/lib/wallet";

type DelegationRow = CompanyDashboardState["delegations"][number];
type CaveatForm = {
  maxAmountNear: string;
  period: "none" | "hourly" | "daily" | "weekly" | "monthly";
  periodAmountNear: string;
  perTransactionCapNear: string;
  allowedTargets: string;
  limitedCallsEnabled: boolean;
  limitedCalls: string;
  policyPrompt: string;
};

const emptyCaveatForm: CaveatForm = {
  maxAmountNear: "",
  period: "none",
  periodAmountNear: "",
  perTransactionCapNear: "",
  allowedTargets: "",
  limitedCallsEnabled: false,
  limitedCalls: "1",
  policyPrompt: "",
};

const periodDurations = {
  hourly: 60 * 60,
  daily: 60 * 60 * 24,
  weekly: 60 * 60 * 24 * 7,
  monthly: 60 * 60 * 24 * 30,
} as const;

function splitAddresses(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

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

  return nextForm;
}

function yoctoToNearInput(yocto: string) {
  const value = BigInt(yocto);
  const whole = value / 1_000_000_000_000_000_000_000_000n;
  const fractional = value % 1_000_000_000_000_000_000_000_000n;

  if (fractional === 0n) {
    return whole.toString();
  }

  return `${whole}.${fractional.toString().padStart(24, "0").replace(/0+$/, "")}`;
}

function formatAllowanceNear(raw: string): string {
  try {
    const formatted = BigInt(raw) > 10n ** 15n ? formatTokenAmount(raw, 24) : raw;
    // Trim trailing zeros: "0.010000000000000000" -> "0.01"
    return formatted.replace(/(\.[0-9]*?)0+$/, "$1").replace(/\.$/, "");
  } catch {
    return raw;
  }
}

function formatDelegationStatus(status: string) {
  switch (status) {
    case "pending_config": return "Pending Configuration";
    case "active": return "Active";
    case "revoked": return "Revoked";
    default: return status;
  }
}

function buildServerCaveats(form: CaveatForm) {
  return {
    maxAmountNear: form.maxAmountNear,
    period: form.period,
    periodAmountNear: form.periodAmountNear || form.maxAmountNear,
    perTransactionCapNear: form.perTransactionCapNear,
    allowedTargets: splitAddresses(form.allowedTargets),
    redeemers: [],
    limitedCalls: form.limitedCallsEnabled ? Number(form.limitedCalls) : null,
    customCaveats: [],
  };
}

const NEAR_AMOUNT_RE = /^\d+(\.\d+)?$/;

type FormErrors = {
  maxAmountNear?: string;
  periodAmountNear?: string;
  perTransactionCapNear?: string;
  limitedCalls?: string;
  allowedTargets?: string;
  allowedTargetsWarning?: string;
};

function validateCaveatForm(
  form: CaveatForm,
  _availableBalanceNear: number | null,
): FormErrors {
  const errors: FormErrors = {};

  // --- Lifetime Spending Limit ---
  if (!NEAR_AMOUNT_RE.test(form.maxAmountNear.trim())) {
    errors.maxAmountNear = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.05).`;
  } else {
    const max = parseFloat(form.maxAmountNear);
    if (max <= 0) {
      errors.maxAmountNear = "Spending limit must be greater than 0.";
    }
  }

  // --- Periodic Allowance ---
  if (form.period !== "none") {
    const raw = form.periodAmountNear.trim();
    if (!raw) {
      errors.periodAmountNear = "Enter a period allowance when a recurring period is selected.";
    } else if (!NEAR_AMOUNT_RE.test(raw)) {
      errors.periodAmountNear = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.01).`;
    } else {
      const period = parseFloat(raw);
      const max = parseFloat(form.maxAmountNear);
      if (period <= 0) {
        errors.periodAmountNear = "Period allowance must be greater than 0.";
      } else if (!errors.maxAmountNear && period > max) {
        errors.periodAmountNear = `Period allowance (${raw} ${TOKEN_SYMBOL}) cannot exceed the lifetime limit (${form.maxAmountNear} ${TOKEN_SYMBOL}).`;
      }
    }
  }

  // --- Per-Transaction Cap ---
  const perTxRaw = form.perTransactionCapNear.trim();
  if (perTxRaw) {
    if (!NEAR_AMOUNT_RE.test(perTxRaw)) {
      errors.perTransactionCapNear = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.005).`;
    } else {
      const perTx = parseFloat(perTxRaw);
      if (perTx <= 0) {
        errors.perTransactionCapNear = "Per-transaction cap must be greater than 0.";
      } else {
        const ceiling =
          form.period !== "none" && form.periodAmountNear.trim()
            ? parseFloat(form.periodAmountNear)
            : parseFloat(form.maxAmountNear);
        if (!isNaN(ceiling) && perTx > ceiling) {
          const label = form.period !== "none" ? `the period allowance (${form.periodAmountNear} ${TOKEN_SYMBOL})` : `the lifetime limit (${form.maxAmountNear} ${TOKEN_SYMBOL})`;
          errors.perTransactionCapNear = `Per-transaction cap cannot exceed ${label}.`;
        }
      }
    }
  }

  // --- Limited Calls ---
  if (form.limitedCallsEnabled) {
    const n = Number(form.limitedCalls);
    if (!Number.isInteger(n) || n < 1) {
      errors.limitedCalls = "Transaction limit must be a whole number ≥ 1.";
    }
  }

  // --- Address Whitelist ---
  const addresses = splitAddresses(form.allowedTargets);
  const invalidAddresses = addresses.filter((a) => !isValidWalletAddress(a));
  if (invalidAddresses.length > 0) {
    errors.allowedTargets = `Invalid account${invalidAddresses.length > 1 ? "s" : ""}: ${invalidAddresses.join(", ")}`;
  } else if (addresses.length === 0) {
    errors.allowedTargetsWarning = "No accounts specified — the delegatee can send to any NEAR account.";
  }

  return errors;
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
  const currentAuthAddress = auth.status === "authenticated" ? (auth.address) : undefined;
  const { profile, setProfile, dashboardState, setDashboardState, mutate: mutateDashboard, refresh: refreshDashboard, error: queryError } =
    useDashboardData("employer", getCompanyDashboardState, initialProfile, initialDashboardState);
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(
    null,
  );
  const [caveatForm, setCaveatForm] = useState<CaveatForm>(emptyCaveatForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [actionError, setError] = useState<string | null>(null);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);

  const error = actionError ?? queryError?.message;

  const company = dashboardState?.company ?? profile?.company ?? null;
  const companyName = company?.name ?? "Allocard";
  const smartAccountLabel = company?.smartAccountAddress
    ? formatWalletAddress(company.smartAccountAddress)
    : "Smart account pending";

  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<"cards" | "canvas">("cards");
  const [isToppingUp, setIsToppingUp] = useState(false);
  const { key: accountKey } = useAccountScope();
  const treasuryBalance = useQuery({
    queryKey: [...accountKey, "treasury", company?.id, company?.smartAccountAddress],
    enabled: !!currentAuthAddress && !!company?.smartAccountAddress,
    queryFn: () => withTimeout((async () => {
      const client = getTreasuryClient(createNearRpcCaller(), company!.smartAccountAddress!);
      const ledger = await client.getAssetLedger({ type: "NativeNear" });
      return formatTokenAmount(ledger?.available ?? "0", 24);
    })(), "Treasury balance took too long to load."),
    refetchInterval: 15_000,
  });
  const ethBalance = treasuryBalance.data;
  const fetchBalance = useCallback(async () => { await treasuryBalance.refetch(); }, [treasuryBalance.refetch]);

  const handleTopUpTreasury = useCallback(async () => {
    if (!company?.smartAccountAddress) return;
    setIsToppingUp(true);
    try {
      if (auth.status === "authenticated") {
        const caller = await getUnifiedNearCaller(auth);
        if (caller.functionCall) {
          if (auth.sendActions) {
            const { functionCall } = await import("near-api-js/lib/transaction");
            const scope = parseTreasuryReference(company.smartAccountAddress);
            const args = scope.companyId ? { company_id: scope.companyId } : {};
            await auth.sendActions({ receiverId: scope.contractId, actions: [
              functionCall("top_up_storage", args, BigInt("40000000000000"), BigInt(parseTokenAmount("0.5", 24))),
              functionCall("top_up_operating", args, BigInt("40000000000000"), BigInt(parseTokenAmount("0.2", 24))),
              functionCall("deposit_native", args, BigInt("40000000000000"), BigInt(parseTokenAmount("1", 24))),
            ] });
          } else throw new Error("A signing wallet is required");
          toast.success("Treasury Pools Funded", {
            description: "1.7 NEAR deposited across storage reserve, operating budget, and native treasury on NEAR Testnet.",
          });
          await fetchBalance();
          return;
        }
      }
      window.open("https://near-faucet.io", "_blank");
    } catch (err) {
      toast.error("Treasury funding did not complete", { description: err instanceof Error ? err.message : "Check the transaction before retrying" });
    } finally {
      setIsToppingUp(false);
    }
  }, [company, auth, fetchBalance]);

  // Unused allowances do not reserve treasury capital.
  const availableBalanceNear = useMemo(() => {
    if (ethBalance === undefined) return null;
    const balance = Number(ethBalance);
    return Number.isFinite(balance) ? balance : null;
  }, [ethBalance]);

  const selectedDelegation = useMemo(
    () =>
      dashboardState?.delegations.find(
        (delegation) => delegation.id === selectedDelegationId,
      ) ?? null,
    [dashboardState?.delegations, selectedDelegationId],
  );

  const canvasEmployees = useMemo(
    () =>
      dashboardState?.employees.map((employee) => ({
        id: employee.id,
        label: generateEmployeeReferenceId(employee.walletAddress),
        smartAccountAddress: employee.smartAccountAddress,
      })) ?? [],
    [dashboardState?.employees],
  );

  // Extract the configured spending allowance and remaining balance for each delegation.
  const canvasDelegations = useMemo(() => {
    if (!dashboardState) return [];
    return dashboardState.delegations.filter(d => !dashboardState.agents.some(a => a.id === d.delegateeId && isReimbursementAgent(a))).map((delegation) => {
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

  const updateDashboard = useCallback((state: CompanyDashboardState) => {
    setDashboardState(state);
    void refreshDashboard();
  }, [setDashboardState, refreshDashboard]);

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

  const reimbursementSetup = useMutation({
    mutationFn: () => prepareReimbursementBudget(currentAuthAddress!), retry: false,
    onSuccess: async result => {
      await refreshDashboard();
      setSelectedDelegationId(result.delegation.id);
      setCaveatForm(formFromDelegation(result.delegation));
      setFormErrors({});
    },
    onError: caught => toast.error(caught.message),
  });

  const handleConfigureDelegation = useCallback(
    (delegationId: string) => {
      const delegation =
        dashboardState?.delegations.find((item) => item.id === delegationId) ??
        null;

      setSelectedDelegationId(delegationId);
      setCaveatForm(formFromDelegation(delegation));
      setFormErrors({});
    },
    [dashboardState?.delegations],
  );

  const isReimbursementBudget = Boolean(selectedDelegation && dashboardState?.agents.some(
    agent => agent.id === selectedDelegation.delegateeId && isReimbursementAgent(agent),
  ));


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

  const handleAddAgent = useCallback(
    (agentId: string) =>
      runDashboardMutation(async () => {
        const nextState = await createAgentDelegation({
          walletAddress: currentAuthAddress as string,
          agentId,
          canvasPositionX: 420,
          canvasPositionY: 220,
        });
        toast.info("AI Agent Added", {
          description: "Click Configure to set spending rules and caveats for this agent.",
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
        ? (employee.walletAddress ? `${employee.walletAddress.slice(0, 6)}...${employee.walletAddress.slice(-4)}` : "Employee")
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

        toast.success(isReimbursementAgent(agent) ? "Reimbursement payouts stopped" : "Delegation Revoked", {
          description: isReimbursementAgent(agent) ? "New claims cannot be paid under this reimbursement budget. Set up a new budget to resume payouts." : `Spending authority for ${targetName} has been revoked on NEAR Testnet.`,
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

    const errors = validateCaveatForm(caveatForm, availableBalanceNear);
    setFormErrors(errors);
    const hasErrors = Object.keys(errors).some(
      (k) => k !== "allowedTargetsWarning" && errors[k as keyof FormErrors],
    );
    if (hasErrors) return;

    startTransition(async () => {
      try {
        const savedState = await saveDelegationCaveats({
          walletAddress: currentAuthAddress as string,
          delegationId: selectedDelegation.id,
          caveats: buildServerCaveats(caveatForm),
          policyPrompt: caveatForm.policyPrompt,
        });
        updateDashboard(savedState);

        if (!company?.smartAccountAddress) {
          throw new Error("Activate the company treasury first");
        }

        const delegateAddress = resolveDelegateAddress(selectedDelegation);
        const parsedLimit = caveatForm.maxAmountNear ? parseTokenAmount(caveatForm.maxAmountNear, 24) : null;
        const parsedPerTx = caveatForm.perTransactionCapNear ? parseTokenAmount(caveatForm.perTransactionCapNear, 24) : null;

        const spec: PermissionSpec = {
          delegate: delegateAddress,
          valid_from_ms: Date.now().toString(),
          expires_at_ms: null,
          max_executions: caveatForm.limitedCallsEnabled && caveatForm.limitedCalls ? Number(caveatForm.limitedCalls) : null,
          rules: [
            {
              asset: { type: "NativeNear" },
              recipients: caveatForm.allowedTargets && caveatForm.allowedTargets.length > 0
                ? { type: "Only", accounts: splitAddresses(caveatForm.allowedTargets) }
                : { type: "Any" },
              min_per_action: null,
              max_per_action: parsedPerTx,
              lifetime_limit: parsedLimit,
              fixed_window: caveatForm.period && caveatForm.period !== "none"
                ? {
                    limit: parseTokenAmount(caveatForm.periodAmountNear || caveatForm.maxAmountNear, 24),
                    duration_ms: (periodDurations[caveatForm.period] * 1000).toString(),
                    anchor_ms: Date.now().toString(),
                  }
                : null,
              streaming: null,
              approval: null,
              acknowledge_unbounded_budget: !parsedLimit,
            },
          ],
          redelegation_depth: 1,
          metadata_hash: null,
        };

        if (auth.status !== "authenticated") throw new Error("Connect the company owner wallet");
        const caller = await getUnifiedNearCaller(auth);
        if (!caller.functionCall) throw new Error("A signing wallet is required");
        const client = getTreasuryClient(caller, company.smartAccountAddress);
        const config = await client.getConfig();
        if (config.owner !== auth.accountId) throw new Error("This wallet does not own the company treasury");
        const permissionId = await client.createRootPermission(spec);
        const confirmed = await client.getPermission(permissionId);
        if (!confirmed || confirmed.delegate !== delegateAddress || confirmed.revoked) throw new Error("Permission was not confirmed on-chain");

        const employee = selectedDelegation.delegateeType === "user"
          ? dashboardState?.employees.find((e) => e.id === selectedDelegation.delegateeId)
          : null;
        const targetName = employee?.walletAddress
          ? formatWalletAddress(employee.walletAddress)
          : "Employee";

        updateDashboard(
          await activateDelegation({
            walletAddress: currentAuthAddress as string,
            delegationId: selectedDelegation.id,
            delegationHash: permissionId,
            signedDelegation: spec,
          }),
        );
        setSelectedDelegationId(null);

        const toastTitle = isReimbursementBudget
          ? "Reimbursement budget authorized"
          : "Delegation Activated";

        const toastDesc = isReimbursementBudget
          ? `Employees can now submit claims against the ${caveatForm.maxAmountNear} ${TOKEN_SYMBOL} reimbursement budget.`
          : `Assigned ${caveatForm.maxAmountNear} ${TOKEN_SYMBOL} spending limit to ${targetName} on NEAR Testnet`;

        toast.success(toastTitle, {
          description: toastDesc,
          action: {
            label: "View Explorer",
            onClick: () => window.open(getAddressExplorerUrl(delegateAddress), "_blank"),
          },
        });
      } catch (caughtError) {
        toast.error(
          caughtError instanceof Error
            ? caughtError.message
            : "Could not activate delegation",
        );
      }
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
      updateDashboard(await getCompanyDashboardState(addr));
    } catch (caught) {
      toast.error("Invitation Failed", {
        description: caught instanceof Error ? caught.message : "Could not add employee.",
      });
      throw caught;
    } finally {
      setIsAddingEmployee(false);
    }
  }, [currentAuthAddress, profile, updateDashboard]);

  if (auth.status === "unauthenticated") {
    return <ConnectRequiredCard />;
  }

  if (auth.status === "connecting") {
    return (
      <div className="flex h-full min-h-screen items-center justify-center p-6 bg-white">
        <div className="flex flex-col items-center gap-6 text-center">
          <img src="/AllocardLogoBlack.svg" alt="Allocard Logo" className="w-16 h-16 object-contain mb-4" />
          <div className="w-10 h-10 border-4 border-[#eaeaea] border-t-[#111] rounded-full animate-spin"></div>
          <p className="text-xl font-bold text-[#111] tracking-[-0.02em]">Connecting wallet...</p>
        </div>
      </div>
    );
  }

  if (error) {
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
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center gap-8 bg-white">
        <div className="flex flex-col items-center gap-6">
          <svg className="animate-spin text-[#ccc]" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" className="opacity-100 text-[#111]" />
            <path strokeLinecap="round" d="M12 2a10 10 0 0 0-10 10" className="opacity-20" />
          </svg>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-xl font-semibold text-[#111]">
              {isPending ? "Loading company dashboard" : "Verifying access"}
            </p>
            <p className="text-sm text-[#999]">
              {isPending ? "Fetching your delegations and employees..." : "Checking your account status..."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell
      companyName={companyName}
      employees={dashboardState.employees.map((employee) => ({
        id: employee.id,
        label: generateEmployeeReferenceId(employee.walletAddress),
        detail: employee.smartAccountAddress
          ? formatWalletAddress(employee.smartAccountAddress)
          : "Smart account pending",
      }))}
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
        {/* Smart account activation panel */}
        {company && !company.smartAccountAddress && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted/40 p-4">
            <SmartAccountActivationButton
              companyKey={company.id}
              walletAddress={currentAuthAddress!}
              existingSmartAccountAddress={company.smartAccountAddress}
              onActivated={(result) => handleSmartAccountActivated(result.smartAccountAddress)}
            />
          </div>
        )}

        <ReimbursementsCard role="employer" program={dashboardState.reimbursement} accountReady={!!company.smartAccountAddress}
          busy={reimbursementSetup.isPending} onOpen={() => reimbursementSetup.mutate()} onRefresh={() => { void refreshDashboard(); }} />
        <SectionCards
          employeeCount={dashboardState.summary.employeeCount}
          smartAccountBalance={ethBalance ?? "—"}
          activeDelegationCount={dashboardState.summary.activeDelegationCount}
          delegatedNativeNearAllowance={
            dashboardState.summary.delegatedNativeNearAllowance
          }
          onTopUp={handleTopUpTreasury}
          isToppingUp={isToppingUp}
        />

        <Tabs defaultValue="canvas" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="canvas">Delegations</TabsTrigger>
            <TabsTrigger value="activity">Activity Log</TabsTrigger>
            <TabsTrigger value="settings">Company Policy</TabsTrigger>
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
                      Hierarchy View
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
                agents={dashboardState.agents.filter(agent => !isReimbursementAgent(agent)).map((agent) => ({
                  id: agent.id,
                  name: agent.name,
                  smartAccountAddress: agent.smartAccountAddress,
                }))}
                delegations={canvasDelegations}
                onConfigureDelegation={handleConfigureDelegation}
                onDropEmployee={handleDropEmployee}
                onDropAgent={({ agentId, canvasPositionX, canvasPositionY }) =>
                  runDashboardMutation(async () => {
                    const nextState = await createAgentDelegation({
                      walletAddress: currentAuthAddress as string,
                      agentId,
                      canvasPositionX,
                      canvasPositionY,
                    });
                    toast.info("AI Agent Added to Canvas", {
                      description: "Click Configure to set spending rules and caveats for this agent.",
                    });
                    return nextState;
                  })
                }
                onMoveDelegation={handleMoveDelegation}
                onRevokeDelegation={handleRevokeDelegation}
                onRemoveDelegation={handleRemoveDelegation}
              />
            ) : (
              <DelegationCardsView
                company={canvasCompany ?? company}
                employees={canvasEmployees}
                agents={dashboardState.agents.filter(agent => !isReimbursementAgent(agent)).map((agent) => ({
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
                onAddAgent={handleAddAgent}
              />
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Employer Activity Log</h3>
              <p className="text-sm text-muted-foreground mb-6">
                A unified view of all direct employee spends, agent bookings, and reimbursements within your company.
              </p>
              <ActivityLogTable companyId={company.id} />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <CompanyPolicyEditor
              companyPolicy={dashboardState?.companyPolicy ?? null}
              onSave={async (newPolicy) => {
                await mutateDashboard(() => updateCompanyPolicy({
                  walletAddress: currentAuthAddress as string,
                  companyPolicy: newPolicy,
                }));
                toast.success("Company Policy Updated", {
                  description: "AI guidelines and spending policy updated successfully.",
                });
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Drawer
        direction={isMobile ? "bottom" : "right"}
        open={Boolean(selectedDelegation)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDelegationId(null);
            setFormErrors({});
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {isReimbursementBudget
                ? "Reimbursement budget & policy"
                : "Spending Limits & Rules"}
            </DrawerTitle>
            <DrawerDescription>
              {isReimbursementBudget
                ? "Authorize company funds for approved employee claims. To change an active budget, stop payouts and set up a new budget."
                : selectedDelegation?.status === "active"
                  ? "These rules are currently active and enforced on-chain."
                  : "Configure exactly what this delegatee is allowed to do with the company's funds."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-2">
            {selectedDelegation ? (
              <div>
                <Badge
                  variant={selectedDelegation.status === "active" ? "secondary" : "outline"}
                  className="mb-2"
                >
                  {formatDelegationStatus(selectedDelegation.status)}
                </Badge>
              </div>
            ) : null}

            {/* Section 1: Overall Spending Limits */}
            <div className="flex flex-col gap-4">
              <h4 className="text-sm font-semibold text-foreground">
                {isReimbursementBudget
                  ? "1. Reimbursement budget"
                  : "1. Overall Spending Limits"}
              </h4>

              <div className="flex flex-col gap-2">
                <Label htmlFor="max-amount">
                  {isReimbursementBudget
                    ? "Total reimbursement budget"
                    : "Lifetime Spending Limit"}{" "}
                  ({TOKEN_SYMBOL})
                </Label>
                <Input
                  id="max-amount"
                  value={caveatForm.maxAmountNear}
                  className={formErrors.maxAmountNear ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(event) =>
                    setCaveatForm((form) => ({
                      ...form,
                      maxAmountNear: event.target.value,
                    }))
                  }
                />
                {formErrors.maxAmountNear ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.maxAmountNear}</p>
                ) : (
                  <div className="text-[0.8rem] text-muted-foreground space-y-1">
                    <p>
                      {isReimbursementBudget
                        ? "The total amount available for employee claims under this authorization."
                        : <>The absolute maximum amount of {TOKEN_SYMBOL} this delegatee can spend in total over the lifetime of this delegation.</>}
                    </p>
                    {availableBalanceNear !== null && selectedDelegation?.status !== "active" && (
                      <p>
                        Current treasury liquidity (permissions do not reserve it): <span className="font-semibold text-foreground">{Number(availableBalanceNear.toFixed(4))} {TOKEN_SYMBOL}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {!isReimbursementBudget && (
                <div className="flex flex-col gap-2 mt-2">
                  <Label>
                    {"Recurring Allowance"}
                  </Label>
                  <Select
                    value={caveatForm.period}
                    disabled={selectedDelegation?.status === "active"}
                    onValueChange={(period) =>
                      setCaveatForm((form) => ({
                        ...form,
                        period: period as CaveatForm["period"],
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">30 days (fixed)</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <p className="text-[0.8rem] text-muted-foreground">
                    {"Automatically reset their spending limit on a recurring schedule."}
                  </p>
                </div>
              )}

              {!isReimbursementBudget && caveatForm.period !== "none" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="period-amount">
                    {`Allowance per Period (${TOKEN_SYMBOL})`}
                  </Label>
                  <Input
                    id="period-amount"
                    value={caveatForm.periodAmountNear}
                    className={formErrors.periodAmountNear ? "border-destructive" : ""}
                    disabled={selectedDelegation?.status === "active"}
                    onChange={(event) =>
                      setCaveatForm((form) => ({
                        ...form,
                        periodAmountNear: event.target.value,
                      }))
                    }
                  />
                  {formErrors.periodAmountNear ? (
                    <p className="text-[0.8rem] text-destructive">{formErrors.periodAmountNear}</p>
                  ) : (
                    <p className="text-[0.8rem] text-muted-foreground">
                      {"How much they can spend within the selected timeframe."}
                    </p>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Section 2: Transaction Restrictions */}
            <div className="flex flex-col gap-4">
              <h4 className="text-sm font-semibold text-foreground">
                {"2. Transaction Restrictions"}
              </h4>

              <div className="flex flex-col gap-2">
                <Label htmlFor="value-lte">
                  {`Maximum Per-Transaction (${TOKEN_SYMBOL})`}
                </Label>
                <Input
                  id="value-lte"
                  value={caveatForm.perTransactionCapNear}
                  className={formErrors.perTransactionCapNear ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(event) =>
                    setCaveatForm((form) => ({
                      ...form,
                      perTransactionCapNear: event.target.value,
                    }))
                  }
                />
                {formErrors.perTransactionCapNear ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.perTransactionCapNear}</p>
                ) : (
                  <p className="text-[0.8rem] text-muted-foreground">
                    {"The most they can spend in any single transaction. Leave blank for no per-transaction cap."}
                  </p>
                )}
              </div>

              {!isReimbursementBudget && (
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="limited-calls-enabled"
                      checked={caveatForm.limitedCallsEnabled}
                      disabled={selectedDelegation?.status === "active"}
                      onCheckedChange={(checked) =>
                        setCaveatForm((form) => ({
                          ...form,
                          limitedCallsEnabled: checked === true,
                        }))
                      }
                    />
                    <Label htmlFor="limited-calls-enabled">
                      {"Limit Total Transactions"}
                    </Label>
                  </div>
                  {caveatForm.limitedCallsEnabled && (
                    <>
                      <Input
                        value={caveatForm.limitedCalls}
                        disabled={selectedDelegation?.status === "active"}
                        onChange={(event) =>
                          setCaveatForm((form) => ({
                            ...form,
                            limitedCalls: event.target.value,
                          }))
                        }
                        className={cn("mt-1", formErrors.limitedCalls ? "border-destructive" : "")}
                      />
                      {formErrors.limitedCalls ? (
                        <p className="text-[0.8rem] text-destructive">{formErrors.limitedCalls}</p>
                      ) : (
                        <p className="text-[0.8rem] text-muted-foreground">
                          {"Restrict the delegatee to a specific number of total transactions."}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {!isReimbursementBudget && <Separator />}

            {/* Section 3: Target & Address Restrictions */}
            {!isReimbursementBudget && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-semibold text-foreground">
                  {"3. Address Whitelist"}
                </h4>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="targets">
                    {"Permitted Addresses"}
                  </Label>
                  <Input
                    id="targets"
                    value={caveatForm.allowedTargets}
                    className={formErrors.allowedTargets ? "border-destructive" : ""}
                    disabled={selectedDelegation?.status === "active"}
                    onChange={(event) =>
                      setCaveatForm((form) => ({
                        ...form,
                        allowedTargets: event.target.value,
                      }))
                    }
                    placeholder={
                      "One address per line or comma-separated"
                    }
                  />
                  {formErrors.allowedTargets ? (
                    <p className="text-[0.8rem] text-destructive">{formErrors.allowedTargets}</p>
                  ) : formErrors.allowedTargetsWarning ? (
                    <p className="text-[0.8rem] text-amber-500">{formErrors.allowedTargetsWarning}</p>
                  ) : (
                    <p className="text-[0.8rem] text-muted-foreground">
                      {"Only allow sends to these addresses. Leave blank to allow any destination (less secure)."}
                    </p>
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Section 4: AI Policy Prompt */}
            {selectedDelegation?.delegateeType === "agent" && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BotIcon className="h-4 w-4 text-chart-5" />
                  {isReimbursementBudget
                      ? "3. Reimbursement Policy Rules"
                      : "4. AI Policy Prompt"}
                </h4>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="policy-prompt">
                    {isReimbursementBudget
                        ? "Policy Guidelines"
                        : "Natural Language Rules"}
                  </Label>
                  <Textarea
                    id="policy-prompt"
                    value={caveatForm.policyPrompt}
                    disabled={selectedDelegation?.status === "active"}
                    onChange={(event) =>
                      setCaveatForm((form) => ({
                        ...form,
                        policyPrompt: event.target.value,
                      }))
                    }
                    placeholder={
                      isReimbursementBudget
                          ? "e.g. Do not reimburse alcohol. Limit meals to $50. Flights must be economy."
                          : "e.g. Only allow cloud infrastructure purchases. Reject any request over $500 without manager approval."
                    }
                    className="min-h-[100px] resize-none"
                  />
                  <p className="text-[0.8rem] text-muted-foreground">
                    {"These additional rules are used with your company policy to assess expenses. The authorized payment limits still apply."}
                  </p>
                </div>
              </div>
            )}

            <div className="pb-4"></div>
          </div>
          {Boolean(selectedDelegation) && (
            <DrawerFooter className="border-t pt-4">
              {selectedDelegation?.status === "active" ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={isPending}>
                      <BanIcon className="size-4 mr-2" />
                      {isReimbursementBudget
                          ? "Stop reimbursement payouts"
                          : "Revoke delegation"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {isReimbursementBudget
                            ? "This stops new reimbursement payouts under the current budget. Previous payments stay in your activity log. Authorize a new budget to resume payouts."
                            : "This will permanently revoke this active delegation on NEAR Testnet. All child AI agents under this delegation will also lose spending authority immediately."}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          const id = selectedDelegation.id;
                          setSelectedDelegationId(null);
                          handleRevokeDelegation(id);
                        }}
                        className="bg-red-600 text-white hover:bg-red-700"
                      >
                        {isReimbursementBudget
                            ? "Stop payouts"
                            : "Yes, revoke delegation"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : selectedDelegation?.status === "pending_config" ? (
                <Button onClick={handleActivateDelegation} disabled={isPending}>
                  {isPending ? (
                    <LoaderCircleIcon className="size-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheckIcon className="size-4 mr-2" />
                  )}
                  {isReimbursementBudget
                      ? "Authorize reimbursement budget"
                      : "Activate delegation"}
                </Button>
              ) : null}
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </DashboardShell>
  );
}



function CompanyPolicyEditor({
  companyPolicy,
  onSave,
}: {
  companyPolicy: string | null;
  onSave: (policy: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(companyPolicy ?? DEFAULT_COMPANY_POLICY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasChanges = draft !== (companyPolicy ?? DEFAULT_COMPANY_POLICY);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not save company policy.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(DEFAULT_COMPANY_POLICY);
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-neutral-800">Company Expense Policy</h3>
        <p className="mt-1 text-sm text-neutral-500">
          This policy is the single source of truth for all Qwen AI checks:
          reimbursements, direct spends, and agent decisions. Edit once, applied everywhere.
        </p>
      </div>

      {saveError && <p role="alert" className="mb-3 text-sm text-destructive">{saveError}</p>}
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="min-h-[280px] font-mono text-sm resize-y"
        placeholder="Enter your company expense policy..."
      />

      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            size="sm"
          >
            {saving ? "Saving..." : saved ? "✓ Saved" : "Save Policy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
          >
            Reset to Default
          </Button>
        </div>
        {saved && (
          <span className="text-xs text-green-600 font-medium">
            Policy saved: all Qwen AI checks now use this policy.
          </span>
        )}
        {!hasChanges && !saved && (
          <span className="text-xs text-neutral-400">
            No changes to save.
          </span>
        )}
      </div>
    </div>
  );
}

