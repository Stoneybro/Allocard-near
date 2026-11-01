# Allocard delegation foundation

Allocard lets principals spend from one company treasury within contract-enforced permissions, without prefunding employee wallets. Each payment selects a permission and satisfies every ancestor's policy and shared budget.

This repository contains a Rust treasury contract, a local TypeScript SDK, deployment tooling, and a **local UI simulation**. The UI does not connect a wallet, read live balances, or submit payments. Its sample outcomes do not demonstrate contract execution.

## Layout and checks

- `packages/contracts/treasury`: Rust contract and sandbox tests.
- `packages/delegation-sdk`: wallet-independent client, canonical hashes, exact token amounts, and optional `@allocard/delegation-sdk/near-api` binding for near-api-js v7.
- `packages/scripts`: build, test, deployment, and offline envelope demo commands.
- `apps/web`: Next.js simulation importing the SDK.
- `docs/delegation/fixtures`: shared contract/SDK JSON fixtures.

Run from the repository root:

```sh
pnpm run contracts:build
pnpm run contracts:test
pnpm run sdk:build
pnpm run sdk:test
pnpm --filter @allocard/delegation-sdk run typecheck
pnpm run web:build
pnpm run delegation:check
```

`contracts:test` builds fresh Wasm before running unit and sandbox tests. `delegation:check` includes contract tests, SDK build/tests, and the web build. Sandbox tests need permission to create local sockets and start the NEAR sandbox process. They are not silently skipped if the environment prevents that. To run only Rust unit tests: `cargo test --manifest-path packages/contracts/Cargo.toml --lib`.

`pnpm run demo` prepares canonical envelopes offline; it does not send transactions or verify settlement on a network.

## Accounting and settlement

- Permission creation reserves no funds. Execution reserves each ancestor budget and debits available liquidity before scheduling a transfer.
- Deferred collection writes are flushed and actual persistent growth is charged to `storage_funding_remaining`. Storage freed later becomes unallocated surplus.
- Each execution separately reserves the maximum callback record growth in `callback_storage_reserved`. Settlement does not depend on a later storage top-up.
- FT marker deposits debit `operating_budget_remaining`. Native payments protect available native principal, existing/projected storage, unused storage funding, callback reserves, and the greater of remaining operating funds and the configured operating floor.
- Funds already dispatched are excluded from `available`; NEAR debits outgoing promise deposits from the runtime account balance. Do not subtract historical `pending_outgoing` a second time from that balance. Pending accounting remains until settlement, including after revocation or pause.
- Only a proven failed receipt restores principal. Oversized/unreadable callback data leaves the execution pending and flagged for reconciliation. No timeout or administrator assertion releases reservations.
- Identical withdrawal or delegated requests return the recorded execution even after pause, epoch changes, or ownership handover. Deliberate retries after failure require a new request ID.

## SDK boundary

JSON IDs, timestamps, amounts, and fixed-window indexes are decimal strings. Hashes are 64-character lowercase hex. Optional response fields can be `null`. `docs/delegation/fixtures/execution.json` is round-tripped by Rust and consumed by SDK tests, including integers above JavaScript's safe range.

Inject a `NearCaller` for mutations and views. Mutation ID results accept either a decoded decimal string or a final NEAR outcome with a JSON-encoded `SuccessValue`. Failed, pending, signing-only, and malformed results are rejected. The optional near-api-js adapter waits for `FINAL`; the client then polls the contract execution record to distinguish dispatch from payment settlement.

Use `parseTokenAmount` and `formatTokenAmount` for exact amounts. Floating-point arithmetic and scientific notation are not supported for transaction amounts.

## Development deployment

The updated treasury uses **state schema 2**. Its extra callback-reserve field changes Borsh state layout. Use a fresh deployment; do not overwrite a schema-1 treasury with this Wasm. No migration or application upgrade endpoint is supplied.

The deployment script builds current code and batches `DeployContract` and `new` in one atomic transaction. It verifies the code hash, configured owner, and network domain afterward. The target account must already exist and hold enough NEAR for code/state storage and the operating floor.

Set `TREASURY_ACCOUNT_ID`, `OWNER_ACCOUNT_ID`, `NEAR_NETWORK` (default `testnet`), and deployment-only `TREASURY_DEPLOY_KEY`, then run `bash packages/scripts/deploy.sh`. `NEAR_RPC_URL` optionally overrides RPC. Keep deployment credentials outside the repository and outside the app server/browser. The script retains deployment keys and reports that bypass; it does not claim to create a locked production treasury.

After initialization, fund `top_up_storage` and `top_up_operating` separately from `deposit_native`. FT transfers additionally require allowlisting/enabling the token and preparing token storage registration separately. Direct FT transfers do not create internal credits.

## Limits and remaining work

This is not an audited or production-ready treasury. Full-access deployment keys can replace its code or bypass contract controls. Locked deployments have no built-in upgrade/recovery path. Missing callbacks may lock reservations indefinitely. Retained history consumes storage. Fixed-duration windows are not calendar months.

The sandbox tests currently cover selected native-transfer scenarios, not all acceptance categories in the foundation spec. Adversarial FT contracts, maximum-policy gas measurements, and NEP-366 relayer integration remain required before declaring the full foundation complete. Prior gas measurements predate the accounting changes and must be rerun; no updated throughput or maximum-bound claim is made here.
