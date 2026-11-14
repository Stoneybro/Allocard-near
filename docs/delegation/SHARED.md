# Shared company treasury (schema 5)

The current onboarding path registers companies inside one shared NEAR contract. Registration writes company state rather than creating accounts or deploying contracts. Each company has separate ownership, permissions, allocations, ledgers, storage funding, operating reserves, and execution records.

The app stores a treasury reference as `contract.testnet#<64-character-company-id>`. This is not a NEAR account ID. The SDK sends transactions to the contract account and injects `company_id`. The company ID is derived from the owner and database company UUID. Request hashes, callbacks, history, and recovery are scoped to that company.

See [allowance accounting](RESERVATION-RELEASE.md) for employee reservations and agent subdivisions.

## Build and deploy

Run commands from the repository root. Install Rust with the `wasm32-unknown-unknown` target and install the pnpm workspace dependencies.

```sh
pnpm contracts:build
pnpm sdk:build
```

Use a fresh, funded, dedicated testnet account for the shared contract. Set `SHARED_TREASURY_ACCOUNT_ID` and `SHARED_TREASURY_DEPLOY_KEY` in the operator shell. Deployment tooling does not automatically read the app's `.env.local`.

```sh
pnpm shared:deploy
pnpm shared:deploy --check
```

The first command prints the deployment plan; `--check` performs read-only verification. Inspect the artifact size and account funding before deliberately deploying:

```sh
pnpm shared:deploy --execute
```

Deployment installs and initializes the contract, then removes every access key. The result is immutable: there is no retained platform withdrawal or upgrade key. Do not use a personal account or attempt to overwrite an existing deployment. New companies require schema 5 and `near:testnet`.

Company registration attaches exactly 0.2 NEAR: 0.1 NEAR funds operations, with the rest covering company storage and remaining storage funding. This is separate from spending principal. Sponsored onboarding also includes bounded reserve top-ups; see [gas sponsorship](SPONSORSHIP.md).

## Configure the app

Set these in `apps/web/.env.local`:

```dotenv
SHARED_TREASURY_ACCOUNT_ID=your-shared-treasury.testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID=your-token.testnet
```

The web server needs `packages/contracts/res/allocard_shared.wasm` matching the deployment. `SHARED_TREASURY_WASM_PATH` can override its location. `GET /api/treasury/shared` verifies code hash, schema, network domain, and the absence of retained access keys before returning registration configuration. An incompatible artifact or contract disables setup.

The browser uses the same-origin `/api/near/rpc` gateway. Keep provider credentials in server-only `NEAR_RPC_URL`, not public variables. Restart the app after server configuration changes; rebuild when public variables change.

## Prepare mock USDC and the relayer

Create a dedicated, funded testnet relayer with a registered Ed25519 FullAccess key. In the operator shell set `NEAR_RELAYER_ACCOUNT_ID` and `NEAR_RELAYER_PRIVATE_KEY` to that relayer’s credentials. Set `MOCK_USDC_ACCOUNT_ID` to a separate funded testnet token account and `MOCK_USDC_DEPLOY_KEY` to its deployment key.

```sh
pnpm mock-usdc:build
pnpm mock-usdc:deploy
```

Inspect the plan, then deliberately deploy and verify:

```sh
pnpm mock-usdc:deploy --execute
pnpm mock-usdc:deploy --check
```

Alternatively, `--create-with-relayer` can create a direct token subaccount of the relayer; inspect its funding plan before adding `--execute`. The token is initialized with the relayer as its minter. Point `NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID` at that token and configure the same relayer in the app. A public token address without its authorized minter cannot reproduce automatic demo funding.

Apply app database migrations, configure Privy and sponsorship using the [environment template](../../apps/web/.env.example) and [sponsorship guide](SPONSORSHIP.md), then follow the [root README](../../README.md).

## Existing companies

Existing companies retain their original treasury reference. Older immutable schemas do not gain schema-5 funding guarantees automatically. Preserve legacy verification artifacts needed by those companies. Before any deliberate migration, reconcile pending executions, revoke unused old permissions, and withdraw principal with the owner's authorization. Register and fund the new company treasury, verify its ledger, and link it only after active old permissions are cleared. Never rewrite references to simulate a migration or replace an uncertain payment with a new one. Migration withdrawals may require owner-wallet gas and are outside the gas-sponsored demo walkthrough.
