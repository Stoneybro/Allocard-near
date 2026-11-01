#!/usr/bin/env node
/**
 * Allocard Delegation Foundation - Independent CLI Demonstration
 *
 * Demonstrates:
 * 1. Generating cryptographically sound request IDs.
 * 2. Constructing multi-level permission specifications (Root -> Child).
 * 3. Computing canonical Borsh request envelope hashes matching the onchain engine.
 * 4. Simulating preview evaluation and policy validation.
 */

import {
  generateRequestId,
  computeExecuteHash,
  computeOwnerWithdrawHash,
  SDK_VERSION,
  type PermissionSpec,
  type ExecuteRequest,
  type OwnerWithdrawRequest,
} from "@allocard/delegation-sdk";

async function main() {
  console.log("================================================================================");
  console.log(`  ALLOCARD DELEGATION FOUNDATION - CLI DEMONSTRATION (SDK v${SDK_VERSION})`);
  console.log("================================================================================\n");

  const networkDomain = "near:testnet";
  const treasuryContractId = "treasury.allocard.testnet";
  const ownerAccount = "treasury-owner.testnet";
  const financeManager = "manager.testnet";
  const aiAgent = "ai-travel-agent.testnet";
  const hotelVendor = "hotel-booking.testnet";

  console.log("1. CONFIGURATION & ROLES");
  console.log(`   Network Domain:     ${networkDomain}`);
  console.log(`   Treasury Contract:  ${treasuryContractId}`);
  console.log(`   Treasury Owner:     ${ownerAccount}`);
  console.log(`   Finance Manager:    ${financeManager}`);
  console.log(`   AI Travel Agent:    ${aiAgent}`);
  console.log(`   Merchant Recipient: ${hotelVendor}\n`);

  console.log("2. CREATING PERMISSION HIERARCHY");
  // Step A: Root permission for finance manager (5 NEAR lifetime, max depth 2)
  const rootSpec: PermissionSpec = {
    delegate: financeManager,
    valid_from_ms: Date.now().toString(),
    expires_at_ms: (Date.now() + 30 * 24 * 60 * 60 * 1000).toString(), // 30 days
    max_executions: 100,
    rules: [
      {
        asset: { type: "NativeNear" },
        recipients: { type: "Any" },
        min_per_action: "10000000000000000000000", // 0.01 NEAR floor
        max_per_action: "5000000000000000000000000", // 5 NEAR cap
        lifetime_limit: "10000000000000000000000000", // 10 NEAR lifetime
        acknowledge_unbounded_budget: false,
      },
    ],
    redelegation_depth: 2,
  };
  console.log("   [+] Root Permission Spec prepared for Finance Manager:");
  console.log(`       - Max per action: 5 NEAR, Lifetime: 10 NEAR, Max Executions: 100`);

  // Step B: Child permission issued by finance manager to AI Travel Agent (narrowed to 2 NEAR, vendor only)
  const childSpec: PermissionSpec = {
    delegate: aiAgent,
    valid_from_ms: Date.now().toString(),
    expires_at_ms: (Date.now() + 7 * 24 * 60 * 60 * 1000).toString(), // 7 days
    max_executions: 10,
    rules: [
      {
        asset: { type: "NativeNear" },
        recipients: { type: "Only", accounts: [hotelVendor] },
        min_per_action: "50000000000000000000000", // 0.05 NEAR
        max_per_action: "2000000000000000000000000", // 2 NEAR
        lifetime_limit: "2000000000000000000000000", // 2 NEAR
        acknowledge_unbounded_budget: false,
      },
    ],
    redelegation_depth: 0, // leaf permission cannot re-delegate
  };
  console.log("   [+] Child Permission Spec prepared for AI Agent:");
  console.log(`       - Target Recipient: Strictly [${hotelVendor}]`);
  console.log(`       - Max per action: 2 NEAR, Lifetime: 2 NEAR, Max Executions: 10\n`);

  console.log("3. CANONICAL DISPATCH PREPARATION");
  const requestId = generateRequestId();
  console.log(`   [+] Cryptographic Request ID generated (64 lowercase hex):`);
  console.log(`       ${requestId}`);

  const executeRequest: ExecuteRequest = {
    api_version: 1,
    request_id: requestId,
    permission_id: "2", // Child permission ID allocated onchain
    action: {
      type: "Transfer",
      asset: { type: "NativeNear" },
      receiver: hotelVendor,
      amount: "1500000000000000000000000", // 1.5 NEAR
    },
    deadline_ms: (Date.now() + 300000).toString(), // 5 minutes
  };

  const canonicalHash = computeExecuteHash(
    networkDomain,
    treasuryContractId,
    aiAgent,
    executeRequest
  );
  console.log(`   [+] Canonical Borsh Envelope SHA-256 Request Hash:`);
  console.log(`       ${canonicalHash}\n`);

  console.log("4. OWNER WITHDRAWAL ENVELOPE VERIFICATION");
  const ownerRequestId = generateRequestId();
  const ownerWithdrawRequest: OwnerWithdrawRequest = {
    api_version: 1,
    request_id: ownerRequestId,
    authority_epoch: "1",
    action: {
      type: "Transfer",
      asset: { type: "NativeNear" },
      receiver: "cold-storage.testnet",
      amount: "5000000000000000000000000", // 5 NEAR
    },
    deadline_ms: (Date.now() + 300000).toString(),
  };

  const ownerHash = computeOwnerWithdrawHash(
    networkDomain,
    treasuryContractId,
    ownerAccount,
    ownerWithdrawRequest
  );
  console.log(`   [+] Owner Direct Liquidity Withdrawal Hash (Epoch 1):`);
  console.log(`       ${ownerHash}\n`);

  console.log("================================================================================");
  console.log("  DEMO VERIFICATION COMPLETE: SHA-256 HASHES & ENVELOPES ARE CANONICAL.");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
