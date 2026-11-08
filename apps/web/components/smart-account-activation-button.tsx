"use client";

import { useState, useTransition } from "react";
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
  existingSmartAccountAddress: _existingSmartAccountAddress,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const [pending, startTransition] = useTransition();

  const activate = () =>
    startTransition(async () => {
      try {
        setError(null);
        if (auth.status !== "authenticated" || !auth.sendActions) {
          throw new Error("Connect your NEAR signing wallet first");
        }

        let target = "";
        if (mode === "company") {
          if (!companyKey) throw new Error("Workspace identity is required to create its treasury");
          const config = await sharedConfig();
          target = await registerCompany(await getUnifiedNearCaller(auth), config, companyKey);
          parseTreasuryReference(target);
        } else {
          target = auth.accountId;
          if (!isNativeNearAccount(target)) throw new Error("Enter a NEAR account ID");
        }

        const result = await activation.mutateAsync({
          walletAddress: auth.accountId || walletAddress,
          smartAccountAddress: target,
        });
        onActivated?.(result);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Treasury setup failed");
      }
    });

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        disabled={pending || (mode === "company" && (!shared || !companyKey))}
        onClick={activate}
      >
        {pending
          ? mode === "company"
            ? "Activating company account…"
            : "Activating account…"
          : mode === "company"
            ? "Activate your company account"
            : "Activate your account"}
      </Button>
      {(error || configError) && (
        <p role="alert" className="text-xs text-destructive text-center">
          {error || configError}
        </p>
      )}
    </div>
  );
}
