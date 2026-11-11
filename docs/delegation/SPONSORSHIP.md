# Gas sponsorship

Allocard supports NEP-366 meta-transactions for Privy employee direct payments and opt-in company-owner registration on NEAR testnet. The employee or company owner signs an Ed25519 delegate action. A dedicated relayer signs the outer transaction and pays gas. The treasury sees the employee or owner as `predecessor_account_id`, preserving employee permission checks and owner attribution. This requires no contract redeployment.

Payment sponsorship covers the `execute` call for native NEAR employee payments. Optional company sponsorship covers only `create_company` on the verified shared contract, using the authenticated workspace owner and its exact registration deposit. Treasury funding, permission creation, agent transactions, token transfers, and external Wallet Selector signing retain their existing flows. Sponsorship does not supply payment principal: that comes from the company treasury.

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
- Payments use one `execute` action with 150 TGas and zero attached deposit. Registration uses one `create_company` action with 70 TGas and the exact verified deposit, at most 0.2 NEAR. Arbitrary calls, spendable wallet top-ups, key management and contract deployment cannot be requested.
- Employee signatures include the NEP-461 signing domain, sender, receiver, exact canonical call arguments, access-key nonce and a maximum 120-block validity window. The server verifies the signature before relaying.
- Persistent database counters bound per-wallet and global attempts. The hard upper configuration bounds are 100 per wallet and 1,000 globally per day; defaults are 10 and 100. Gas prices above 1,000,000,000 yoctoNEAR per gas are refused.
- A database lease serializes relayer-key use across web instances. Allocated nonces advance monotonically. Quota and nonce mutations are not automatically retried after ambiguous database responses.
- The exact signed outer transaction and its hash are saved before broadcast. A repeated payment request only queries that transaction. It never automatically submits a replacement after an uncertain result.
- Request IDs are bound to the employee, treasury/company scope and exact payment details. Payment verification accepts chain-verified NEP-366 envelopes while still matching the employee, treasury, company and request ID.

Under NEP-366, a failed inner call can refund its attached deposit to the original sender. Registration transactions are recorded before submission, and retries reconcile the saved transaction hash.

For an uncertain submission, retry the same payment to reconcile its stored hash. Do not delete browser pending-payment data or journal entries to force a resend. An operator should inspect a job that is reserved without a transaction hash (for example, a process crash during preparation). Such a job is deliberately blocked rather than risking an untracked submission. Keep the relayer's public account ID configured for historical transaction lookup even if sponsorship is later disabled. Retain sponsorship jobs and key nonces for transaction recovery. Legacy quota and registration-grant records are unused.

## Verification

Unit tests cover activation, real employee/owner signatures, ownership and membership gates, nonce/expiry rejection, exact gas/deposit bounds, the registration opt-in and repeated registration without quota restrictions, insufficient relayer balance, journal recovery, and signature tampering. Before rollout, register a company from a new zero-balance Privy owner, check the resulting owner and reserves, and repeat activation to verify no second deposit is paid. Then perform a live testnet run with a newly created Privy employee, zero employee gas balance and an active company permission. Confirm activation, sponsored transfer settlement, receipt verification, retry recovery, revocation and concurrent submissions from separate web instances. Mocked RPC tests do not establish live protocol or database concurrency behavior.

Protocol references: [NEAR meta-transactions](https://docs.near.org/protocol/transactions/meta-tx) and [implicit account initialization](https://docs.near.org/integrations/accounts).
