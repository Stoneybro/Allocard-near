"use client";

import { CompanyResearchActivity } from "@/components/purchasing-research-panel";

import { useSettlementRefresh } from "@/hooks/use-account-queries";
import { DashboardLoading } from "@/components/dashboard-loading";

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
  Sparkles,
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
  activateDelegation,
  createAgentDelegation,
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
import { SectionCards } from "@/components/section-cards";
import { SmartAccountActivationButton } from "@/components/smart-account-activation-button";
import { TopUpTreasuryDialog } from "@/components/top-up-treasury-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
  const refreshAfterSettlement = useSettlementRefresh();
  const currentAuthAddress = auth.status === "authenticated" ? (auth.address) : undefined;
  const { profile, setProfile, dashboardState, setDashboardState, mutate: mutateDashboard, refresh: refreshDashboard, error: queryError } =
    useDashboardData<CompanyDashboardState>("employer", initialProfile, initialDashboardState);
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(
    null,
  );
  const [caveatForm, setCaveatForm] = useState<CaveatForm>(emptyCaveatForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [isParsingPolicy, setIsParsingPolicy] = useState(false);
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
  const [isTopUpDialogOpen, setIsTopUpDialogOpen] = useState(false);
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

  const handleParsePolicyPrompt = async () => {
    const promptText = caveatForm.policyPrompt.trim();
    if (!promptText) {
      toast.error("Please enter a natural language instruction first");
      return;
    }
    setIsParsingPolicy(true);
    try {
      const delegateAddress = selectedDelegation ? resolveDelegateAddress(selectedDelegation) : undefined;
      const response = await fetch("/api/policies/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: promptText,
          delegateAccount: delegateAddress,
          companyId: company?.id,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to parse instructions with AI");
      }
      const result = await response.json();
      if (result.formValues) {
        setCaveatForm((prev) => ({
          ...prev,
          maxAmountNear: result.formValues.maxAmountNear || prev.maxAmountNear,
          period: result.formValues.period || prev.period,
          periodAmountNear: result.formValues.periodAmountNear || prev.periodAmountNear,
          perTransactionCapNear: result.formValues.perTransactionCapNear || prev.perTransactionCapNear,
          allowedTargets: result.formValues.allowedTargets || prev.allowedTargets,
        }));
        toast.success("Card Limits Configured by NEAR AI", {
          description: "Limits, recurring period, and caveats were parsed from your prompt.",
        });
      }
    } catch (err) {
      toast.error("AI Parsing Failed", {
        description: err instanceof Error ? err.message : "Could not compile natural language prompt.",
      });
    } finally {
      setIsParsingPolicy(false);
    }
  };


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

        toast.success("Delegation Activated", {
          description: `Assigned ${caveatForm.maxAmountNear} ${TOKEN_SYMBOL} spending limit to ${targetName} on NEAR Testnet`,
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

  if (auth.status === "unauthenticated") {
    return <ConnectRequiredCard />;
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
        {error && <p role="alert" className="text-sm text-muted-foreground">{error}</p>}
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

        <SectionCards
          employeeCount={dashboardState.summary.employeeCount}
          balanceLoading={treasuryBalance.isPending && !!company.smartAccountAddress}
          smartAccountBalance={ethBalance ?? "—"}
          activeDelegationCount={dashboardState.summary.activeDelegationCount}
          delegatedNativeNearAllowance={
            dashboardState.summary.delegatedNativeNearAllowance
          }
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

        <CompanyResearchActivity companyId={company.id} />

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
                agents={dashboardState.agents.map((agent) => ({
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
                onAddAgent={handleAddAgent}
              />
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Employer Activity Log</h3>
              <p className="text-sm text-muted-foreground mb-6">
                A unified view of all direct employee spends and corporate card delegations within your company.
              </p>
              <ActivityLogTable companyId={company.id} />
            </div>
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
            <DrawerTitle>Spending Limits & Rules</DrawerTitle>
            <DrawerDescription>
              {selectedDelegation?.status === "active"
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
                {"1. Overall Spending Limits"}
              </h4>

              <div className="flex flex-col gap-2">
                <Label htmlFor="max-amount">
                  {"Lifetime Spending Limit"} ({TOKEN_SYMBOL})
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
                      The absolute maximum amount of {TOKEN_SYMBOL} this delegatee can spend in total over the lifetime of this delegation.
                    </p>
                    {availableBalanceNear !== null && selectedDelegation?.status !== "active" && (
                      <p>
                        Current treasury liquidity (permissions do not reserve it): <span className="font-semibold text-foreground">{Number(availableBalanceNear.toFixed(4))} {TOKEN_SYMBOL}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>

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

              {caveatForm.period !== "none" && (
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
            </div>

            <Separator />

            {/* Section 3: Target & Address Restrictions */}
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

            <Separator />

            {/* Section 4: Natural Language Card Prompt */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {"4. Natural Language Card Rules"}
                </h4>
                {selectedDelegation?.status !== "active" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleParsePolicyPrompt}
                    disabled={isParsingPolicy || !caveatForm.policyPrompt.trim()}
                    className="h-7 text-xs gap-1.5"
                  >
                    {isParsingPolicy ? (
                      <LoaderCircleIcon className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5 text-primary" />
                    )}
                    {isParsingPolicy ? "Parsing..." : "Auto-fill with AI"}
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="policy-prompt">
                  Describe spending limits in plain English
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
                  placeholder="e.g. Allow up to 500 NEAR monthly with a 100 NEAR per-transaction limit for official vendors."
                  className="min-h-[80px] resize-none text-xs"
                />
                <p className="text-[0.8rem] text-muted-foreground">
                  Type your instructions and tap <strong>Auto-fill with AI</strong> to instantly configure the on-chain parameters.
                </p>
              </div>
            </div>

            <div className="pb-4"></div>
          </div>
          {Boolean(selectedDelegation) && (
            <DrawerFooter className="border-t pt-4">
              {selectedDelegation?.status === "active" ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={isPending}>
                      <BanIcon className="size-4 mr-2" />
                      {"Revoke delegation"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {"This will permanently revoke this active delegation on NEAR Testnet."}
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
                        {"Yes, revoke delegation"}
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
                  {"Activate delegation"}
                </Button>
              ) : null}
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </DashboardShell>
  );
}


