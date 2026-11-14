# Gas sponsorship

Allocard supports NEP-366 meta-transactions for Privy employee direct payments, employer employee-allowance creation, employee agent-permission creation, permission revocation and opt-in company setup on NEAR testnet. The employee or company owner signs an Ed25519 delegate action. A dedicated relayer signs the outer transaction and pays gas. The treasury sees the employee or owner as `predecessor_account_id`, preserving permission checks and owner attribution. This requires no contract redeployment.

Payment sponsorship covers the employee's treasury `execute` call. Company setup can batch registration, asset setup and bounded reserve deposits on the verified shared contract. Permission creation and revocation use zero attached deposit; company storage and operating reserves pay contract-side costs. The relayer pays directly for mock-USDC funding and token registration. Payment principal comes from the company treasury. Its mock USDC balance does not pay native NEAR transaction fees in a user's wallet.

## Employer allowances and revocation

The employer dashboard calls the dedicated sponsored allowance flow, rather than the generic wallet-funded root-permission call. The server requires the authenticated company owner, active employer membership, a pending company delegation, an accepted employee whose account matches the signed delegate, verified treasury code/ownership and sufficient unallocated treasury funds. The employer signs one `create_root_permission` action with 80 TGas and zero deposit. The policy is bounded to the supported spending asset, a positive finite lifetime budget and at most one level of agent delegation.

The browser retains the reviewed policy during an uncertain outcome. A stable server journal binds the company, employer, delegation record and exact policy to the saved transaction. Recovery checks the original transaction and verifies the returned permission against the signed policy before database activation. A proven failed atomic root receipt releases that attempt; an ambiguous receipt keeps it for recovery.

Revocation also uses one zero-deposit 80 TGas action. A company owner can revoke company permissions; an employee can revoke their own mapped agent permission. The server checks membership, treasury ownership and the on-chain issuer. Revocation remains available while the treasury is paused or a policy is expired or blocked. Already-revoked access succeeds without a new signature or transaction.

These two flows never fall back to charging an empty Privy wallet. A rejected `INVALID_TRANSACTION / NotEnoughBalance` transaction has not executed: after loading the fixed dashboard, the user can retry the delegation. The user's signature is still required; sponsorship does not give the server authority to invent their policy.

## Setup

1. Create a dedicated named NEAR testnet account with a regular Ed25519 FullAccess key and fund it with testnet NEAR for gas and any registration deposits you choose to sponsor. Use a bounded sponsor balance, separate from company and deployment accounts.
2. Apply the additive journal and nonce migration from the repository root:

   ```sh
   pnpm --filter @allocard/web db:migrate
   pnpm --filter @allocard/web db:check
   ```

3. Configure server environment variables (never `NEXT_PUBLIC_`):

   ```dotenv
   NEAR_SPONSOR_ENABLED=true
   NEAR_SPONSOR_COMPANY_ENABLED=false
   NEAR_RELAYER_ACCOUNT_ID=your-gas-sponsor.testnet
   NEAR_RELAYER_PRIVATE_KEY=ed25519:YOUR_SERVER_SIDE_KEY
   ```

Set `NEAR_SPONSOR_COMPANY_ENABLED=true` to also enable owner registration sponsorship. This pays the registration deposit as well as gas, so it is a separate opt-in. The current exact deposit is 0.2 NEAR; the server refuses larger deposits or deposits differing from the verified shared contract's quote. Payments, registrations, and faucet claims have no daily quotas or lifetime registration caps. The sponsor checks its available balance before submitting each transaction. Obsolete quota settings and stored quota records are ignored.

4. Restart the web server. Keep `NEAR_RPC_URL` pointed at testnet; the relay verifies the RPC chain ID before sponsoring. The relayer key must be dedicated to this service: another application submitting with it can interfere with nonce ordering.

With sponsorship disabled, authenticated Privy payments continue using the existing direct signing flow. Once enabled, sponsorship errors are shown to the employee; the client does not silently switch to charging the employee gas.

## New signing accounts

A Privy wallet can exist before its implicit account exists on NEAR. For payments, the sponsor checks active employee membership, the exact company permission, treasury bytecode and on-chain payment preview. For registration, it checks workspace ownership, active employer membership and the shared contract release/quote. It then initializes a missing implicit account with one zero-value native transfer. The relayer pays creation gas; no spendable balance is given to the employee. An existing account with a removed or mismatched signing key is rejected, not recreated.

A first sponsored payment or registration can involve two outer transactions: signing-account activation, then the requested call. Both are journaled so retries recover the original transaction.

## Bounds and recovery

- An authenticated Privy identity must match the active employee profile for payments, or own the workspace and have active employer membership for registration.
- The treasury must be a registered company treasury with matching release code and no retained keys. The permission must belong to that employee in the current owner epoch.
- Payments use one `execute` action with 150 TGas and zero attached deposit. Root creation and revocation each use one 80 TGas zero-deposit action. Registration uses the exact verified deposit, at most 0.2 NEAR, with separately bounded setup/reserve actions. Arbitrary calls, spendable wallet top-ups, key management and contract deployment cannot be requested.
- Employee signatures include the NEP-461 signing domain, sender, receiver, exact canonical call arguments, access-key nonce and a maximum 120-block validity window. The server verifies the signature before relaying.
- Sponsor balance, exact authorized actions and bounded deposits constrain sponsorship. Legacy daily quota counters are unused. Gas prices above 1,000,000,000 yoctoNEAR per gas are refused.
- A database lease serializes relayer-key use across web instances. Allocated nonces advance monotonically. Journal and nonce mutations are not automatically retried after ambiguous database responses.
- The exact signed outer transaction and its hash are saved before broadcast. A repeated payment request only queries that transaction. It never automatically submits a replacement after an uncertain result.
- Request IDs are bound to the employee, treasury/company scope and exact payment details. Payment verification accepts chain-verified NEP-366 envelopes while still matching the employee, treasury, company and request ID.

Under NEP-366, a failed inner call can refund its attached deposit to the original sender. Registration transactions are recorded before submission, and retries reconcile the saved transaction hash.

For an uncertain submission, retry the same payment to reconcile its stored hash. Do not delete browser pending-payment data or journal entries to force a resend. An operator should inspect a job that is reserved without a transaction hash (for example, a process crash during preparation). Such a job is deliberately blocked rather than risking an untracked submission. Keep the relayer's public account ID configured for historical transaction lookup even if sponsorship is later disabled. Retain sponsorship jobs and key nonces for transaction recovery. Legacy quota and registration-grant records are unused.

## Verification

The [verification guide](../VERIFICATION.md) links tests for signature validation, ownership and membership checks, nonce/expiry rejection, deposit bounds, idempotent funding, journal recovery, and permission revocation. Reproduce gas-sponsored activation, allowance creation, payment, and revocation with the [walkthrough acceptance checks](TODAY.md).

Protocol references: [NEAR meta-transactions](https://docs.near.org/protocol/transactions/meta-tx) and [implicit account initialization](https://docs.near.org/integrations/accounts).
