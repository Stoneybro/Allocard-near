# Allocard

> **Before trying the demo:** Please have two email accounts and a second browser profile or incognito window ready. One account is the company owner; the other is an employee. We know this adds a few steps for judges, and we’re sorry for the extra setup. Using both accounts lets you try the full flow: grant an allowance, spend as an employee, and manage access as the owner.

Allocard helps teams that pay business expenses in crypto. The company keeps its money in one treasury, and employees can pay for what they need within limits the company sets.

## Why we are building it

Small teams often have tight budgets. They cannot afford to leave money sitting unused in employee accounts or prepaid expense cards when the business needs it elsewhere.

But employees still need to pay for things as they work. Asking someone to send them money every time they need to pay for software, a service, or another expense slows them down.

With Allocard, a company can tell an employee: “You can spend up to 500 USDC from our treasury.” The company does not have to send that 500 USDC to the employee first. The money stays in the treasury until the employee makes a payment.

The company chooses the spending limit, who the employee can pay, and when their access ends. The employee can then pay within those rules without asking each time. The company can see what has been spent and stop further spending when needed.

An allowance sets aside part of the treasury balance for that employee. If the company needs the unused money for something else, it can cancel the allowance and use the remaining amount.

We are building this so small teams can keep control of their money while employees can spend when they need to.

Employees can also let an AI agent use part of their allowance. The agent must follow the same limits or stricter ones. NEAR smart contracts check the rules before any payment leaves the treasury.

## Current version

The app currently runs on **NEAR testnet**. It uses test USDC when a mock token contract is configured, or test NEAR otherwise. Test USDC has no monetary value.

## How it works

A company owner creates a workspace, activates its treasury, and adds employees by email. Each employee signs in with their own account and accepts the invitation.

The owner then creates a spending permission for that employee. It can include a total allowance, a limit per payment, a recurring budget, allowed recipients, an expiry date, and a limit on the number of payments.

An employee can use that permission to pay a NEAR account directly. They can also delegate part of their allowance to an agent. The agent's permission must fit within the employee's permission. An employee cannot give an agent more authority than they received.

For example, a company could give an employee a 500 USDC allowance and let them allocate 100 USDC of it to an agent. That allocation reserves part of the employee's budget. It does not transfer money to the agent.

The contract checks the full permission chain when a payment is made. Revoking an employee's permission also prevents new payments through its child permissions. Payments that have already settled remain in the activity history.

## Built for everyday use

### Sign in without setting up a wallet

Employees sign in with email or Google. Privy creates an embedded NEAR wallet for them, so they do not need to bring an existing wallet or install a wallet extension.

### Spend without buying gas tokens

For company registration, employee payments, and research agent permission creation, Allocard supports NEP-366 meta-transactions. The user signs the action, and a relayer submits it and pays the gas. The treasury still checks the user's spending limits.

This means employees can make sponsored payments without buying NEAR for gas. Some other actions use direct transactions, and the demo also uses relayer-funded account setup. Sponsorship must be enabled and the relayer funded; not every transaction currently goes through the meta-transaction path.

### Write a policy in your own words

You can describe the allowance instead of filling in every field. For example:

> Give this employee a total budget of 500 USDC. Allow up to 100 USDC per week, no more than 25 USDC per payment, and at most 20 payments. End access after 30 days.

Allocard turns the description into spending limits for you to review before activation. You can also configure the limits manually. The dashboard shows employees and their agent permissions in a visual tree.

The contract enforces supported amounts, recipients, dates, and payment counts. Instructions such as “business expenses only” are recorded as guidance; the contract cannot judge the purpose of a purchase.

### Set recurring limits and keep control of the total

Policies can limit the total allowance, the amount per payment, the number of payments, and spending per hour, day, week, or fixed 30-day period. They can also restrict recipients and set an expiry date.

A recurring limit lets a team set a budget once rather than issue a new allowance every week. Each period resets the recurring limit, while the total allowance continues to cap all spending. It does not automatically transfer money or create a new delegation. Departments could use this budgeting pattern through a person responsible for their spending; the current app manages companies, employees, and agents rather than separate department accounts.

### Give an agent part of an employee's allowance

Employees can create a smaller permission for an AI agent within their own allowance. The contract checks that the agent's permission does not exceed the employee's limits. Revoking the employee's permission also stops new payments through the agent's permission.

The app searches NEAR AI Market for agents. In this testnet demo, only the configured purchasing research agent can run; other listings are available to browse. The research agent compares business software and returns a report with source links. It does not make purchases, charge the treasury, or create a paid marketplace hire.

### Fund the treasury from other tokens

The funding dialog includes an Aurora Intents widget for swapping supported tokens from other chains into NEAR. The aim is to let a team fund its treasury with tokens it already holds.

The widget is available in the demo, but it cannot fund a NEAR testnet treasury. Use **Add funds → Faucet** for demo funds. Cross-chain funding is not demonstrated end to end in this version.

### Review activity and stop access

Owners can review payments and research activity from their dashboard. Payments include links to the NEAR testnet explorer. Owners can revoke employee permissions, and employees can revoke permissions they gave to agents.

## Try the demo

You need two email accounts you can access: one for the company owner and one for an employee. Use a separate browser profile or an incognito window for the employee.

1. Sign in as the company owner, create a company, and activate its treasury. With test USDC configured, activation adds demo funds. You can add more through **Add funds → Faucet**.
2. Click **Add Employee** and enter the second email address.
3. In the other browser window, sign in with that email, finish onboarding, and accept the company invitation. The employee should now appear in the owner's dashboard.
4. Return to the owner account. Click **Add delegation**, select the employee, configure their limits, and activate the delegation.
5. Return to the employee dashboard. The employee should now have an allowance and be able to make a direct payment to a valid NEAR testnet account.
6. Check the payment in the activity history and follow its transaction link to the testnet explorer.
7. To try research, set up an agent permission from the employee dashboard, choose the purchasing research agent, and prepare a task. Review and confirm the brief. The result should appear as a report with source links.
8. Revoke the employee permission from the owner dashboard. The employee and its child agent permission can no longer authorize new payments.

Research needs a configured worker. It uses NEAR AI Cloud for inference and web search. Marketplace discovery reads listings from NEAR AI Market, but execution currently uses Allocard's dedicated research worker. It does not charge the company treasury or make a marketplace payment. The worker researches software; it does not buy subscriptions or make purchases.

## Why NEAR

The spending rules live in Rust contracts on NEAR. The contract checks the caller and every permission in the delegation chain before sending funds. It tracks pending transfers separately from settled payments and handles repeated requests without making the same payment twice.

New companies use a shared treasury contract. Each company has its own owner, balances, permissions, and execution records within that contract. A treasury reference combines the contract account and company ID as `contract.testnet#company_id`.

The repository also contains a standalone treasury contract and a factory for creating separate treasury accounts. The current company activation flow uses the shared contract.

## Check the implementation

These links point to the code behind the main features. The tests show the cases covered; run the checks below to verify them on your checkout.

| What to check | Implementation | Tests |
| --- | --- | --- |
| Embedded NEAR wallet creation and signing | [Sign-in and wallet creation](apps/web/components/AuthProvider.tsx#L33), [NEAR signing transport](apps/web/lib/privy-near.ts#L22) | [Privy signing](apps/web/__tests__/privy-near-signing.test.ts) |
| User-signed actions with relayer-paid gas | [Meta-transaction encoding](apps/web/lib/near-sponsored-action.ts#L34), [client signing](apps/web/lib/near-sponsor-client.ts#L26), [server verification and relay](apps/web/lib/near-sponsor-server.ts#L217) | [Gas sponsorship](apps/web/__tests__/near-sponsor.test.ts), [SDK meta-transactions](packages/delegation-sdk/tests/meta-transaction.test.ts) |
| Plain-language policies become structured limits | [Policy parser](apps/web/lib/policy-engine.ts#L275), [policy actions](apps/web/app/actions/policy.ts) | [Policy configuration](apps/web/__tests__/policy-configuration.test.ts) |
| Limits are checked across the permission chain | [Policy evaluation](packages/contracts/treasury/src/policy.rs#L265), [payment execution and revocation](packages/contracts/treasury/src/lib.rs#L721) | [Contract sandbox tests](packages/contracts/treasury/tests/sandbox_test.rs) |
| Allowances reserve funds without transferring them | [Budget allocations](packages/contracts/treasury/src/allocations.rs#L26) | [Allocation tests in the same file](packages/contracts/treasury/src/allocations.rs#L26) |
| Companies have separate balances and permissions | [Shared treasury](packages/contracts/shared/src/lib.rs) | [Shared contract sandbox tests](packages/contracts/shared/tests/shared_sandbox.rs) |
| Marketplace discovery and the supported research worker | [Marketplace search](apps/web/lib/agent-adapter/catalog.ts#L13), [permission checks](apps/web/lib/agent-adapter/permissions.ts#L9), [research worker](packages/research-worker/api/index.ts) | [Worker tests](packages/research-worker/tests/worker.test.mjs) |
| Aurora Intents is a funding widget with a testnet limitation | [Widget configuration](apps/web/components/aurora-intent-widget.tsx#L23), [funding dialog](apps/web/components/top-up-treasury-dialog.tsx) | — |

## Run locally

Use Node.js 22.18 or later and the pnpm version listed in `package.json`. You also need a Neon Postgres database and a Privy application with email or Google login and NEAR wallet support. Add `http://localhost:3000` to your Privy app's allowed origins.

Company activation also needs a deployed shared treasury contract matching this checkout. Use schema version 5 for new companies. The app verifies the deployed code against the local Wasm artifact and checks that the contract has no access keys.

Install dependencies from the repository root:

```sh
pnpm install
```

Create `apps/web/.env.local` with your configuration:

```dotenv
DATABASE_URL=postgresql://...
NEXT_PUBLIC_PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
SESSION_SECRET=...
SHARED_TREASURY_ACCOUNT_ID=your-shared-treasury.testnet
NEXT_PUBLIC_NEAR_RPC_URL=https://rpc.testnet.near.org
NEAR_RPC_URL=https://rpc.testnet.near.org
```

Use a random value of at least 32 characters for `SESSION_SECRET`. Keep credentials in the environment file, which is ignored by Git.

To use test USDC and the funded demo flow, also set:

```dotenv
NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID=your-mock-usdc.testnet
NEAR_RELAYER_ACCOUNT_ID=your-relayer.testnet
NEAR_RELAYER_PRIVATE_KEY=ed25519:...
NEAR_SPONSOR_ENABLED=true
NEAR_SPONSOR_COMPANY_ENABLED=true
```

The mock USDC contract must use the relayer as its minter. The relayer needs test NEAR to fund accounts and pay for sponsored actions. Without sponsorship, signing accounts need their own test NEAR for transactions. Without the mock token setting, the app uses native test NEAR.

Apply the database migrations, check the schema, and start the app:

```sh
pnpm --filter @allocard/web db:migrate
pnpm --filter @allocard/web db:check
pnpm dev
```

Open [localhost:3000](http://localhost:3000).

For AI policy parsing, set `NEAR_AI_API_KEY`. You can override the provider URL and model with `NEAR_AI_BASE_URL` and `NEAR_AI_MODEL`. The parser also supports a DashScope provider and a rules-based fallback.

### Research setup

The research worker is a separate Vercel application in `packages/research-worker`. It must be able to call the web app over HTTPS.

Set these values on the web app:

| Variable | Purpose |
| --- | --- |
| `NEAR_ADAPTER_ACCOUNT_ID` | NEAR account used as the research adapter's delegate. |
| `ALLOCARD_AGENT_URL` | HTTPS origin of the deployed research worker. |
| `ALLOCARD_AGENT_SECRET` | Shared secret of at least 32 characters. |

Register the adapter in the app database with:

```sh
pnpm --filter @allocard/web adapter:configure --register
```

The setup script creates missing adapter configuration in `apps/web/.env.local`. Use the resulting account and secret when configuring the deployments.

Set these values on the worker:

| Variable | Purpose |
| --- | --- |
| `ALLOCARD_APP_URL` | HTTPS origin of the web app. |
| `ALLOCARD_AGENT_SECRET` | The same secret used by the web app. |
| `NEAR_AI_API_KEY` | NEAR AI Cloud key for inference and search. |
| `NEARAI_MODEL` | Optional model override. |

The worker checks provider pricing before accepting a task. Research also has daily usage and concurrency limits. A local web app needs an HTTPS address reachable by the worker to complete this flow.

## Contracts and checks

To build the contracts, install Rust through rustup and the `wasm32-unknown-unknown` target:

```sh
rustup target add wasm32-unknown-unknown
pnpm contracts:build
```

The build writes the treasury, factory, and shared contract artifacts to `packages/contracts/res`.

Deployment scripts are available through `pnpm shared:deploy`, `pnpm mock-usdc:deploy`, and `pnpm factory:deploy`. Running the shared or mock USDC script without `--execute` prints a plan. These scripts read configuration from the terminal environment. Shared deployment removes the account's access keys, fixing that release in place.

Run the SDK and web tests:

```sh
pnpm test
```

Run the contract tests, including sandbox tests:

```sh
pnpm contracts:test
```

Run the full contract, SDK, web, type, and production build checks:

```sh
pnpm delegation:check
```

The research worker has a separate test command:

```sh
node --test packages/research-worker/tests/worker.test.mjs
```

## Repository

| Path | Contents |
| --- | --- |
| `apps/web` | Next.js app, authentication, dashboards, database schema, and API routes. |
| `packages/contracts/treasury` | Spending permissions, allocations, and transfer execution. |
| `packages/contracts/shared` | Company-scoped treasuries on one contract account. |
| `packages/contracts/factory` | Creation of separate company treasury accounts. |
| `packages/contracts/mock-usdc` | Test token used by the demo. |
| `packages/delegation-sdk` | TypeScript client, request encoding, and amount helpers. |
| `packages/research-worker` | Purchasing research using NEAR AI Cloud and web search. |
| `packages/scripts` | Contract builds, tests, deployment helpers, and CLI demo. |

## Hackathon

Allocard is being built for [NEAR HACKATHON](https://nearhackathon.com/). Its main fit is AI Security & Defense and Autonomous Business: a company sets constraints, employees allocate budgets, and agents receive limited authority.

The repository history starts on November 1, 2026. The implementation uses Next.js, React, Privy, NEAR SDKs, Neon, Drizzle, and Aurora's Intents widget. See the package manifests for dependencies and versions.

## License

[MIT](LICENSE).
