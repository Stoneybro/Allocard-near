# Employee gas sponsorship

Allocard supports NEP-366 meta-transactions for Privy employee direct payments on NEAR testnet. The employee signs an Ed25519 delegate action. A dedicated relayer signs the outer transaction and pays gas. The treasury sees the employee as `predecessor_account_id`, so its existing permission, budget, approval and revocation checks still apply. This requires no contract redeployment.

Sponsorship currently covers the `execute` call for native NEAR employee payments. Employer registration/funding, permission creation, agent transactions, token transfers, and external Wallet Selector signing retain their existing flows. Sponsorship does not supply payment principal: that comes from the company treasury.

## Setup

1. Create a dedicated named NEAR testnet account with a regular Ed25519 FullAccess key and fund it with testnet NEAR for gas. Use a small gas-only balance, separate from company and deployment accounts.
2. Apply the additive journal/quota/nonce migration from the repository root:

   ```sh
   pnpm --filter @allocard/web db:migrate
   pnpm --filter @allocard/web db:check
   ```

3. Configure server environment variables (never `NEXT_PUBLIC_`):

   ```dotenv
   NEAR_SPONSOR_ENABLED=true
   NEAR_RELAYER_ACCOUNT_ID=your-gas-sponsor.testnet
   NEAR_RELAYER_PRIVATE_KEY=ed25519:YOUR_SERVER_SIDE_KEY
   NEAR_SPONSOR_DAILY_LIMIT=100
   NEAR_SPONSOR_USER_DAILY_LIMIT=10
   ```

4. Restart the web server. Keep `NEAR_RPC_URL` pointed at testnet; the relay verifies the RPC chain ID before sponsoring. The relayer key must be dedicated to this service: another application submitting with it can interfere with nonce ordering.

With sponsorship disabled, authenticated Privy payments continue using the existing direct signing flow. Once enabled, sponsorship errors are shown to the employee; the client does not silently switch to charging the employee gas.

## New employee accounts

A Privy wallet can exist before its implicit account exists on NEAR. After checking the employee's active membership, exact company permission, treasury bytecode and on-chain payment preview, the sponsor initializes a missing implicit account with one zero-value native transfer. The relayer pays creation gas; no spendable balance is given to the employee. An existing account with a removed or mismatched signing key is rejected, not recreated.

A first sponsored payment can involve two outer transactions: activation, then payment. Both consume a sponsorship quota slot. Quotas reset by UTC day. They are conservative attempt limits, not counts of successful payments.

## Bounds and recovery

- Only an authenticated Privy identity matching an active employee profile can qualify.
- The treasury must be a registered company treasury with matching release code and no retained keys. The permission must belong to that employee in the current owner epoch.
- The server builds one `execute` action with 150 TGas and zero attached deposit. Arbitrary calls, transfers from the relayer, key management and contract deployment cannot be requested.
- Employee signatures include the NEP-461 signing domain, sender, receiver, exact canonical call arguments, access-key nonce and a maximum 120-block validity window. The server verifies the signature before relaying.
- Persistent database counters bound per-wallet and global attempts. The hard upper configuration bounds are 100 per wallet and 1,000 globally per day; defaults are 10 and 100. Gas prices above 1,000,000,000 yoctoNEAR per gas are refused.
- A database lease serializes relayer-key use across web instances. Allocated nonces advance monotonically. Quota and nonce mutations are not automatically retried after ambiguous database responses.
- The exact signed outer transaction and its hash are saved before broadcast. A repeated payment request only queries that transaction. It never automatically submits a replacement after an uncertain result.
- Request IDs are bound to the employee, treasury/company scope and exact payment details. Payment verification accepts chain-verified NEP-366 envelopes while still matching the employee, treasury, company and request ID.

For an uncertain submission, retry the same payment to reconcile its stored hash. Do not delete browser pending-payment data or journal entries to force a resend. An operator should inspect a job that is reserved without a transaction hash (for example, a process crash during preparation). Such a job is deliberately blocked rather than risking an untracked submission. Keep the relayer's public account ID configured for historical transaction lookup even if sponsorship is later disabled. Do not prune sponsorship jobs or key nonces as routine quota cleanup; old quota buckets can be archived after their UTC day ends.

## Verification

Unit tests cover activation, real employee signatures, nonce/expiry rejection, membership gates, gas/deposit bounds, journal recovery, and signature tampering. Before rollout, perform a live testnet run with a newly created Privy employee, zero employee gas balance and an active company permission. Confirm activation, sponsored transfer settlement, receipt verification, retry recovery, revocation, quota enforcement, and concurrent submissions from separate web instances. Mocked RPC tests do not establish live protocol or database concurrency behavior.

Protocol references: [NEAR meta-transactions](https://docs.near.org/protocol/transactions/meta-tx) and [implicit account initialization](https://docs.near.org/integrations/accounts).
