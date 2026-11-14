"use client";

import { useRef, useState, useTransition } from "react";
import { OperationStatus } from "./operation-status";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useAccountScope } from "@/hooks/use-account-queries";
import { withTimeout } from "@/lib/request-timeout";
import { activateSmartAccount } from "@/app/actions/identity";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { getUnifiedNearCaller } from "@/lib/near";
import { sharedConfig, registerCompany } from "@/lib/shared-treasury";
import { parseTreasuryReference } from "@allocard/delegation-sdk";
import { isNativeNearAccount } from "@/lib/wallet";

type ActivationResult = Awaited<ReturnType<typeof activateSmartAccount>>;

export function SmartAccountActivationButton({
  walletAddress,
  onActivated,
  companyKey,
  mode = "company",
}: {
  walletAddress: string;
  companyKey?: string;
  existingSmartAccountAddress: string | null;
  onActivated?: (result: ActivationResult) => void;
  mode?: "company" | "employee";
}) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState("Preparing your account…");
  const activationLock = useRef(false);
  const { key } = useAccountScope();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: [...key, "shared-config"], enabled: mode === "company",
    queryFn: () => withTimeout(sharedConfig(), "Company setup is temporarily unavailable. Please retry."),
    staleTime: 60_000,
  });
  const shared = config.data;
  const configError = config.error?.message;
  const activation = useMutation({
    mutationFn: activateSmartAccount, retry: false,

  });

  const [pending, startTransition] = useTransition();

  const activate = () => {
    if (activationLock.current) return;
    activationLock.current = true;
    setStage("Checking your account…");
    startTransition(async () => {
      try {
        setError(null);
        if (auth.status !== "authenticated" || !auth.sendActions) {
          throw new Error("Connect your NEAR signing wallet first");
        }

        let target = "";
        if (mode === "company") {
          setStage("Checking treasury setup…");
          if (!companyKey) throw new Error("Workspace identity is required to create its treasury");
          const config = shared ?? await sharedConfig();
          target = await registerCompany(await getUnifiedNearCaller(auth), config, companyKey, setStage);
          parseTreasuryReference(target);
          setStage("Adding your demo funds…");
        } else {
          target = auth.accountId;
          if (!isNativeNearAccount(target)) throw new Error("Enter a NEAR account ID");
        }

        const result = await activation.mutateAsync({
          walletAddress: auth.accountId || walletAddress,
          smartAccountAddress: target,
        });
        setStage("Refreshing your dashboard…");
        await queryClient.cancelQueries({ queryKey: key, predicate: query => ["profile", "dashboard", "treasury"].includes(String(query.queryKey[key.length])) });
        onActivated?.(result);
        void queryClient.invalidateQueries({ queryKey: key, predicate: query => ["profile", "dashboard", "treasury"].includes(String(query.queryKey[key.length])) }, { cancelRefetch: false });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Treasury setup failed");
      } finally { activationLock.current = false; }
    });
  };

  return (
    <div className="flex w-full flex-col items-start gap-2 sm:w-auto">
      <Button
        data-activation-exempt
        className="h-11 w-full gap-2 px-5 shadow-sm sm:w-auto sm:min-w-64"
        aria-busy={pending}
        disabled={pending || (mode === "company" && (!shared || !companyKey))}
        onClick={activate}
      >
        {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {pending
          ? mode === "company"
            ? "Activating company account"
            : "Activating account"
          : mode === "company"
            ? "Activate your company account"
            : "Activate your account"}
        {!pending && <ArrowRight className="size-4" aria-hidden="true" />}
      </Button>
      {pending && <OperationStatus message={stage} />}
      {(error || configError) && (
        <p role="alert" className="text-xs text-destructive">
          {error || configError}
        </p>
      )}
    </div>
  );
}
