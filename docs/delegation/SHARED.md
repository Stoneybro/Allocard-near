# Shared company treasury (schema 3)

The active onboarding path is one ordinary contract for all companies. Company registration writes state; it does not create accounts, deploy code, or publish a global contract. The earlier global factory is an alternative experiment and is not used by the current onboarding component.

The shared contract reuses the existing policy engine. Every company has separate owner/epoch/pause settings, permission IDs, usage and approval maps, ledgers, execution IDs, replay records, storage funding and operating reserves. Company IDs are SHA-256 of `owner_account_id + NUL + company_key`. The application uses the database company UUID as the key; another owner cannot front-run that namespace.

The application persists a treasury reference `contract.testnet#<64-character-company-id>` in the existing text account field. It is not a NEAR account ID. The SDK separates the receiver account from company identity and injects `company_id` into every view and mutation. Native account lookups and explorer URLs use only the contract account. Existing dedicated references without `#` retain their legacy SDK behavior. No database migration is needed for shared registration. Existing balances/permissions are not automatically migrated from old deployments.

Canonical request and approval hashes include company identity via the network-domain string `near:testnet:company:<company_id>`. Numeric permission and execution IDs may repeat across companies. Asynchronous transfer callbacks include `company_id`; only the contract can invoke them. Payment verification checks the actual transaction receiver, signer, request ID and company argument. Payment recovery/history keys contain the full treasury reference, preserving isolation when one employee works at multiple companies.

## Accounting

All native funds occupy one NEAR account. The contract tracks aggregate obligations across every company: available native principal, storage funding, callback storage reservations, and operating budgets (including each company's minimum operating reserve). Before completing mutations it checks these obligations plus actual account storage and scheduled outgoing transfers against physical account balance. A company cannot use another company's budget or reserves.

A failed-transfer settlement restores only that company's principal. Since protocol refunds arrive asynchronously, settlement may temporarily precede physical liquidity; subsequent mutations still require aggregate solvency. Token deposits specify `{"company_id":"..."}` in the NEP-141 message and credit the ledger for the calling token contract only. The shared contract maintains each company's operating floor even when token transfers spend a one-yocto marker.

Company registration requires exactly **0.2 NEAR**. It allocates 0.1 NEAR to that company's operating budget and uses the rest for actual company storage and remaining storage funding. None is credited as spendable principal. These are configured reserves, not a claim that creation burns 0.2 NEAR or that it is the minimum possible cost. Spending principal and later storage funding are added separately. Actual initial deployment cost depends on the shared WASM size and protocol storage pricing.

## Build and test

```sh
pnpm contracts:build
pnpm sdk:build
pnpm sdk:test
pnpm web:test
pnpm --filter @allocard/web typecheck
```

Rust packages can be tested with `cargo test --manifest-path packages/contracts/Cargo.toml --workspace --lib`. Sandbox integration tests require an environment that permits local sockets; unit tests do not establish live network behavior. The shared engine feature is compiled without standalone RPC wrappers, so only the outer company-aware ABI is exposed in the shared WASM.

## Testnet deployment

Use one fresh, funded named testnet account. No publisher account or global publication fee is needed. Review the actual artifact size from the plan and fund its ordinary storage allocation, initial state, and gas. The deployment code is testnet-only; mainnet rollout needs a separate reviewed release.

Set `SHARED_TREASURY_ACCOUNT_ID` and `SHARED_TREASURY_DEPLOY_KEY` in an operator shell, keeping the private key out of application configuration and chat. Then:

```sh
pnpm contracts:build
pnpm shared:deploy
pnpm shared:deploy --check
# Review the plan and read-only account check before signing:
pnpm shared:deploy --execute
unset SHARED_TREASURY_DEPLOY_KEY
```

`--check` reads the final account state without a signing key. It reports balance, current code hash, key count and whether this exact release is already verified. An already verified deployment is reused without signing another transaction. Failures report the phase and sanitized error details; always check account state after a submission timeout.

The deployment batch installs the code, initializes the network domain and deletes every account access key. No platform withdrawal, upgrade, or administrator override is exposed. This locks the release permanently; fixes require a new deployment, with explicit withdrawal/re-registration by company owners. Do not deploy on a personal account.

Set server-only `SHARED_TREASURY_ACCOUNT_ID` in `apps/web/.env.local` (or host environment) and restart the app. The web server needs `packages/contracts/res/allocard_shared.wasm` from the same reviewed build; override its location with `SHARED_TREASURY_WASM_PATH` if necessary. `GET /api/treasury/shared` verifies bytecode, schema/domain, and absence of retained keys before returning the registration quote.

## RPC connectivity

The browser reads NEAR and submits Privy-signed transactions through the same-origin `/api/near/rpc` gateway, avoiding a browser connection to third-party RPC servers. The server defaults to the testnet RPC; configure server-only `NEAR_RPC_URL` for a different testnet provider. Keep provider credentials out of `NEXT_PUBLIC_` variables. Restart the app after changing configuration.

The gateway accepts bounded public reads and requires an authenticated matching signer for transaction submission. Identical concurrent contract reads are coalesced. Advisory employee capacity snapshots can reuse a successful read for at most two seconds. Ownership verification and access-key nonces bypass these snapshots. Read transport failures may be retried once; HTTP 429 responses honor Retry-After and a provider cooldown instead of immediately resending. Persistent limits require a testnet RPC endpoint with available quota. Transaction submissions are never automatically retried; an uncertain Privy submission includes its transaction hash for reconciliation. This gateway does not sign transactions or provide gas sponsorship.

## Acceptance

Use two companies and two browser profiles. Register each company; verify that refresh/retry reuses its existing registration without another deposit. Fund both, invite an employee by verified email, grant a bounded permission and pay a recipient. Check actual receipt settlement, budget usage and revocation. Repeat with the same employee in both companies; permission/execution/request IDs must never cross company boundaries. Registration, funding, execution and revocation use ordinary function calls supported by Privy and NEAR Wallet Selector.

If a registration submission times out, retry the same workspace to reconcile its deterministic company ID. A duplicate chain registration fails and its attached deposit is refunded by the protocol; the application checks existence before resubmitting. Spend retries keep the same company-scoped request. No admin may force a pending execution to succeed or refund it without an authoritative callback.
