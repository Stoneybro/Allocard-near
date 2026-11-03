"use client";
import { useState, useTransition } from "react";
import { activateSmartAccount } from "@/app/actions/identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/AuthProvider";
import { confirmNearOutcome } from "@/lib/near";
import { isNativeNearAccount } from "@/lib/wallet";
type ActivationResult = Awaited<ReturnType<typeof activateSmartAccount>>;
export function SmartAccountActivationButton({ walletAddress, existingSmartAccountAddress, onActivated, mode = "company" }: {
  walletAddress: string; existingSmartAccountAddress: string | null; onActivated?: (result: ActivationResult) => void; mode?: "company" | "employee";
}) {
  const auth = useAuth();
  const [contractId, setContractId] = useState(existingSmartAccountAddress ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activate = (create: boolean) => startTransition(async () => {
    try {
      setError(null);
      if (auth.status !== "authenticated" || (!auth.selector && !auth.sendActions)) throw new Error("Connect your NEAR signing wallet first");
      let target = mode === "employee" ? auth.accountId : contractId.trim();
      if (create) {
        const parent = auth.accountId;
        if (!auth.sendActions && (!parent.endsWith(".testnet") || parent.length > 45)) throw new Error("Creating a treasury requires a named testnet wallet with room for a subaccount. You can also connect an existing treasury below.");
        target = auth.sendActions ? `allocard-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}.testnet` : `allocard-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}.${parent}`;
        setContractId(target);
        const response = await fetch("/api/treasury/code", { cache: "no-store" });
        if (!response.ok) throw new Error("Treasury Wasm unavailable. Run pnpm contracts:build on the server.");
        const code = new Uint8Array(await response.arrayBuffer());
        if (auth.sendActions) {
          const { functionCall, deployContract, deleteKey } = await import("near-api-js/lib/transaction");
          const { implicitPublicKey } = await import("@/lib/privy-near");
          const publicKey = implicitPublicKey(parent);
          // The user's key temporarily controls deployment, then is deleted atomically.
          await auth.sendActions({ receiverId: "testnet", actions: [functionCall("create_account", { new_account_id: target, new_public_key: publicKey.toString() }, BigInt("100000000000000"), BigInt("10000000000000000000000000"))] });
          // sendActions verifies the temporary key exists before signing this batch.
          await auth.sendActions({ signerId: target, receiverId: target, actions: [deployContract(code), functionCall("new", { config: { owner: parent, network_domain: "near:testnet" } }, BigInt("100000000000000"), BigInt(0)), deleteKey(publicKey)] });
        } else {
        const { actionCreators } = await import("@near-wallet-selector/core");
        const wallet = await auth.selector!.wallet();
        const outcome = await wallet.signAndSendTransaction({ signerId: parent, receiverId: target, actions: [
          actionCreators.createAccount(),
          actionCreators.transfer(BigInt("10000000000000000000000000")),
          actionCreators.deployContract(code),
          actionCreators.functionCall("new", { config: { owner: parent, network_domain: "near:testnet" } }, BigInt("100000000000000"), BigInt(0)),
        ] });
        await confirmNearOutcome(outcome);
        }
      }
      if (!isNativeNearAccount(target)) throw new Error("Enter a NEAR treasury account ID");
      const result = await activateSmartAccount({ walletAddress: auth.accountId || walletAddress, smartAccountAddress: target });
      onActivated?.(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Treasury setup failed"); }
  });
  return <div className="flex max-w-sm flex-col gap-2">
    {mode === "company" && <>
      <p className="text-xs text-muted-foreground">Create a fixed-version testnet treasury with 10 NEAR for deployment/storage. It has no deployment key or upgrade method. Fund spending separately afterward.</p>
      <Button disabled={pending} onClick={() => activate(true)}>{pending ? "Waiting for wallet…" : "Create company treasury (10 NEAR)"}</Button>
      <Input aria-label="Existing treasury account ID" value={contractId} onChange={event => setContractId(event.target.value)} placeholder="treasury.your-wallet.testnet" />
    </>}
    <Button variant="outline" disabled={pending} onClick={() => activate(false)}>{pending ? "Verifying…" : mode === "employee" ? "Use my signing account" : "Verify and connect treasury"}</Button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
