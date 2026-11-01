"use client";

import { useState, useTransition } from "react";
import { LoaderCircleIcon, ShieldCheck } from "lucide-react";
import { activateSmartAccount } from "@/app/actions/identity";
import { Button } from "@/components/ui/button";
import { DEFAULT_TREASURY_CONTRACT } from "@/lib/chain";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";

type ActivationResult = Awaited<ReturnType<typeof activateSmartAccount>>;

export function SmartAccountActivationButton({
  walletAddress,
  existingSmartAccountAddress,
  onActivated,
}: {
  walletAddress: string;
  existingSmartAccountAddress: string | null;
  onActivated?: (result: ActivationResult) => void;
}) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleActivate = () => {
    if (auth.status !== "authenticated") {
      setError("Connect your NEAR wallet to activate treasury");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        const treasuryContractId = existingSmartAccountAddress || DEFAULT_TREASURY_CONTRACT;
        const result = await activateSmartAccount({
          walletAddress: auth.accountId || walletAddress,
          smartAccountAddress: treasuryContractId,
        });

        toast.success("Company Treasury Activated", {
          description: `Treasury contract active on NEAR Testnet (${treasuryContractId}).`,
        });

        onActivated?.(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to activate treasury";
        setError(message);
        toast.error("Activation Failed", { description: message });
      }
    });
  };

  const isAlreadyActive = Boolean(existingSmartAccountAddress);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        onClick={handleActivate}
        disabled={isPending || isAlreadyActive}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {isPending ? (
          <>
            <LoaderCircleIcon className="mr-2 h-4 w-4 animate-spin" />
            Activating...
          </>
        ) : isAlreadyActive ? (
          <>
            <ShieldCheck className="mr-2 h-4 w-4 text-emerald-400" />
            Treasury Active
          </>
        ) : (
          <>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Activate Treasury
          </>
        )}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
