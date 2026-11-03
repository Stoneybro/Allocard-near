"use client";
import { generateRequestId } from "@allocard/delegation-sdk";

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
  getEmployeeDashboardState,
  getAgentSmartAccountAddress,
  setWorkspaceContext,
  type EmployeeDashboardState,
  type WorkspaceOption,
  type WalletProfile,
} from "@/app/actions/identity";
import {
  ConnectRequiredCard,
} from "@/components/auth-state";
import { useAuth } from "@/components/AuthProvider";
import { DashboardShell } from "@/components/dashboard-shell";
import { type SidebarAgent } from "@/components/app-sidebar";
import { EmployeeSectionCards } from "@/components/employee-section-cards";
import { ReimbursementDrawer } from "./ReimbursementDrawer";
import { ReimbursementsCard } from "@/components/reimbursements-card";
import { isReimbursementAgent } from "@/lib/reimbursements/shared";
import { isAgoraAgent } from "@/lib/agora/shared";
import { AgoraCrossBorderCard } from "@/components/agora-card";
import { AgoraRemittanceDrawer } from "./AgoraRemittanceDrawer";
import { DevOpsAgentDrawer } from "./DevOpsAgentDrawer";
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
import { formatWalletAddress, generateEmployeeReferenceId, isValidWalletAddress } from "@/lib/wallet";
import { CHAIN_ID, TOKEN_SYMBOL, getAddressExplorerUrl, getTxExplorerUrl } from "@/lib/chain";
import type { PermissionSpec, ExecuteRequest } from "@allocard/delegation-sdk";
import {
  createNearWalletCaller,
  getUnifiedNearCaller,
  getTreasuryClient,
  parseTokenAmount,
  formatTokenAmount,
} from "@/lib/near";

// ── Types ───────────────────────────────────────────────────────────────────

type DelegationRow = EmployeeDashboardState["outboundDelegations"][number];

type CaveatForm = {
  maxAmountEth: string;
  period: "none" | "hourly" | "daily" | "weekly" | "monthly";
  periodAmountEth: string;
  perTransactionCapEth: string;
  allowedTargets: string;
  limitedCallsEnabled: boolean;
  limitedCalls: string;
  policyPrompt: string;
};

type FormErrors = {
  maxAmountEth?: string;
  periodAmountEth?: string;
  perTransactionCapEth?: string;
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

const ETH_AMOUNT_RE = /^\d+(\.\d+)?$/;
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function buildEmptyCaveatForm(parentMaxEth: string): CaveatForm {
  return {
    maxAmountEth: parentMaxEth,
    period: "none",
    periodAmountEth: "",
    perTransactionCapEth: "",
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
  parentMaxEth: string,
): CaveatForm {
  if (!delegation) return buildEmptyCaveatForm(parentMaxEth);

  const nextForm: CaveatForm = buildEmptyCaveatForm(parentMaxEth);

  for (const caveat of delegation.caveats) {
    const value = caveatRecord(caveat);

    if (caveat.caveatType === "nativeTokenTransferAmount") {
      const wei = value.maxAmount ?? value.amount;
      nextForm.maxAmountEth = typeof wei === "string" ? weiToEthInput(wei) : parentMaxEth;
    }

    if (caveat.caveatType === "nativeTokenPeriodTransfer") {
      const period = value.period;
      const amount = value.periodAmount ?? value.amount;
      nextForm.period =
        period === "hourly" || period === "daily" || period === "weekly" || period === "monthly"
          ? period
          : "daily";
      nextForm.periodAmountEth = typeof amount === "string" ? weiToEthInput(amount) : "";
    }

    if (caveat.caveatType === "valueLte") {
      const maxValue = value.maxValue ?? value.valueWei;
      nextForm.perTransactionCapEth = typeof maxValue === "string" ? weiToEthInput(maxValue) : "";
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

function weiToEthInput(wei: string) {
  const value = BigInt(wei);
  const whole = value / 1_000_000_000_000_000_000_000_000n;
  const fractional = value % 1_000_000_000_000_000_000_000_000n;
  if (fractional === 0n) return whole.toString();
  return `${whole}.${fractional.toString().padStart(24, "0").replace(/0+$/, "")}`;
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
    maxAmountEth: form.maxAmountEth,
    period: form.period,
    periodAmountEth: form.periodAmountEth || form.maxAmountEth,
    perTransactionCapEth: form.perTransactionCapEth,
    allowedTargets: splitAddresses(form.allowedTargets),
    redeemers: [],
    limitedCalls: form.limitedCallsEnabled ? Number(form.limitedCalls) : null,
    customCaveats: [],
  };
}

function validateCaveatForm(form: CaveatForm, availableMaxEth: string): FormErrors {
  const errors: FormErrors = {};
  const availableMax = parseFloat(availableMaxEth);

  if (!ETH_AMOUNT_RE.test(form.maxAmountEth.trim())) {
    errors.maxAmountEth = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.005).`;
  } else {
    const max = parseFloat(form.maxAmountEth);
    if (max <= 0) {
      errors.maxAmountEth = "Spending limit must be greater than 0.";
    } else if (availableMaxEth && !isNaN(availableMax)) {
      if (max > availableMax) {
        errors.maxAmountEth = `Cannot exceed your remaining delegated balance of ${availableMaxEth} ${TOKEN_SYMBOL}.`;
      }
    }
  }

  if (form.period !== "none") {
    const raw = form.periodAmountEth.trim();
    if (!raw) {
      errors.periodAmountEth = "Enter a period allowance when a recurring period is selected.";
    } else if (!ETH_AMOUNT_RE.test(raw)) {
      errors.periodAmountEth = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.01).`;
    } else {
      const period = parseFloat(raw);
      const max = parseFloat(form.maxAmountEth);
      if (period <= 0) {
        errors.periodAmountEth = "Period allowance must be greater than 0.";
      } else if (!errors.maxAmountEth && period > max) {
        errors.periodAmountEth = `Period allowance cannot exceed the lifetime limit (${form.maxAmountEth} ${TOKEN_SYMBOL}).`;
      }
    }
  }

  const perTxRaw = form.perTransactionCapEth.trim();
  if (perTxRaw) {
    if (!ETH_AMOUNT_RE.test(perTxRaw)) {
      errors.perTransactionCapEth = `Enter a valid ${TOKEN_SYMBOL} amount (e.g. 0.005).`;
    } else {
      const perTx = parseFloat(perTxRaw);
      if (perTx <= 0) {
        errors.perTransactionCapEth = "Per-transaction cap must be greater than 0.";
      } else {
        const ceiling =
          form.period !== "none" && form.periodAmountEth.trim()
            ? parseFloat(form.periodAmountEth)
            : parseFloat(form.maxAmountEth);
        if (!isNaN(ceiling) && perTx > ceiling) {
          errors.perTransactionCapEth = `Per-transaction cap cannot exceed ${form.period !== "none" ? `the period allowance (${form.periodAmountEth} ${TOKEN_SYMBOL})` : `the lifetime limit (${form.maxAmountEth} ${TOKEN_SYMBOL})`}.`;
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
  const currentAuthAddress = auth.status === "authenticated" ? (auth.address as `0x${string}`) : undefined;
  const didLoadDashboard = useRef(Boolean(initialProfile && initialDashboardState));
  const [dashboardState, setDashboardState] = useState<EmployeeDashboardState | null>(
    initialDashboardState ?? null,
  );
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>(
    (initialProfile && "workspaces" in initialProfile && initialProfile.workspaces) || [],
  );
  const [activeCompanyId, setActiveCompanyId] = useState<string>(
    (initialProfile && "user" in initialProfile && initialProfile.user ? initialProfile.user.companyId : "") || "",
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(null);
  const [caveatForm, setCaveatForm] = useState<CaveatForm>(buildEmptyCaveatForm(""));
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (auth.status !== "authenticated") {
      didLoadDashboard.current = false;
      setDashboardState(null);
      return;
    }
    if (didLoadDashboard.current) {
      void auth.establishSession().catch(() => {});
      return;
    }
    didLoadDashboard.current = true;
    const addr = auth.address;

    startTransition(async () => {
      try {
        await auth.establishSession();
        const { getWalletProfile } = await import("@/app/actions/identity");
        const profile = await getWalletProfile(addr);

        if (profile.status === "new") {
          router.replace("/onboarding");
          return;
        }

        if (profile.status === "picker") {
          router.replace("/onboarding");
          return;
        }

        if (profile.status === "employer") {
          router.replace("/employer");
          return;
        }

        setWorkspaceOptions(profile.workspaces ?? []);
        setActiveCompanyId(profile.user.companyId ?? "");

        const state = await getEmployeeDashboardState(addr);
        setDashboardState(state);
        setError(null);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load dashboard. Please refresh."
        );
      }
    });
  }, [auth.status, router]);


  // ── Derived values ─────────────────────────────────────────────────────────

  const approvedWei = useMemo(() => {
    try {
      const inbound = dashboardState?.inboundDelegation;
      if (!inbound) return 0n;
      const caveat = inbound.caveats.find((c) => c.caveatType === "nativeTokenTransferAmount");
      if (!caveat) return 0n;
      const val = caveat.caveatValue as Record<string, unknown>;
      return BigInt(String(val.maxAmount ?? val.amount ?? "0"));
    } catch { return 0n; }
  }, [dashboardState?.inboundDelegation]);

  const redelegatedWei = useMemo(() => {
    try {
      const activeOutbound = dashboardState?.outboundDelegations.filter((d) => d.status === "active") ?? [];
      return activeOutbound.reduce((sum, d) => {
        const caveat = d.caveats.find((c) => c.caveatType === "nativeTokenTransferAmount");
        if (!caveat) return sum;
        const val = caveat.caveatValue as Record<string, unknown>;
        return sum + BigInt(String(val.maxAmount ?? val.amount ?? "0"));
      }, 0n);
    } catch { return 0n; }
  }, [dashboardState?.outboundDelegations]);

  const spentWei = useMemo(() => {
    try {
      const val = dashboardState?.summary?.spentEth ?? '0';
      const num = parseFloat(val);
      if (isNaN(num) || num <= 0) return 0n;
      const [whole, fractional = ""] = val.split(".");
      return (
        BigInt(whole) * 1_000_000_000_000_000_000_000_000n +
        BigInt((fractional + "0".repeat(24)).slice(0, 24))
      );
    } catch { return 0n; }
  }, [dashboardState?.summary?.spentEth]);

  const remainingWei = BigInt(parseTokenAmount(dashboardState?.summary.remainingEth ?? "0", 24));

  const parentMaxEth = useMemo(() => {
    try {
      const inbound = dashboardState?.inboundDelegation;
      if (!inbound) return "0";
      const caveat = inbound.caveats.find((c) => c.caveatType === "nativeTokenTransferAmount");
      if (!caveat) return "0";
      const val = caveat.caveatValue as Record<string, unknown>;
      const wei = BigInt(String(val.maxAmount ?? val.amount ?? "0"));
      return weiToEthInput(wei.toString());
    } catch { return "0"; }
  }, [dashboardState?.inboundDelegation]);

  const availableMaxEth = useMemo(() => {
    let baseRemaining = remainingWei;
    if (selectedDelegationId && dashboardState) {
      const currentDel = dashboardState.outboundDelegations.find(d => d.id === selectedDelegationId);
      if (currentDel && currentDel.status === "active") {
        const caveat = currentDel.caveats.find((c) => c.caveatType === "nativeTokenTransferAmount");
        if (caveat) {
          const val = caveat.caveatValue as Record<string, unknown>;
          const currentWei = BigInt(String(val.maxAmount ?? val.amount ?? "0"));
          baseRemaining += currentWei;
        }
      }
    }
    return baseRemaining > 0n ? weiToEthInput(baseRemaining.toString()) : "0";
  }, [remainingWei, selectedDelegationId, dashboardState]);

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

    // 1. Live platform agents from database (excluding built-in dashboard card services)
    const liveAgents: SidebarAgent[] = (dashboardState.agents ?? [])
      .filter((agent) => !isReimbursementAgent(agent) && !isAgoraAgent(agent))
      .map((agent) => {
        const delegation = dashboardState.outboundDelegations.find(
          (d) => d.delegateeId === agent.id && d.status !== "revoked"
        );
        const isActive = delegation?.status === "active";

        return {
          id: agent.id,
          name: agent.name,
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

  function formatEthTrimmed(wei: bigint) {
    const s = weiToEthInput(wei.toString());
    if (!s.includes(".")) return s;
    return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  }

  const refreshDashboard = useCallback(async () => {
    if (auth.status !== "authenticated" || !auth.address) return;
    const state = await getEmployeeDashboardState(auth.address);
    setDashboardState(state);
  }, [auth]);

  // Manual refresh only — mutations already refresh state automatically

  const runEmployeeMutation = useCallback(
    (mutation: () => Promise<EmployeeDashboardState>) => {
      setError(null);
      startTransition(async () => {
        try {
          setDashboardState(await mutation());
        } catch (caughtError) {
          const message = caughtError instanceof Error ? caughtError.message : "Action failed";
          setError(message);
          toast.error("Operation Failed", { description: message });
        }
      });
    },
    [],
  );

  const handleSmartAccountActivated = (smartAccountAddress: string | null) => {
    if (!smartAccountAddress) return;

    toast.success("Safe Smart Account Deployed", {
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

  const [isReimbursementDrawerOpen, setIsReimbursementDrawerOpen] = useState(false);
  const [isAgoraDrawerOpen, setIsAgoraDrawerOpen] = useState(false);
  const [isProcurementAgentDrawerOpen, setIsProcurementAgentDrawerOpen] = useState(false);
  const [activeProcurementDelegationId, setActiveProcurementDelegationId] = useState<string | null>(null);
  const [isRefreshingReimbursements, setIsRefreshingReimbursements] = useState(false);
  const [isRefreshingAgora, setIsRefreshingAgora] = useState(false);

  // Open drawer for existing delegation (configure / view rules)
  const handleConfigureDelegation = useCallback(
    (delegationId: string) => {
      const delegation =
        dashboardState?.outboundDelegations.find((d) => d.id === delegationId) ?? null;

      // For active agent delegations, open the agent-specific drawer
      if (delegation?.status === "active" && delegation.delegateeId) {
        const agent = dashboardState?.agents.find(a => a.id === delegation.delegateeId);
        if (
          agent?.name === "Cloud & Tooling Agent" ||
          agent?.name === "DevOps Procurement Agent" ||
          agent?.name === "Procurement Agent"
        ) {
          if (!dashboardState?.inboundDelegation || dashboardState.inboundDelegation.status !== "active") {
            toast.warning("No Spending Allowance Delegated", {
              description:
                "Your company has not delegated spending funds to you yet. Please ask your employer to configure an allowance for you first.",
            });
            return;
          }
          setActiveProcurementDelegationId(delegationId);
          setIsProcurementAgentDrawerOpen(true);
          return;
        }
        if (isReimbursementAgent(agent)) {
          setIsReimbursementDrawerOpen(true);
          return;
        }
        if (isAgoraAgent(agent)) {
          setIsAgoraDrawerOpen(true);
          return;
        }
      }

      // Default: open the caveat configuration drawer (for pending agents or employees)
      setSelectedDelegationId(delegationId);
      // Wait for React to process selectedDelegationId state update so availableMaxEth recalculates
      setTimeout(() => {
        setCaveatForm(formFromDelegation(delegation, availableMaxEth));
        setFormErrors({});
      }, 0);
    },
    [dashboardState?.outboundDelegations, dashboardState?.agents, dashboardState?.inboundDelegation, availableMaxEth],
  );

  // Agent selector / budget assigner
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      if (auth.status !== "authenticated" || !auth.address || !dashboardState) return;
      const walletAddress = auth.address;
      setError(null);

      const selectedAgent = dashboardState.agents.find(a => a.id === agentId);
      if (isReimbursementAgent(selectedAgent)) {
        setIsReimbursementDrawerOpen(true);
        return;
      }
      if (isAgoraAgent(selectedAgent)) {
        setIsAgoraDrawerOpen(true);
        return;
      }

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

      startTransition(async () => {
        try {
          const state = await createAgentRedelegation({ walletAddress, agentId });
          setDashboardState(state);
          toast.info("Agent Budget Created", {
            description: "Configure spending rules and caveats to activate sub-delegation.",
          });

          const pending = state.outboundDelegations.find(
            (d) => d.delegateeId === agentId && d.status !== "revoked",
          );
          if (pending) {
            setSelectedDelegationId(pending.id);
            setCaveatForm(formFromDelegation(pending, parentMaxEth));
            setFormErrors({});
          }
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
        }
      });
    },
    [auth, parentMaxEth, dashboardState, handleConfigureDelegation],
  );

  // Task 7b: revoke an employee's own outbound delegation
  const handleRevokeDelegation = useCallback(
    (delegationId: string) => {
      if (auth.status !== "authenticated" || !auth.address) return;
      const walletAddress = auth.address;
      const targetDelegation = dashboardState?.outboundDelegations.find(d => d.id === delegationId);
      const agent = dashboardState?.agents.find(a => a.id === targetDelegation?.delegateeId);
      const agentName = agent?.name ?? "AI Agent";
      const agentAddress = agent?.smartAccountAddress || agent?.signerAddress || "";

      runEmployeeMutation(async () => {
        const nextState = await revokeEmployeeDelegation({ walletAddress, delegationId });

        toast.success("Agent Delegation Revoked", {
          description: `Spending authority for ${agentName} has been revoked on NEAR Testnet.`,
          action: agentAddress ? {
            label: "View Explorer",
            onClick: () => window.open(getAddressExplorerUrl(agentAddress), "_blank"),
          } : undefined,
        });

        return nextState;
      });

      setSelectedDelegationId((current) => (current === delegationId ? null : current));
    },
    [auth, dashboardState, runEmployeeMutation],
  );

  // Task 6: save caveats then sign and activate the delegation
  const handleActivateDelegation = useCallback(() => {
    if (auth.status !== "authenticated" || !selectedDelegation || !auth.address) return;
    const walletAddress = auth.address;

    const errors = validateCaveatForm(caveatForm, availableMaxEth);
    setFormErrors(errors);
    const hasErrors = Object.keys(errors).some(
      (k) => k !== "allowedTargetsWarning" && errors[k as keyof FormErrors],
    );
    if (hasErrors) return;

    setError(null);
    startTransition(async () => {
      try {
        // 1. Persist caveats (also validates against parent server-side)
        const savedState = await saveEmployeeRedelegationCaveats({
          walletAddress,
          delegationId: selectedDelegation.id,
          caveats: buildServerCaveats(caveatForm),
        });
        setDashboardState(savedState);

        // 2. Resolve agent principal
        const agentId = selectedDelegation.delegateeId;
        if (!agentId) {
          throw new Error("Delegation target agent is missing.");
        }

        const agentSmartAccountAddress = await getAgentSmartAccountAddress(agentId);

        const parentPermissionId = savedState.inboundDelegation?.delegationHash || "";
        const parsedLimit = caveatForm.maxAmountEth ? parseTokenAmount(caveatForm.maxAmountEth, 24) : null;
        const parsedPerTx = caveatForm.perTransactionCapEth ? parseTokenAmount(caveatForm.perTransactionCapEth, 24) : null;

        const childSpec: PermissionSpec = {
          delegate: agentSmartAccountAddress,
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
              fixed_window: null,
              streaming: null,
              approval: null,
              acknowledge_unbounded_budget: !parsedLimit,
            },
          ],
          redelegation_depth: 0,
          metadata_hash: null,
        };

        if (!auth.selector || !dashboardState?.company?.smartAccountAddress) throw new Error("A signing wallet and treasury are required");
        if (!savedState.inboundDelegation?.delegationHash) throw new Error("A confirmed parent permission is required");
        const caller = createNearWalletCaller(auth.selector, auth.accountId);
        const client = getTreasuryClient(caller, dashboardState.company.smartAccountAddress);
        const delegationHash = await client.createChildPermission(parentPermissionId, childSpec);

        const activatedState = await activateEmployeeDelegation({
          walletAddress,
          delegationId: selectedDelegation.id,
          delegationHash,
          signedDelegation: childSpec,
        });
        setDashboardState(activatedState);
        setSelectedDelegationId(null);

        const agent = dashboardState?.agents.find(a => a.id === selectedDelegation.delegateeId);
        const agentName = agent?.name ?? "AI Agent";

        toast.success("Agent Sub-Delegation Activated", {
          description: `Assigned ${caveatForm.maxAmountEth} ${TOKEN_SYMBOL} budget to ${agentName} on NEAR Testnet`,
          action: {
            label: "View Explorer",
            onClick: () => window.open(getAddressExplorerUrl(agentSmartAccountAddress), "_blank"),
          },
        });
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not activate delegation");
      }
    });
  }, [selectedDelegation, auth, caveatForm, availableMaxEth, dashboardState?.inboundDelegation]);

  // Persist a request before signing. Retrying an uncertain dispatch reuses it.
  const handleExecuteSpend = async (details: { toAddress: string; amountEth: string; purpose?: string; isFlagged?: boolean }) => {
    if (auth.status !== "authenticated") throw new Error("Connect your NEAR signing wallet");
    const activePermissionId = dashboardState?.inboundDelegation?.delegationHash;
    const treasury = dashboardState?.company?.smartAccountAddress;
    if (!treasury) throw new Error("A company treasury is required");
    const caller = await getUnifiedNearCaller(auth);
    if (!caller.functionCall) throw new Error("A signing wallet is required");
    const client = getTreasuryClient(caller, treasury);
    const key = `allocard-payment:${treasury}:${auth.accountId}`;
    const amount = parseTokenAmount(details.amountEth, 24);
    let saved: { request: ExecuteRequest; transactionHash?: string; executionId?: string; delegationId?: string; attempted?: boolean } | null = JSON.parse(localStorage.getItem(key) || "null");
    if (saved && (saved.request.action.amount !== amount || saved.request.action.receiver !== details.toAddress)) {
      throw new Error("A previous payment is unresolved. Retry its original recipient and amount before starting another payment.");
    }
    const permissionId = saved?.request.permission_id || activePermissionId;
    if (!permissionId || !/^[0-9]+$/.test(permissionId)) throw new Error("A confirmed company permission is required");
    if (!saved) {
      saved = { delegationId: dashboardState?.inboundDelegation?.id, attempted: false, request: { api_version: 1, request_id: generateRequestId(), permission_id: permissionId,
        action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: details.toAddress, amount },
        deadline_ms: (Date.now() + 15 * 60 * 1000).toString() } };
      localStorage.setItem(key, JSON.stringify(saved));
    }
    // An existing execution can be settled even if its permission was revoked meanwhile.
    const existing = await client.getExecutionByRequest(auth.accountId, saved.request.request_id);
    if (!existing && BigInt(saved.request.deadline_ms) <= BigInt(Date.now())) {
      const response = await fetch("/api/wallet/pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: dashboardState?.company?.id, requestId: saved.request.request_id, deadlineMs: saved.request.deadline_ms }) });
      const status = await response.json();
      if (response.ok && status.canDiscard) {
        localStorage.removeItem(key);
        throw new Error("The chain confirms the previous request expired without dispatch. Submit again to start a fresh payment.");
      }
      throw new Error("The previous payment is still unresolved. Keep this request and retry after checking its on-chain status.");
    }
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
    await refreshDashboard();
    return saved.transactionHash;
  };

  const handleVerifyReceipt = async (txHash: string, imageBase64: string) => {
    const res = await fetch("/api/wallet/verify-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash, imageBase64, mimeType: "image/jpeg" }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to verify receipt");
    }
    const data = await res.json();
    return data.verification;
  };

  // ── Render guards ──────────────────────────────────────────────────────────

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

  if (!dashboardState) {
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center gap-8 bg-white">
        <div className="flex flex-col items-center gap-6">
          <svg className="animate-spin text-[#ccc]" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" className="opacity-100 text-[#111]" />
            <path strokeLinecap="round" d="M12 2a10 10 0 0 0-10 10" className="opacity-20" />
          </svg>
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-xl font-semibold text-[#111]">
              {isPending ? "Loading employee dashboard" : "Verifying access"}
            </p>
            <p className="text-sm text-[#999]">
              {isPending ? "Fetching your delegations and agents..." : "Checking your account status..."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { employee, company, summary } = dashboardState;

  const smartAccountLabel = employee.smartAccountAddress
    ? formatWalletAddress(employee.smartAccountAddress)
    : "Smart account pending";

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <DashboardShell
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
      employeeReferenceId={generateEmployeeReferenceId(employee.walletAddress)}
      agents={sidebarAgents}
      onSelectAgent={handleSelectAgent}
      onRefreshEmployees={refreshDashboard}
      employeesRefreshing={isPending}
    >
      <div className="flex flex-col gap-6">
        {/* Smart account activation banner */}
        {!employee.smartAccountAddress && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                Smart account not yet activated
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Activate your smart account so the company can delegate spending authority to you.
              </p>
            </div>
            <SmartAccountActivationButton
              mode="employee"
              walletAddress={(currentAuthAddress || employee.walletAddress) as `0x${string}`}
              existingSmartAccountAddress={employee.smartAccountAddress}
              onActivated={(result) => handleSmartAccountActivated(result.smartAccountAddress)}
            />
          </div>
        )}

        {dashboardState.summary.capacityError && <p role="alert" className="text-sm text-destructive">{dashboardState.summary.capacityError}</p>}
        {/* Global error banner */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">{error}</p>
          </div>
        )}

        {/* Summary cards */}
        <EmployeeSectionCards
          approvedLimitEth={summary.approvedLimitEth}
          redelegatedEth={summary.redelegatedEth}
          remainingEth={formatEthTrimmed(remainingWei)}
          spentEth={summary.spentEth}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ReimbursementsCard
            role="employee"
            program={dashboardState.reimbursement}
            accountReady={Boolean(employee.smartAccountAddress)}
            busy={isRefreshingReimbursements}
            onOpen={() => {
              setIsReimbursementDrawerOpen(true);
            }}
            onRefresh={async () => {
              setIsRefreshingReimbursements(true);
              try {
                await refreshDashboard();
              } catch {
                toast.error("Could not refresh reimbursement status");
              } finally {
                setIsRefreshingReimbursements(false);
              }
            }}
          />
          <AgoraCrossBorderCard
            role="employee"
            program={dashboardState.agora}
            accountReady={Boolean(employee.smartAccountAddress)}
            busy={isRefreshingAgora}
            onOpen={() => {
              setIsAgoraDrawerOpen(true);
            }}
            onRefresh={async () => {
              setIsRefreshingAgora(true);
              try {
                await refreshDashboard();
              } catch {
                toast.error("Could not refresh Agora remittance status");
              } finally {
                setIsRefreshingAgora(false);
              }
            }}
          />
        </div>

        {/* Direct Spend Workspace */}
        <div className="w-full">
          <DirectSpendForm
            delegationId={dashboardState.inboundDelegation?.id || ""}
            pendingStorageKey={dashboardState.company?.smartAccountAddress && auth.status === "authenticated" ? `allocard-payment:${dashboardState.company.smartAccountAddress}:${auth.accountId}` : undefined}
            remainingBalanceEth={formatEthTrimmed(remainingWei)}
            onExecute={handleExecuteSpend}
            onVerifyReceipt={handleVerifyReceipt}
          />
        </div>
      </div>

      {/* ── Caveat Configuration Drawer (Tasks 5 & 6) ──────────────────────── */}
      <Drawer
        direction="right"
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
            <DrawerTitle>Agent Spending Rules</DrawerTitle>
            <DrawerDescription>
              {selectedDelegation?.status === "active"
                ? "These rules are active and enforced on-chain. Values are constrained by your inbound delegation."
                : "Configure what this agent is allowed to spend. Values cannot exceed your remaining delegated balance."}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-2">
            {selectedDelegation && (
              <div>
                <Badge
                  variant={selectedDelegation.status === "active" ? "secondary" : "outline"}
                  className="mb-2"
                >
                  {formatDelegationStatus(selectedDelegation.status)}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Remaining available: <span className="font-semibold text-foreground">{availableMaxEth} {TOKEN_SYMBOL}</span>
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
                  value={caveatForm.maxAmountEth}
                  className={formErrors.maxAmountEth ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(e) =>
                    setCaveatForm((f) => ({ ...f, maxAmountEth: e.target.value }))
                  }
                />
                {formErrors.maxAmountEth ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.maxAmountEth}</p>
                ) : (
                  <p className="text-[0.8rem] text-muted-foreground">
                    Max: {availableMaxEth} {TOKEN_SYMBOL} (your remaining available balance).
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
                  Reset the agent's spending on a recurring schedule.
                </p>
              </div>

              {caveatForm.period !== "none" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="emp-period-amount">Allowance per Period ({TOKEN_SYMBOL})</Label>
                  <Input
                    id="emp-period-amount"
                    value={caveatForm.periodAmountEth}
                    className={formErrors.periodAmountEth ? "border-destructive" : ""}
                    disabled={selectedDelegation?.status === "active"}
                    onChange={(e) =>
                      setCaveatForm((f) => ({ ...f, periodAmountEth: e.target.value }))
                    }
                  />
                  {formErrors.periodAmountEth ? (
                    <p className="text-[0.8rem] text-destructive">{formErrors.periodAmountEth}</p>
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
                  value={caveatForm.perTransactionCapEth}
                  className={formErrors.perTransactionCapEth ? "border-destructive" : ""}
                  disabled={selectedDelegation?.status === "active"}
                  onChange={(e) =>
                    setCaveatForm((f) => ({ ...f, perTransactionCapEth: e.target.value }))
                  }
                />
                {formErrors.perTransactionCapEth ? (
                  <p className="text-[0.8rem] text-destructive">{formErrors.perTransactionCapEth}</p>
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
                    <Button variant="destructive" disabled={isPending}>
                      <BanIcon data-icon="inline-start" />
                      Revoke delegation
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently revoke this agent's active sub-delegation on NEAR Testnet.
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
                <Button onClick={handleActivateDelegation} disabled={isPending}>
                  {isPending ? (
                    <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <ShieldCheckIcon data-icon="inline-start" />
                  )}
                  Sign & Activate Delegation
                </Button>
              ) : null}
            </DrawerFooter>
          )}
        </DrawerContent>
      </Drawer>

      {dashboardState && (
        <ReimbursementDrawer
          isOpen={isReimbursementDrawerOpen}
          onOpenChange={setIsReimbursementDrawerOpen}
          companyId={dashboardState.company.id}
          employeeId={dashboardState.employee.id}
          program={dashboardState.reimbursement}
          accountReady={Boolean(dashboardState.employee.smartAccountAddress)}
          onRefresh={refreshDashboard}
        />
      )}
      {dashboardState && (
        <AgoraRemittanceDrawer
          isOpen={isAgoraDrawerOpen}
          onOpenChange={setIsAgoraDrawerOpen}
          companyId={dashboardState.company.id}
          employeeId={dashboardState.employee.id}
          program={dashboardState.agora}
          accountReady={Boolean(dashboardState.employee.smartAccountAddress)}
          onRefresh={refreshDashboard}
        />
      )}

      {activeProcurementDelegationId && dashboardState && (
        <DevOpsAgentDrawer
          isOpen={isProcurementAgentDrawerOpen}
          onOpenChange={setIsProcurementAgentDrawerOpen}
          employee={dashboardState.employee}
          company={dashboardState.company}
          agentId={
            dashboardState.agents.find(
              (a) =>
                a.name === "Cloud & Tooling Agent" ||
                a.name === "DevOps Procurement Agent" ||
                a.name === "Procurement Agent",
            )?.id || ""
          }
          delegationId={activeProcurementDelegationId}
        />
      )}
    </DashboardShell>
  );
}
