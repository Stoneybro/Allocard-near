"use client";
import { employeeDemoScope } from "@/lib/demo-guide-preferences";

import { revokeAndSyncEmployeeAgent } from "@/lib/employee-revocation";
import { agentDisplayName } from "@/lib/agent-adapter/shared";
import { EmployeeAgentsWorkspace } from "@/components/employee-agents-workspace";
import { EmployeeSpendingWorkspace } from "@/components/employee-spending-workspace";

import { useSettlementRefresh } from "@/hooks/use-account-queries";
import { DashboardLoading } from "@/components/dashboard-loading";
import { useDashboardData } from "@/hooks/use-account-queries";
import { preparePendingPayment } from "@/lib/pending-payment";
import { clearAdapterPermissionIntent } from "@/lib/near-sponsor-client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LoaderCircleIcon,
  ShieldCheckIcon,
  BotIcon,
  ExternalLink,
  BanIcon,
  ShieldAlertIcon,
  PlaneIcon,
  ShoppingCartIcon,
  CpuIcon,
  SparklesIcon,
  PlayIcon,
  Settings2Icon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createAgentRedelegation,
  activateEmployeeDelegation,
  revokeEmployeeDelegation,
  saveEmployeeRedelegationCaveats,
  setWorkspaceContext,
  type EmployeeDashboardState,
  type WorkspaceOption,
  type WalletProfile,
} from "@/app/actions/identity";
import { useAuth } from "@/components/AuthProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { DashboardShell } from "@/components/dashboard-shell";
import { type SidebarAgent } from "@/components/app-sidebar";
import { EmployeeSectionCards } from "@/components/employee-section-cards";
import { SmartAccountActivationButton } from "@/components/smart-account-activation-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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
import { Textarea } from "@/components/ui/textarea";
import { DirectSpendForm } from "./DirectSpendForm";
import { cn } from "@/lib/utils";
import { formatWalletAddress, getEmployeeDisplayIdentity, isValidWalletAddress } from "@/lib/wallet";
import { SPENDING_DECIMALS, SPENDING_ASSET, sameAsset, TOKEN_SYMBOL, getAddressExplorerUrl, getTxExplorerUrl } from "@/lib/chain";
import { decodeMutationId, type PermissionSpec } from "@allocard/delegation-sdk";
import {
  getUnifiedNearCaller,
  getTreasuryClient,
  parseTokenAmount,
  formatTokenAmount,
} from "@/lib/near";

// ── Types ───────────────────────────────────────────────────────────────────

type DelegationRow = EmployeeDashboardState["outboundDelegations"][number];

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

type FormErrors = {
  maxAmountNear?: string;
  periodAmountNear?: string;
  perTransactionCapNear?: string;
  limitedCalls?: string;
  allowedTargets?: string;
  allowedTargetsWarning?: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const periodDurations = {
  hourly: 60 * 60,
  daily: 60 * 60 * 24,
  weekly: 60 * 60 * 24 * 7,
  monthly: 60 * 60 * 24 * 30,
} as const;

const NEAR_AMOUNT_RE = /^\d+(\.\d+)?$/;

function buildEmptyCaveatForm(parentMaxNear: string): CaveatForm {
  return {
    maxAmountNear: parentMaxNear,
    period: "none",
    periodAmountNear: "",
    perTransactionCapNear: "",
    allowedTargets: "",
    limitedCallsEnabled: false,
    limitedCalls: "1",
    policyPrompt: "",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitAddresses(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function caveatRecord(caveat: DelegationRow["caveats"][number]) {
  return caveat.caveatValue && typeof caveat.caveatValue === "object"
    ? (caveat.caveatValue as Record<string, unknown>)
    : {};
}

function formFromDelegation(
  delegation: DelegationRow | null,
  parentMaxNear: string,
): CaveatForm {
  if (!delegation) return buildEmptyCaveatForm(parentMaxNear);

  const nextForm: CaveatForm = buildEmptyCaveatForm(parentMaxNear);

  for (const caveat of delegation.caveats) {
    const value = caveatRecord(caveat);

    if (caveat.caveatType === "nativeTokenTransferAmount") {
      const yocto = value.maxAmount ?? value.amount;
      nextForm.maxAmountNear = typeof yocto === "string" ? yoctoToNearInput(yocto) : parentMaxNear;
    }

    if (caveat.caveatType === "nativeTokenPeriodTransfer") {
      const period = value.period;
      const amount = value.periodAmount ?? value.amount;
      nextForm.period =
        period === "hourly" || period === "daily" || period === "weekly" || period === "monthly"
          ? period
          : "daily";
      nextForm.periodAmountNear = typeof amount === "string" ? yoctoToNearInput(amount) : "";
    }

    if (caveat.caveatType === "valueLte") {
      const maxValue = value.maxValue ?? value.valueYocto;
      nextForm.perTransactionCapNear = typeof maxValue === "string" ? yoctoToNearInput(maxValue) : "";
    }

    if (caveat.caveatType === "allowedTargets" && Array.isArray(value.targets)) {
      nextForm.allowedTargets = (value.targets as string[]).join("\n");
    }

    if (caveat.caveatType === "limitedCalls") {
      nextForm.limitedCallsEnabled = true;
      nextForm.limitedCalls = typeof value.limit === "number" ? String(value.limit) : "1";
    }
  }

  return nextForm;
}

function yoctoToNearInput(amount: string) {
  return formatTokenAmount(amount, SPENDING_DECIMALS);
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

function validateCaveatForm(form: CaveatForm, availableMaxNear: string): FormErrors {
  const errors: FormErrors = {};
  const availableMax = parseFloat(availableMaxNear);

  if (!NEAR_AMOUNT_RE.test(form.maxAmountNear.trim())) {
    errors.maxAmountNear = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.005).`;
  } else {
    const max = parseFloat(form.maxAmountNear);
    if (max <= 0) {
      errors.maxAmountNear = "Spending limit must be greater than 0.";
    } else if (availableMaxNear && !isNaN(availableMax)) {
      if (max > availableMax) {
        errors.maxAmountNear = `Cannot exceed your remaining delegated balance of ${availableMaxNear} ${TOKEN_SYMBOL}.`;
      }
    }
  }

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
        errors.periodAmountNear = `Period allowance cannot exceed the lifetime limit (${form.maxAmountNear} ${TOKEN_SYMBOL}).`;
      }
    }
  }

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
          errors.perTransactionCapNear = `Per-transaction cap cannot exceed ${form.period !== "none" ? `the period allowance (${form.periodAmountNear} ${TOKEN_SYMBOL})` : `the lifetime limit (${form.maxAmountNear} ${TOKEN_SYMBOL})`}.`;
        }
      }
    }
  }

  if (form.limitedCallsEnabled) {
    const n = Number(form.limitedCalls);
    if (!Number.isInteger(n) || n < 1) {
      errors.limitedCalls = "Transaction limit must be a whole number ≥ 1.";
    }
  }

  const addresses = splitAddresses(form.allowedTargets);
  const invalidAddresses = addresses.filter((a) => !isValidWalletAddress(a));
  if (invalidAddresses.length > 0) {
    errors.allowedTargets = `Invalid account${invalidAddresses.length > 1 ? "s" : ""}: ${invalidAddresses.join(", ")}`;
  } else if (addresses.length === 0) {
    errors.allowedTargetsWarning = "No accounts specified — the agent can send to any NEAR account.";
  }

  return errors;
}

// ── Component ────────────────────────────────────────────────────────────────

export function EmployeeClient({
  initialProfile,
  initialDashboardState,
}: {
  initialProfile?: WalletProfile | null;
  initialDashboardState?: EmployeeDashboardState | null;
} = {}) {
  const router = useRouter();
  const auth = useAuth();
  const refreshAfterSettlement = useSettlementRefresh();
  const isMobile = useIsMobile();
  const currentAuthAddress = auth.status === "authenticated" ? (auth.address) : undefined;
  const { profile, dashboardState, setDashboardState, mutate: mutateDashboard, refresh: refreshDashboard, error: queryError } =
    useDashboardData<EmployeeDashboardState>("employee", initialProfile, initialDashboardState);
  const workspaceOptions = (profile && "workspaces" in profile && profile.workspaces) || [];
  const activeCompanyId = profile?.user?.companyId ?? "";
  const [isPending, startTransition] = useTransition();
  const revocationLock = useRef(false);
  const [revokingAgent, setRevokingAgent] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [activatingDelegation, setActivatingDelegation] = useState(false);
  const [activationStage, setActivationStage] = useState<"checking" | "signing" | "confirming" | null>(null);
  const activationLock = useRef(false);
  const [actionError, setError] = useState<string | null>(null);
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(null);
  const [caveatForm, setCaveatForm] = useState<CaveatForm>(buildEmptyCaveatForm(""));
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  const error = actionError ?? queryError?.message ?? dashboardState?.summary.capacityError;

  // ── Derived values ─────────────────────────────────────────────────────────

  const remainingYocto = BigInt(parseTokenAmount(dashboardState?.summary.remainingNear ?? "0", SPENDING_DECIMALS));

  const parentMaxNear = useMemo(() => {
    try {
      const inbound = dashboardState?.inboundDelegation;
      if (!inbound) return "0";
      const caveat = inbound.caveats.find((c) => c.caveatType === "nativeTokenTransferAmount");
      if (!caveat) return "0";
      const val = caveat.caveatValue as Record<string, unknown>;
      const yocto = BigInt(String(val.maxAmount ?? val.amount ?? "0"));
      return yoctoToNearInput(yocto.toString());
    } catch { return "0"; }
  }, [dashboardState?.inboundDelegation]);

  const availableMaxNear = useMemo(() => {
    let baseRemaining = remainingYocto;
    if (selectedDelegationId && dashboardState) {
      const currentDel = dashboardState.outboundDelegations.find(d => d.id === selectedDelegationId);
      if (currentDel && currentDel.status === "active") {
        const caveat = currentDel.caveats.find((c) => c.caveatType === "nativeTokenTransferAmount");
        if (caveat) {
          const val = caveat.caveatValue as Record<string, unknown>;
          const currentYocto = BigInt(String(val.maxAmount ?? val.amount ?? "0"));
          baseRemaining += currentYocto;
        }
      }
    }
    return baseRemaining > 0n ? yoctoToNearInput(baseRemaining.toString()) : "0";
  }, [remainingYocto, selectedDelegationId, dashboardState]);

  const selectedDelegation = useMemo(
    () => dashboardState?.outboundDelegations.find((d) => d.id === selectedDelegationId) ?? null,
    [dashboardState?.outboundDelegations, selectedDelegationId],
  );

  // ── Sidebar agent list ─────────────────────────────────────────────────────
  // Agents come from identity.ts getEmployeeDashboardState — not yet returned in
  // EmployeeDashboardState, but the sidebar will use company agents once Phase 6
  // adds the catalog. For now we pass an empty array (placeholder agents show).
  // Platform agents come from dashboardState.agents (populated by getEmployeeDashboardState).
  const sidebarAgents = useMemo((): SidebarAgent[] => {
    if (!dashboardState) return [];

    // 1. Live platform agents from database
    const liveAgents: SidebarAgent[] = (dashboardState.agents ?? [])
      .map((agent) => {
        const delegation = dashboardState.outboundDelegations.find(
          (d) => d.delegateeId === agent.id && d.status !== "revoked"
        );
        const isActive = delegation?.status === "active";

        return {
          id: agent.id,
          name: agentDisplayName(agent.name),
          detail: agent.description ?? "Platform AI agent",
          isPlaceholder: false,
          status: isActive ? "active" : "ready",
        };
      });

    // 2. Inactive / Catalog Preview Agents
    const inactiveAgents: SidebarAgent[] = [
      {
        id: "placeholder-travel-concierge",
        name: "Travel Concierge",
        detail: "Autonomous corporate flight & hotel booking",
        isPlaceholder: true,
        status: "coming_soon",
      },
      {
        id: "placeholder-saas-subscription",
        name: "SaaS Subscription Agent",
        detail: "License seats & API quota renewals",
        isPlaceholder: true,
        status: "coming_soon",
      },
      {
        id: "placeholder-expense-reviewer",
        name: "Expense Reviewer",
        detail: "Flags out-of-policy spend automatically",
        isPlaceholder: true,
        status: "coming_soon",
      },
      {
        id: "placeholder-budget-guard",
        name: "Budget Guard",
        detail: "Enforces period budgets across delegations",
        isPlaceholder: true,
        status: "coming_soon",
      },
      {
        id: "placeholder-approval-bot",
        name: "Approval Bot",
        detail: "Routes high-value spend to the right approver",
        isPlaceholder: true,
        status: "coming_soon",
      },
    ];

    return [...liveAgents, ...inactiveAgents];
  }, [dashboardState]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function formatNearTrimmed(yocto: bigint) {
    const s = yoctoToNearInput(yocto.toString());
    if (!s.includes(".")) return s;
    return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  }

  const runEmployeeMutation = useCallback(
    (mutation: () => Promise<EmployeeDashboardState>) => {
      setError(null);
      startTransition(async () => {
        try {
          await mutateDashboard(mutation);
        } catch (caughtError) {
          const message = caughtError instanceof Error ? caughtError.message : "Action failed";
          setError(message);
          toast.error("Operation Failed", { description: message });
        }
      });
    },
    [mutateDashboard],
  );

  const handleSmartAccountActivated = (smartAccountAddress: string | null) => {
    if (!smartAccountAddress) return;

    toast.success("NEAR Account Activated", {
      description: `Employee account is active on NEAR Testnet (${smartAccountAddress})`,
      action: {
        label: "View Explorer",
        onClick: () => window.open(getAddressExplorerUrl(smartAccountAddress), "_blank"),
      },
    });
    setDashboardState((current) => {
      if (!current) return current;
      return { ...current, employee: { ...current.employee, smartAccountAddress } };
    });
  };

  // Open drawer for existing delegation (configure / view rules)
  const handleConfigureDelegation = useCallback(
    (delegationId: string) => {
      const delegation =
        dashboardState?.outboundDelegations.find((d) => d.id === delegationId) ?? null;

      // Open the caveat configuration drawer
      setSelectedDelegationId(delegationId);
      // Wait for React to process selectedDelegationId state update so availableMaxNear recalculates
      setTimeout(() => {
        setCaveatForm(formFromDelegation(delegation, availableMaxNear));
        setFormErrors({});
      }, 0);
    },
    [dashboardState, availableMaxNear],
  );

  // Agent selector / budget assigner
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      if (auth.status !== "authenticated" || !auth.address || !dashboardState) return;
      const walletAddress = auth.address;
      setError(null);


      // If already delegated, open rules or task drawer
      const existing = dashboardState.outboundDelegations.find(
        (d) => d.delegateeId === agentId && d.status !== "revoked"
      );
      if (existing) {
        handleConfigureDelegation(existing.id);
        return;
      }

      // Guard: Check if employee has an active inbound delegation from the employer
      if (!dashboardState.inboundDelegation || dashboardState.inboundDelegation.status !== "active") {
        toast.warning("No Spending Allowance Delegated", {
          description:
            "Your company has not delegated spending funds to you yet. Please ask your employer to configure an allowance for you first before assigning funds to agents.",
        });
        return;
      }

      setCreatingAgent(true);
      startTransition(async () => {
        try {
          const pending = await createAgentRedelegation({ walletAddress, agentId });
          setDashboardState(current => current && current.company.id === dashboardState.company.id ? {
            ...current,
            outboundDelegations: [...current.outboundDelegations.filter(row => row.id !== pending.id), pending],
          } : current);
          setSelectedDelegationId(pending.id);
          setCaveatForm(formFromDelegation(pending, parentMaxNear));
          setFormErrors({});
        } catch (caughtError) {
          const message = caughtError instanceof Error ? caughtError.message : "Could not create redelegation";
          if (
            message.toLowerCase().includes("inbound") ||
            message.toLowerCase().includes("activate a delegation")
          ) {
            toast.warning("No Spending Allowance Delegated", {
              description:
                "Your company has not delegated spending funds to you yet. Please ask your employer to configure an allowance for you first before assigning funds to agents.",
            });
          } else {
            toast.error("Unable to Add Agent", {
              description: message,
            });
          }
        } finally {
          setCreatingAgent(false);
        }
      });
    },
    [auth, parentMaxNear, dashboardState, handleConfigureDelegation, setDashboardState],
  );

  // Revoke on-chain before reconciling the saved delegation and its descendants.
  const handleRevokeDelegation = useCallback(
    (delegationId: string) => {
      if (revocationLock.current || auth.status !== "authenticated" || !auth.address) return;
      const walletAddress = auth.address;
      const target = dashboardState?.outboundDelegations.find(row => row.id === delegationId);
      const treasury = dashboardState?.company.smartAccountAddress;
      if (!target || target.status !== "active" || !target.delegationHash || !treasury) {
        toast.error("An active agent permission and company treasury are required.");
        return;
      }
      const permissionId = target.delegationHash;
      const agent = dashboardState?.agents.find(item => item.id === target.delegateeId);
      revocationLock.current = true;
      setRevokingAgent(true);
      runEmployeeMutation(async () => {
        try {
          const caller = await getUnifiedNearCaller(auth);
          const client = getTreasuryClient(caller, treasury);
          const nextState = await revokeAndSyncEmployeeAgent(permissionId, client, () => revokeEmployeeDelegation({ walletAddress, delegationId }));
          toast.success("Agent delegation revoked", { description: `Spending access for ${agent ? agentDisplayName(agent.name) : "this agent"} has been revoked on NEAR Testnet.` });
          setSelectedDelegationId(current => current === delegationId ? null : current);
          return nextState;
        } finally {
          revocationLock.current = false;
          setRevokingAgent(false);
        }
      });
    },
    [auth, dashboardState, runEmployeeMutation],
  );

  // Task 6: save caveats then sign and activate the delegation
  const handleActivateDelegation = useCallback(() => {
    if (activationLock.current || auth.status !== "authenticated" || !selectedDelegation || !auth.address) return;
    const walletAddress = auth.address;

    const errors = validateCaveatForm(caveatForm, availableMaxNear);
    setFormErrors(errors);
    const hasErrors = Object.keys(errors).some(
      (k) => k !== "allowedTargetsWarning" && errors[k as keyof FormErrors],
    );
    if (hasErrors) return;

    activationLock.current = true;
    setActivatingDelegation(true);
    setActivationStage("checking");
    setError(null);
    startTransition(async () => {
      try {
        const treasury = dashboardState?.company.smartAccountAddress;
        const parentPermissionId = dashboardState?.inboundDelegation?.delegationHash;
        const agent = dashboardState?.agents.find(row => row.id === selectedDelegation.delegateeId);
        const agentSmartAccountAddress = agent?.smartAccountAddress;
        if (!treasury || !parentPermissionId || !agentSmartAccountAddress) throw new Error("A treasury, active allowance and configured agent are required");
        const parsedLimit = caveatForm.maxAmountNear ? parseTokenAmount(caveatForm.maxAmountNear, SPENDING_DECIMALS) : null;
        const parsedPerTx = caveatForm.perTransactionCapNear ? parseTokenAmount(caveatForm.perTransactionCapNear, SPENDING_DECIMALS) : null;

        // Persist the rules and read the live parent concurrently. The server checks
        // the agent identity and full permission ancestry again before sponsorship.
        const [, liveParent] = await Promise.all([
          saveEmployeeRedelegationCaveats({ walletAddress, delegationId: selectedDelegation.id, caveats: buildServerCaveats(caveatForm) }),
          (async () => {
            const childCaller = await getUnifiedNearCaller(auth);
            return getTreasuryClient(childCaller, treasury).getPermission(parentPermissionId);
          })(),
        ]);
        const parentRule = liveParent?.rules.find(rule => sameAsset(rule.asset, SPENDING_ASSET));
        if (!liveParent || !parentRule || liveParent.revoked || liveParent.delegate !== walletAddress) throw new Error("Employee permission is unavailable");
        const childSpec: PermissionSpec = {
          delegate: agentSmartAccountAddress,
          valid_from_ms: Date.now().toString(),
          expires_at_ms: liveParent.expires_at_ms,
          max_executions: caveatForm.limitedCallsEnabled && caveatForm.limitedCalls ? Number(caveatForm.limitedCalls) : liveParent.max_executions,
          rules: [
            {
              asset: SPENDING_ASSET,
              recipients: caveatForm.allowedTargets && caveatForm.allowedTargets.length > 0
                ? { type: "Only", accounts: splitAddresses(caveatForm.allowedTargets) }
                : parentRule.recipients,
              min_per_action: parentRule.min_per_action,
              max_per_action: parsedPerTx ?? parentRule.max_per_action,
              lifetime_limit: parsedLimit,
              fixed_window: parentRule.fixed_window,
              streaming: parentRule.streaming,
              approval: parentRule.approval,
              acknowledge_unbounded_budget: !parsedLimit,
            },
          ],
          redelegation_depth: 0,
          metadata_hash: null,
        };

        setActivationStage("signing");
        const sponsored = await auth.createAdapterPermission({ treasury, delegationId: selectedDelegation.id, parentId: parentPermissionId, spec: childSpec });
        const delegationHash = decodeMutationId(sponsored && typeof sponsored === "object" && "adapterPermissionId" in sponsored ? sponsored.adapterPermissionId : sponsored);

        setActivationStage("confirming");
        const activated = await activateEmployeeDelegation({
          walletAddress,
          delegationId: selectedDelegation.id,
          delegationHash,
          signedDelegation: childSpec,
        });
        setDashboardState(current => current && current.company.id === dashboardState.company.id ? {
          ...current,
          outboundDelegations: current.outboundDelegations.map(row => row.id === activated.id ? activated : row),
        } : current);
        clearAdapterPermissionIntent(walletAddress, selectedDelegation.id);
        setSelectedDelegationId(null);
        toast.success("Successfully delegated for agent use", {
          description: `Agent access is ready with a ${caveatForm.maxAmountNear} ${TOKEN_SYMBOL} limit. You can now add an agent and start a task.`,
        });
        void refreshDashboard().catch(() => undefined);

      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : "Could not activate delegation";
        setError(message);
        console.error("[employee adapter activation]", message);
        toast.error("Agent access not confirmed", { description: message });
      } finally {
        activationLock.current = false;
        setActivatingDelegation(false);
        setActivationStage(null);
      }
    });
  }, [selectedDelegation, auth, caveatForm, availableMaxNear, dashboardState, setDashboardState, refreshDashboard]);



  // Persist a request before signing. Retrying an uncertain dispatch reuses it.
  const handleExecuteSpend = async (details: { toAddress: string; amountNear: string; purpose?: string; isFlagged?: boolean }) => {
    if (auth.status !== "authenticated") throw new Error("Connect your NEAR signing wallet");
    const activePermissionId = dashboardState?.inboundDelegation?.delegationHash;
    const company = dashboardState?.company;
    const treasury = company?.smartAccountAddress;
    if (!company || !treasury) throw new Error("A company treasury is required");
    const caller = await getUnifiedNearCaller(auth);
    if (!caller.functionCall) throw new Error("A signing wallet is required");
    const client = getTreasuryClient(caller, treasury);
    const key = `allocard-payment:${treasury}:${auth.accountId}`;
    const amount = parseTokenAmount(details.amountNear, SPENDING_DECIMALS);
    const { saved, existing } = await preparePendingPayment({
      storage: localStorage, key, companyId: company.id,
      receiver: details.toAddress, amount, activePermissionId,
      delegationId: dashboardState?.inboundDelegation?.id,
      readExecution: requestId => client.getExecutionByRequest(auth.accountId, requestId),
    });
    if (!existing) {
      const preview = await client.previewExecute(auth.accountId, saved.request);
      if (!preview.allowed) { if (!saved.attempted) localStorage.removeItem(key); throw new Error(preview.error_message || preview.error_code || "Payment is outside your spending permission"); }
    }
    saved.attempted = true;
    localStorage.setItem(key, JSON.stringify(saved));
    const outcome = await client.execute(saved.request);
    saved.executionId = outcome.executionId;
    saved.transactionHash = saved.transactionHash || outcome.transactionHash;
    localStorage.setItem(key, JSON.stringify(saved));
    const record = await outcome.waitForOutcome(60000, 1500);
    if (record.status === "Failed") {
      localStorage.removeItem(key);
      throw new Error("The transfer failed. Funds and budget were released; a new attempt needs a new request.");
    }
    if (!saved.transactionHash) throw new Error("Payment settled but its transaction reference is missing. Keep this request for reconciliation.");
    const response = await fetch("/api/wallet/spend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      companyId: dashboardState?.company?.id, employeeId: dashboardState?.employee?.id,
      delegationId: saved.delegationId || dashboardState?.inboundDelegation?.id, ...details, txHash: saved.transactionHash, executionId: outcome.executionId,
    }) });
    if (!response.ok) {
      const failure = await response.json();
      throw new Error(`Payment settled on-chain, but history was not saved: ${failure.error || "retry the same payment to synchronize"}`);
    }
    localStorage.removeItem(key);
    refreshAfterSettlement();
    return saved.transactionHash;
  };

  useEffect(() => {
    if (auth.status === "unauthenticated") {
      router.replace("/");
    }
  }, [auth.status, router]);

  // ── Render guards ──────────────────────────────────────────────────────────

  if (auth.status === "unauthenticated") {
    return <DashboardLoading role="employee" />;
  }

  if (auth.status === "connecting") return <DashboardLoading role="employee" />;

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

  if (!dashboardState) {
    return <DashboardLoading role="employee" />;
  }

  const { employee, company, summary } = dashboardState;

  const smartAccountLabel = employee.smartAccountAddress
    ? formatWalletAddress(employee.smartAccountAddress)
    : "Treasury pending";
  const employeeIdentity = getEmployeeDisplayIdentity(employee);

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <DashboardShell
      demoGuide={{
        scope: employeeDemoScope(currentAuthAddress || employee.walletAddress, company.id),
        role: "employee",
        step: dashboardState.inboundDelegation?.status === "active" ? 2 : 1,
      }}
      companyName={company.name}
      companyId={activeCompanyId || undefined}
      workspaceOptions={workspaceOptions}
      onWorkspaceChange={(companyId, role) => {
        startTransition(async () => {
          try {
            await setWorkspaceContext({
              walletAddress: (currentAuthAddress || employee.walletAddress) as string,
              companyId,
              role,
            });
            setDashboardState(null);
            window.location.assign(role === "employer" ? "/employer" : "/employee");
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Could not switch workspace");
          }
        });
      }}
      smartAccountLabel={smartAccountLabel}
      smartAccountAddress={employee.smartAccountAddress}
      title="Employee dashboard"
      roleLabel="Employee"
      role="employee"
      employeeReferenceId={employeeIdentity.label}
      employeeFullEmail={employeeIdentity.fullEmail}
      agents={sidebarAgents}
      onSelectAgent={handleSelectAgent}
      onRefreshEmployees={refreshDashboard}
      employeesRefreshing={isPending}
    >
      <div className="flex min-w-0 flex-col gap-4">
        {/* Treasury activation banner */}
        {!employee.smartAccountAddress && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                Treasury not yet activated
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Activate your treasury so the company can delegate spending authority to you.
              </p>
            </div>
            <SmartAccountActivationButton
              mode="employee"
              walletAddress={(currentAuthAddress || employee.walletAddress)}
              existingSmartAccountAddress={employee.smartAccountAddress}
              onActivated={(result) => handleSmartAccountActivated(result.smartAccountAddress)}
            />
          </div>
        )}

        {/* Global error banner */}
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <p className="text-sm font-medium text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(null); void refreshDashboard(); }}>Retry</Button>
          </div>
        )}

        {/* Summary cards */}
        <EmployeeSectionCards
          approvedLimitNear={summary.approvedLimitNear}
          redelegatedNear={summary.redelegatedNear}
          remainingNear={formatNearTrimmed(remainingYocto)}
          spentNear={summary.spentNear}
          reservationsSupported={summary.reservationsSupported}
        />

        {summary.reservationsSupported === false && <p className="text-xs leading-relaxed text-muted-foreground">This workspace uses shared agent limits. Reserved agent budgets require a workspace on the new treasury release.</p>}
        <EmployeeSpendingWorkspace
          agents={<EmployeeAgentsWorkspace companyId={company.id} agents={dashboardState.agents}
            delegations={dashboardState.outboundDelegations}
            canAdd={dashboardState.inboundDelegation?.status === "active"} busy={creatingAgent || activatingDelegation || revokingAgent || isPending} settingUp={creatingAgent}
            onSelectAgent={handleSelectAgent} onConfigure={handleConfigureDelegation} onRevoke={handleRevokeDelegation} />}
          directPayment={
          <DirectSpendForm
            loading={!!queryError || !!dashboardState.summary.capacityError}
            companyId={dashboardState.company.id}
            key={`${dashboardState.company?.smartAccountAddress ?? "none"}:${auth.status === "authenticated" ? auth.accountId : "signed-out"}`}
            delegationId={dashboardState.inboundDelegation?.id || ""}
            pendingStorageKey={dashboardState.company?.smartAccountAddress && auth.status === "authenticated" ? `allocard-payment:${dashboardState.company.smartAccountAddress}:${auth.accountId}` : undefined}
            remainingBalanceNear={formatNearTrimmed(remainingYocto)}
            onExecute={handleExecuteSpend}
          />
          }
        />
      </div>

      {/* ── Caveat Configuration Drawer (Tasks 5 & 6) ──────────────────────── */}
      <Drawer
        direction={isMobile ? "bottom" : "right"}
        open={Boolean(selectedDelegation)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDelegationId(null);
            setFormErrors({});
            setError(null);
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Agent policy</DrawerTitle>
            <DrawerDescription>
              {selectedDelegation?.status === "active"
                ? "These rules are active for agent use and follow your employer’s allowance."
                : "Set spending rules for agent use within your employer’s allowance. Gas is sponsored."}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-2">
            {actionError && <p role="alert" className="break-words text-sm text-muted-foreground">{actionError}</p>}
            {selectedDelegation && (
              <div>
                <Badge
                  variant={selectedDelegation.status === "active" ? "secondary" : "outline"}
                  className="mb-2"
                >
                  {formatDelegationStatus(selectedDelegation.status)}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Remaining available: <span className="font-semibold text-foreground">{availableMaxNear} {TOKEN_SYMBOL}</span>
                </p>
              </div>
            )}

            {/* Drawer-level error */}
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[0.8rem] text-destructive">
                {error}
              </p>
            )}

            {/* Section 1: Spending Limits */}
            <div className="flex flex-col gap-4">
              <h4 className="text-sm font-semibold text-foreground">1. Spending Limits</h4>

              <div className="flex flex-col gap-2">
                <Label htmlFor="emp-max-amount">Lifetime Spending Limit ({TOKEN_SYMBOL})</Label>
                <Input
                  id="emp-max-amount"
                  value={caveatForm.maxAmountNear}
                  className={formErrors.maxAmountNear ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(e) =>
                    setCaveatForm((f) => ({ ...f, maxAmountNear: e.target.value }))
                  }
                />
                {formErrors.maxAmountNear ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.maxAmountNear}</p>
                ) : (
                  <p className="text-[0.8rem] text-muted-foreground">
                    Max: {availableMaxNear} {TOKEN_SYMBOL} (your remaining available balance).
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <Label>Recurring Allowance</Label>
                <Select
                  value={caveatForm.period}
                  disabled={selectedDelegation?.status === "active"}
                  onValueChange={(period) =>
                    setCaveatForm((f) => ({ ...f, period: period as CaveatForm["period"] }))
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
                  Reset the agent&apos;s spending on a recurring schedule.
                </p>
              </div>

              {caveatForm.period !== "none" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="emp-period-amount">Allowance per Period ({TOKEN_SYMBOL})</Label>
                  <Input
                    id="emp-period-amount"
                    value={caveatForm.periodAmountNear}
                    className={formErrors.periodAmountNear ? "border-destructive" : ""}
                    disabled={selectedDelegation?.status === "active"}
                    onChange={(e) =>
                      setCaveatForm((f) => ({ ...f, periodAmountNear: e.target.value }))
                    }
                  />
                  {formErrors.periodAmountNear ? (
                    <p className="text-[0.8rem] text-destructive">{formErrors.periodAmountNear}</p>
                  ) : (
                    <p className="text-[0.8rem] text-muted-foreground">
                      How much the agent can spend per {caveatForm.period} period.
                    </p>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Section 2: Transaction Restrictions */}
            <div className="flex flex-col gap-4">
              <h4 className="text-sm font-semibold text-foreground">2. Transaction Restrictions</h4>

              <div className="flex flex-col gap-2">
                <Label htmlFor="emp-value-lte">Maximum Per-Transaction ({TOKEN_SYMBOL})</Label>
                <Input
                  id="emp-value-lte"
                  value={caveatForm.perTransactionCapNear}
                  className={formErrors.perTransactionCapNear ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(e) =>
                    setCaveatForm((f) => ({ ...f, perTransactionCapNear: e.target.value }))
                  }
                />
                {formErrors.perTransactionCapNear ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.perTransactionCapNear}</p>
                ) : (
                  <p className="text-[0.8rem] text-muted-foreground">
                    Cap per single transaction. Leave blank for no cap.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="emp-limited-calls-enabled"
                    checked={caveatForm.limitedCallsEnabled}
                    disabled={selectedDelegation?.status === "active"}
                    onCheckedChange={(checked) =>
                      setCaveatForm((f) => ({ ...f, limitedCallsEnabled: checked === true }))
                    }
                  />
                  <Label htmlFor="emp-limited-calls-enabled">Limit Total Transactions</Label>
                </div>
                {caveatForm.limitedCallsEnabled && (
                  <>
                    <Input
                      value={caveatForm.limitedCalls}
                      disabled={selectedDelegation?.status === "active"}
                      onChange={(e) =>
                        setCaveatForm((f) => ({ ...f, limitedCalls: e.target.value }))
                      }
                      className={cn("mt-1", formErrors.limitedCalls ? "border-destructive" : "")}
                    />
                    {formErrors.limitedCalls ? (
                      <p className="text-[0.8rem] text-destructive">{formErrors.limitedCalls}</p>
                    ) : (
                      <p className="text-[0.8rem] text-muted-foreground">
                        Restrict the agent to this many total transactions.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* Section 3: Address Whitelist */}
            <div className="flex flex-col gap-4">
              <h4 className="text-sm font-semibold text-foreground">3. Address Whitelist</h4>

              <div className="flex flex-col gap-2">
                <Label htmlFor="emp-targets">Permitted Addresses</Label>
                <Input
                  id="emp-targets"
                  value={caveatForm.allowedTargets}
                  className={formErrors.allowedTargets ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(e) =>
                    setCaveatForm((f) => ({ ...f, allowedTargets: e.target.value }))
                  }
                  placeholder="One address per line or comma-separated"
                />
                {formErrors.allowedTargets ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.allowedTargets}</p>
                ) : formErrors.allowedTargetsWarning ? (
                  <p className="text-[0.8rem] text-amber-500">{formErrors.allowedTargetsWarning}</p>
                ) : (
                  <p className="text-[0.8rem] text-muted-foreground">
                    Restrict the agent to these recipient addresses only.
                  </p>
                )}
              </div>
            </div>

            <Separator />

            {/* Section 4: AI Policy Prompt */}
            {selectedDelegation?.delegateeType === "agent" && (
              <div className="flex flex-col gap-4">
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BotIcon className="h-4 w-4 text-chart-5" />
                  4. AI Policy Prompt
                </h4>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="emp-policy-prompt">Natural Language Rules</Label>
                  <Textarea
                    id="emp-policy-prompt"
                    value={caveatForm.policyPrompt}
                    disabled={selectedDelegation?.status === "active"}
                    onChange={(event) =>
                      setCaveatForm((form) => ({
                        ...form,
                        policyPrompt: event.target.value,
                      }))
                    }
                    placeholder="e.g. Do not reimburse alcohol. Limit meals to $50. Flights must be economy."
                    className="min-h-[100px] resize-none"
                  />
                  <p className="text-[0.8rem] text-muted-foreground">These rules will be fed to the AI Agent. The hard on-chain limits above still apply as a security net.</p>
                </div>
              </div>
            )}

            <div className="pb-4" />
          </div>

          {Boolean(selectedDelegation) && (
            <DrawerFooter className="border-t pt-4">
              {selectedDelegation?.status === "active" ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={isPending || revokingAgent}>
                      <BanIcon data-icon="inline-start" />
                      Revoke delegation
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently revoke this agent&apos;s active sub-delegation on NEAR Testnet.
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
                        Yes, revoke delegation
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : selectedDelegation?.status === "pending_config" ? (
                <Button type="button" onClick={handleActivateDelegation} disabled={creatingAgent || activatingDelegation}>
                  {activatingDelegation ? (
                    <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <ShieldCheckIcon data-icon="inline-start" />
                  )}
                  {activatingDelegation ? activationStage === "checking" ? "Checking policy…" : activationStage === "confirming" ? "Confirming agent access…" : "Signing and confirming permission…" : creatingAgent ? "Preparing configuration…" : "Sign & activate agent access"}
                </Button>
              ) : null}
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>
    </DashboardShell>
  );
}
