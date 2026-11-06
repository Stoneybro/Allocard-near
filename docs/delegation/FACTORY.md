# Global treasury factory rollout (alternative, testnet)

The active app now uses the [shared treasury](./SHARED.md). This document describes the optional global-contract architecture; do not follow it for current onboarding.

Each company has its own account, state, balance, and owner. The factory references one reviewed global treasury WASM by immutable code hash. Both factory and treasury are keyless, with no upgrade/withdrawal escape hatch in the factory. Publish a new factory release to change configuration or code. Company policy logic is unchanged.

Privy, Meteor and MyNearWallet only sign normal function calls. The Rust factory emits `UseGlobalContract`; browser SDKs do not need to support that action. Operator tooling uses the already installed near-api-js 7 SDK. No new packages or database migration are required for this factory change.

## Prepare artifacts and accounts

```sh
pnpm contracts:build
pnpm factory:publish
pnpm factory:deploy
```

The last two commands print plans only. Confirm the treasury hash and artifact bytes. Publishing global code burns a one-time code storage fee (the NEP-591 rate is 10 times regular per-byte storage staking), plus transaction gas. Unlike local deployment, this is not refundable collateral. Confirm current protocol fees and fund the publisher accordingly; the ~795 KB current artifact can require roughly 80 test NEAR just for publication. Do not assume the per-company setup quote covers publication.

Create two funded named testnet accounts: a publisher and an empty factory account, e.g. `allocard-factory-v1.testnet`. The factory ID must be at most 29 characters, leaving room for a deterministic child label. Fund the factory for its own WASM/state storage and gas before deployment. It receives 0.02 NEAR registry funding per creation attempt; that is retained, not spendable company principal.

Set these variables in the operator shell or a local secret manager, never in source code or chat:

- `NEAR_PUBLISHER_ACCOUNT_ID` and `NEAR_PUBLISHER_KEY` for publication.
- `FACTORY_ACCOUNT_ID` and `FACTORY_DEPLOY_KEY` for factory deployment.
- Optional `NEAR_RPC_URL` (testnet only), `FACTORY_ACCOUNT_FUNDING` (yoctoNEAR, default 0.2 NEAR; permitted range 0.15–1 NEAR).

Factory funding is deliberately configurable and unmeasured until a live test completes. The 0.2-NEAR child allocation covers initial account/reference/state storage and the treasury’s 0.1-NEAR operating floor. Spending principal, permission storage funding, additional operating funding, and employee gas are separate.

## Execute only after reviewing plans

```sh
pnpm factory:publish --execute
# Wait for the global contract to be distributed across shards.
pnpm factory:deploy --execute
```

The deployment tool refuses to overwrite an account with existing code. It batches local factory deployment, initialization, and deletion of every access key. Once this succeeds, the factory is permanently pinned to this treasury hash and configuration. The publisher retains its own keys, but cannot modify a hash-pinned reference. Do not use global references by publisher account ID.

No agent automatically runs these signing commands. Never export operator deployment keys into the application server's environment.

## Enable the application

Set `TREASURY_FACTORY_ACCOUNT_ID` in `apps/web/.env.local` (and the deployed app's server environment), then restart the app. The web server needs these files from the exact reviewed build:

- `packages/contracts/res/allocard_treasury.wasm`, or `TREASURY_WASM_PATH`.
- `packages/contracts/res/allocard_factory.wasm`, or `FACTORY_WASM_PATH`.

`GET /api/treasury/factory` returns a verified quote. It rejects mismatched code, mutable global references, retained factory keys, and a different treasury hash. Treasury linking also requires the exact local/global treasury hash, expected owner/domain/schema, and zero access keys.

The UI sends the database company UUID as `company_key`. The factory derives the child name from caller account + company key; callers cannot nominate another owner. Different owners using the same key receive different addresses. Successful existing creations are reused without another payment. Pending records prevent a duplicate submission after timeout or refresh.

## Failure and refund behavior

Creation state is `Pending` → `Ready` or `RefundAvailable`. Account creation, transfer, global reference and treasury initialization share one atomic child receipt. A callback confirms the child outcome. Overall transaction success alone does not imply successful provisioning.

On failure, the attached child funding returns asynchronously to the factory. The caller can invoke `claim_refund` once the balance is liquid. The registry allocation is retained to cover its permanent record. Refund state is `Refunding` → `Refunded` or back to `RefundAvailable`. After a confirmed refund, the caller may retry creation with the same company key and a new setup deposit. Neither pending creation nor pending refund can be restarted or double claimed.

If a callback itself fails or exhausts gas, do not create another workspace or manually edit records; reconcile receipts first. This version has no admin override for stuck states. Callback gas is allocated explicitly and local tests cover state transitions, but only a live receipt-level run establishes the deployed behavior.

## Acceptance before declaring complete

Run Rust/web/SDK checks, then [TODAY.md](./TODAY.md). Verify the actual global reference and zero keys using RPC, employer identity, separate balances for two companies, duplicate setup behavior, and employee payment/revocation. Test a deliberately unpublished hash in an isolated test factory: creation must fail atomically and account funding must be claimable. Check failed refund recovery. Measure storage and gas before reducing configured funding.

Local unit checks and Wasm compilation do not establish live Privy compatibility, global distribution, final receipt outcomes, or production readiness.
