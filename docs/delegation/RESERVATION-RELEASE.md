# Funded employee allowances: shared schema 5 / standalone schema 4

The shared schema-5 contract was deployed on testnet on November 12, 2026 at `treasury-v5.allocardfactory.testnet`, in transaction `3rXE8Fxeo6Cbt6ujjTyGXYV5XQGxS9Z4HzAbWjJ73CNM`. Its verified code hash is `JE4VA2Gecizs3rEdwNTdRg7DsZJssbg6CC4qnscgJcrF`, and it retains no access keys. This does not upgrade or migrate existing companies. The previous shared schema-4 contract is immutable and remains available for existing companies to revoke permissions, reconcile payments and withdraw funds.

The web release is live at `https://www.allocard.xyz`, Vercel deployment `dpl_6QDSH7Jmy4kY61bqVscBrscxaPHz` (`READY`). Production and preview project configuration now select the schema-5 shared contract for new companies. Live read-only checks confirmed HTTP 200 for the homepage and shared-treasury endpoint, schema 5 / `near:testnet`, and zero access keys through the app's RPC proxy. Unauthenticated employer and employee requests correctly returned to sign-in. An authenticated two-browser activation, delegation and spending test remains necessary to measure the user-visible production timing; these smoke checks do not establish that timing.

## Accounting and limits

Every new root permission requires a finite lifetime limit for each enabled asset. Creating it atomically checks unallocated company principal and reserves that limit. There are at most 64 live root allocations per company (including future-dated grants), and 16 live immediate children per permission. Expired, revoked and previous-epoch roots are pruned when another grant is created. Exhausted call limits, pauses and reversible principal blocks do not release money: revoke the permission to release its unused allocation.

`get_treasury_budget(asset)` returns decimal base-unit strings:

- `available`: principal not currently dispatched; includes employee allocations.
- `allocated`: unused lifetime limits of live root permissions, excluding pending and settled usage. Agent limits are subdivisions, not additional treasury allocations.
- `unallocated`: available principal minus employee allocations. Only this amount can fund another employee or an owner withdrawal.
- `pending_outgoing`: dispatched principal awaiting a definitive callback; it is not available to allocate or withdraw.

Example: deposit 2,000 USDC, allocate 500 to an employee and let them allocate 100 to an agent. The treasury still holds 2,000, of which 500 is allocated and 1,500 is unallocated. A successful 50-USDC payment leaves 1,950 available, 450 allocated and 1,500 unallocated. A proven failed callback restores the employee allocation; an unreadable or missing callback does not fabricate a refund. Revocation or expiry releases only unused capacity; an existing dispatched payment can still settle.

`get_spending_snapshot` computes advisory totals at one chain timestamp, including ancestor limits, blocks, execution limits and agent allocations. `get_spending_snapshots` accepts at most eight queries per read. These views do not authorize a payment: `preview_execute` and `execute` enforce the live rules independently. The web app retains reads and spending support for shared schemas 3/4 and standalone schemas 2/3 using preserved Wasm hashes, but blocks new company registrations and employee grants on old releases.

## Web request behavior

There is no idle full-dashboard, profile or balance polling. Dashboards refresh on window focus, explicit refresh, or confirmed local changes. Workspace discovery refreshes on focus. Session health checks remain every five minutes. Visible research views poll only while a job is unfinished; hidden research views retain drafts without polling.

A confirmed write has one coordinated spending refresh. Confirmed metadata is applied to the cache immediately; a refresh cannot block the activation callback. RPC reads and database work inherit a 20-second dashboard deadline, and the HTTP client has a 30-second deadline. Rate limits return `Retry-After`; the browser suppresses requests for that identity/view during its cooldown. A failed capacity read preserves the last confirmed snapshot and disables payments until a fresh read succeeds. It does not replace balances with zeros.

Metadata transactions wait for `EXECUTED` (finalized transaction plus non-refund execution); payments, funding and uncertain-transaction recovery retain `FINAL`. Initial token storage lookups run concurrently. Compatible company-registration actions are batched into one signed transaction. Recovery uses saved transaction identities; no timeout automatically creates another payment or permission.

Timing logs expose `[dashboard timing]`, `[near read timing]` and `[sponsor timing]`, with operation/duration and public transaction identifiers. They do not log private keys or RPC credentials. A quota-bearing testnet `NEAR_RPC_URL` should still be configured in production; reducing application requests cannot guarantee public-provider capacity.

## Build and review

From the repository root:

```sh
pnpm run contracts:build
cargo test --manifest-path packages/contracts/Cargo.toml --workspace
pnpm run sdk:build
pnpm run sdk:test
pnpm run web:test
pnpm --filter @allocard/web run typecheck
pnpm run web:build
```

Sandbox tests need permission to open local sockets. Review the native and Mock USDC integration results, including over-allocation, owner-withdrawal rejection, descendant spending and callback accounting, before deployment.

Local validation for this release passed 62 Rust unit tests, five sandbox integration tests, 36 SDK tests and 427 web tests, followed by the new concurrent-settlement regression test. The 64-root, three-level execution test consumed 19.01 TGas against an 80 TGas execution allowance. Type checking, targeted lint and the Wasm build also passed. These checks establish local correctness; production activation latency and provider quota still need measurement after rollout.

The full production build passed with Webpack and a 4 GB Node heap. This environment blocked Turbopack's compiler socket; Webpack's default 2 GB heap was insufficient. The validated alternative is:

```sh
NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @allocard/web exec next build --webpack
```

## Deployment and migration order

1. Use a fresh, funded named testnet account for the new shared deployment. Do not redeploy over, delete, or remove access to the old contract. Keep its identifier and all historical transaction/permission records.
2. Set operator-only `SHARED_TREASURY_ACCOUNT_ID` and `SHARED_TREASURY_DEPLOY_KEY` for that fresh account. Run `pnpm shared:deploy` for the plan and `pnpm shared:deploy --check` for its read-only state. Only run `pnpm shared:deploy --execute` after review and authorization. Initialization deletes every deployment key; this release is also immutable.
3. Verify the exact new Wasm hash, zero retained keys, `near:testnet` domain and platform schema 5. The creation deposit remains 0.2 NEAR and is not spending principal.
4. Deploy the web release with the new server-only `SHARED_TREASURY_ACCOUNT_ID`. Include both new and historical Wasm artifacts in the package. Existing companies keep their full original `contract#company_id` reference. Never globally rewrite those references to simulate migration.
5. Migrate each existing company with its employer. Save its old reference; reconcile every pending execution/sponsor job first. Revoke old employee/agent permissions onchain and synchronize their database statuses. Settled payments and history must remain intact.
6. Fund the employer’s signing account with testnet NEAR for withdrawal gas if needed. With the employer's explicit signatures, withdraw spendable principal from the old treasury to an employer-controlled account. For NEP-141 assets, register the receiving account's token storage first. Storage collateral and operating reserves are separate from withdrawable principal. A pending, failed or ambiguous withdrawal must be reconciled by its original request ID, never replaced blindly.
7. Register the same database company UUID on the new shared contract using the same employer identity. Enable the spending token. Deposit the recovered principal with `ft_transfer_call` and `{"company_id":"..."}` (or `deposit_native` for NEAR). A raw transfer to the shared account does not identify the company. Verify the new ledger before linking the new reference through the authenticated `activateSmartAccount` action. The server refuses a treasury switch while old company permissions remain active.
8. Existing companies do not receive a second automatic activation faucet grant during migration. Preserve ownership and company identity, verify the funded balance, then create new employee allowances. Tokens remain in the treasury until a payment is dispatched.
9. Run the two-browser test: create an employee allocation, reject a competing allocation above unallocated funds, create an agent subdivision, verify a direct payment, revoke unused access, and verify restored unallocated capacity. Inspect actual receipts and token balances, not just UI notifications.

Deployment, employer signatures, withdrawal/funding and changing production environment settings are separate rollout steps. Building this release does not perform them. The new shared deployment is complete; existing-company migration still requires employer signatures. Until a company migrates, its old contract cannot enforce the new funding guarantee.
