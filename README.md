# Allocard

**Non-custodial corporate spending and hierarchical AI agent delegation on NEAR.**

Allocard lets organizations keep treasury funds in one onchain balance while issuing bounded spending permissions to employees and autonomous AI agents—without pre-funding employee wallets, sharing company keys, or surrendering custody.

---

## The Problem & How Allocard Works

1. **The Problem:** Distributing crypto to employee or agent wallets fragments capital, surrenders custody before money is spent, and creates manual reconciliation. Requiring an owner signature for every routine vendor payment creates operational bottlenecks.
2. **Allocard's Solution:** Capital stays pooled under company ownership. Owners issue immutable onchain spending rules (per-transaction caps, lifetime limits, fixed recurring windows, streaming allowances, recipient allowlists, expiry timestamps, and optional approvers). Employees can spend directly within those limits or re-delegate strictly narrower sub-permissions to AI agents.
3. **Why NEAR:**
   - **Atomic Onchain Policy & Ledger (`packages/contracts/shared`, `treasury`):** Authority validation, parent-child narrowing, budget reservations, and transfer dispatch execute inside one contract.
   - **Gasless User Experience (`NEP-366` Meta-Transactions):** Employees sign Ed25519 delegate actions while an optional server relayer pays gas; the contract still authenticates the true actor via `predecessor_account_id` ([`docs/delegation/SPONSORSHIP.md`](docs/delegation/SPONSORSHIP.md)).
   - **Frictionless Onboarding:** Privy email/Google authentication provisions native NEAR embedded wallets ([`apps/web/lib/privy-near.ts`](apps/web/lib/privy-near.ts)) so employees never install wallet extensions or manage seed phrases.
   - **Stablecoin & Cross-Chain Funding:** Supports both native NEAR and NEP-141 fungible tokens (with an included [`allocard-mock-usdc`](packages/contracts/mock-usdc) testnet contract and Aurora Intent Connect widget for cross-chain deposits).
   - **Bounded AI Agent Access:** Employees can grant narrow child permissions to an isolated research adapter and discover NEAR AI Market workers ([`docs/AGENT-ADAPTER-OPERATIONS.md`](docs/AGENT-ADAPTER-OPERATIONS.md)).

*(Unlike multisig treasuries such as Trezu or NEAR Business where signers vote on individual transactions, Allocard focuses on programmable, hierarchical spending allowances with instant revocation for teams and AI agents.)*

---

## Hackathon Track Alignment

| Track | How Allocard Fits | Key Implementation Paths |
| :--- | :--- | :--- |
| **`realworld` — Real-World Money** | Corporate treasury controls, vendor allowlists, NEP-141/USDC spending support, email onboarding, NEP-366 gasless execution, and cross-chain funding UI. | [`packages/contracts/shared`](packages/contracts/shared), [`packages/contracts/mock-usdc`](packages/contracts/mock-usdc), [`apps/web/lib/near-sponsor-server.ts`](apps/web/lib/near-sponsor-server.ts), [`apps/web/components/aurora-intent-widget.tsx`](apps/web/components/aurora-intent-widget.tsx) |
| **`security` — AI Security & Defense** | Onchain policy engine enforcing strict ancestor narrowing, budget reservations, replay protection via canonical Borsh request hashes, and 1-click cascading revocation. | [`packages/contracts/treasury/src/policy.rs`](packages/contracts/treasury/src/policy.rs), [`packages/contracts/treasury/src/canonical.rs`](packages/contracts/treasury/src/canonical.rs), [`packages/delegation-sdk/src/canonical.ts`](packages/delegation-sdk/src/canonical.ts) |
| **`business` — Autonomous Business** | Company treasury management with natural-language policy synthesis and constrained AI procurement/research workflows where humans set hard onchain bounds. | [`apps/web/lib/policy-engine.ts`](apps/web/lib/policy-engine.ts), [`apps/web/app/employer/EmployerClient.tsx`](apps/web/app/employer/EmployerClient.tsx) |
| **`agents` — Agent Economy** | Employee-to-agent child permission delegation, NEAR AI Market catalog discovery, and quota-guarded agent research execution bound to live onchain permission checks. | [`apps/web/lib/agent-adapter/`](apps/web/lib/agent-adapter), [`apps/web/components/agent-hire-dialog.tsx`](apps/web/components/agent-hire-dialog.tsx) |

---

## Judge Quickstart: Zero-Setup Verification (`Do X → See Y`)

All core contract, SDK, and application tests run locally from the repository root with **no wallet keys, database, or live RPC required**.

### Prerequisites
- Node.js 22+ (with `--experimental-strip-types` support) and `pnpm` (`11.x`)
- Rust toolchain with `wasm32-unknown-unknown` target (for Rust contract builds/tests; pinned in [`packages/contracts/rust-toolchain.toml`](packages/contracts/rust-toolchain.toml))

### 1. Install dependencies & verify TypeScript SDK
* **Do:**
  ```sh
  pnpm install --frozen-lockfile
  pnpm run sdk:build
  pnpm run sdk:test
  ```
* **See:** `@allocard/delegation-sdk` compiles cleanly and passes **9 test files (35 tests)** verifying canonical Borsh envelope hashes against Rust fixtures, `64`-bit integer string serialization, shared-company reference scoping, NEP-461/NEP-366 meta-transaction builders, and deployment verification plans.

### 2. Run the Offline Canonical Envelope CLI Demo
* **Do:**
  ```sh
  pnpm run demo
  ```
* **See:** Prints a complete Root (Finance Manager) → Child (AI Travel Agent) permission hierarchy, generates cryptographic 64-hex request IDs, and outputs canonical Borsh SHA-256 execution and owner-withdrawal hashes matching the Rust contract engine.

### 3. Run the Web Application Test Suite & Typecheck
* **Do:**
  ```sh
  pnpm run web:test
  pnpm --filter @allocard/web run typecheck
  ```
* **See:** Vitest passes **65 test files (401 tests)** covering NEP-366 sponsorship replay/authorization, Privy session validation, policy engine checks, shared treasury scoping, agent adapter guards, and React UI flows, followed by a clean `tsc --noEmit` check.

### 4. Run Rust Smart Contract Unit & Sandbox Integration Tests
* **Do (Unit tests — works in any sandboxed environment):**
  ```sh
  cargo test --manifest-path packages/contracts/Cargo.toml --workspace --lib
  ```
* **See:** **53 unit tests pass** across `allocard-factory` (8), `allocard-shared` (7), and `allocard-treasury` (38), covering multi-company isolation, budget reservations, fixed-window/streaming limits, approvals, ownership handover, and storage accounting.
* **Do (Full Wasm build + `near-sandbox` integration tests — requires local socket permissions):**
  ```sh
  pnpm run contracts:test
  ```
* **See:** Compiles Wasm artifacts for `allocard-treasury`, `allocard-factory`, `allocard-shared`, and `allocard-mock-usdc`, and runs integration tests in [`packages/contracts/shared/tests/`](packages/contracts/shared/tests) (`company_claims_and_spends_mock_usdc`, `shared_company_native_flow_and_isolation`) and [`packages/contracts/treasury/tests/sandbox_test.rs`](packages/contracts/treasury/tests/sandbox_test.rs).

### 5. Full Pipeline Check
* **Do:** `pnpm run delegation:check`
* **See:** Runs `contracts:test`, `sdk:build`, `sdk:test`, `web:test`, `@allocard/web` typecheck, and `web:build` end-to-end.

---

## Live NEAR Testnet Web App Flow (`Do X → See Y`)

To run the Next.js application against NEAR Testnet, Neon Postgres, and Privy, follow [`apps/web/README.md`](apps/web/README.md) and [`docs/delegation/TODAY.md`](docs/delegation/TODAY.md).

1. **Company Onboarding:** Sign in with Email or Google (Privy provisions a native NEAR testnet account). Create a company workspace and click **Register company** → **See:** A single `create_company` call (0.2 NEAR allocation or opt-in gas sponsorship) initializes isolated company state inside the shared treasury contract (`allocard-shared`).
2. **Treasury Funding:** Open **Add funds** (`Faucet` tab for Mock USDC / testnet native pools, or `Aurora Intents` tab on mainnet) → **See:** Available treasury balance updates separately from storage collateral and operating reserves.
3. **Employee Allowance:** Invite a teammate by verified email and set spending limits (lifetime cap, per-transaction cap, recurring window, allowed recipients) → **See:** Employer signs `create_root_permission`; the permission activates onchain.
4. **Employee Payment & Guardrails:** Employee signs in via their invited email, enters an approved recipient and amount within limits, and clicks **Send** → **See:** Preview passes, NEP-366 meta-transaction executes gaslessly, contract settles `Succeeded`, and remaining capacity decreases. Attempting an over-limit amount or unlisted recipient is rejected onchain.
5. **AI Agent Sub-Delegation & Instant Revocation:** Employee delegates a narrower sub-limit to the research agent, runs a task, and clicks **Revoke** (or Employer revokes the parent permission) → **See:** Cascading onchain revocation blocks future agent or employee spending immediately.

*(Note: The `/delegation-demo` route is a standalone offline UI simulation page; `/employer`, `/employee`, and `/onboarding` execute real NEAR Testnet transactions and RPC reads.)*

---

## Repository Layout

| Path | Responsibility |
| :--- | :--- |
| [`packages/contracts/shared`](packages/contracts/shared) | Active **schema-5** shared multi-company treasury contract (`create_company`, isolated company ledgers, permissions, and aggregate physical solvency checks). |
| [`packages/contracts/treasury`](packages/contracts/treasury) | Core reusable delegation policy engine, canonical Borsh envelope hashing, two-phase execution/callback accounting, and **schema-4** standalone single-company treasury. |
| [`packages/contracts/mock-usdc`](packages/contracts/mock-usdc) | NEP-141 testnet Mock USDC fungible token contract with minter/faucet support. |
| [`packages/contracts/factory`](packages/contracts/factory) | Optional NEP-591 global-code factory experiment (not required by active onboarding). |
| [`packages/delegation-sdk`](packages/delegation-sdk) | Wallet-independent TypeScript SDK (`AllocardTreasuryClient`, canonical hashes, exact decimal amount helpers, `near-api-js` binding, and deployment scripts). |
| [`packages/scripts`](packages/scripts) | Contract Wasm build, Rust/sandbox test runner, legacy deploy wrapper, and offline CLI demo. |
| [`apps/web`](apps/web) | Next.js 16 web app (Privy NEAR auth, employer/employee dashboards, NEP-366 sponsorship gateway, Drizzle/Postgres schema, and AI agent adapter). |
| [`docs/`](docs/) | Architecture, deployment, sponsorship, and operations docs ([`SHARED.md`](docs/delegation/SHARED.md), [`SPONSORSHIP.md`](docs/delegation/SPONSORSHIP.md), [`TODAY.md`](docs/delegation/TODAY.md), [`CLIENT-AUDIT.md`](docs/CLIENT-AUDIT.md)). |

---

## Protocol Guarantees & Architecture Notes

The prepared reservation release uses shared schema 5 / standalone schema 4. See [release and migration instructions](docs/delegation/RESERVATION-RELEASE.md). Existing deployments are immutable and must be migrated explicitly; new employee grants require the reservation release.

- **Non-Custodial Isolation:** In [`packages/contracts/shared`](packages/contracts/shared), each company is identified deterministically (`sha256(owner + '\0' + company_key)`), has its own `owner`, `authority_epoch`, `paused` flag, permission IDs, usage buckets, and asset ledgers, and cannot spend another company's reserves. Deployed shared contracts drop all full-access keys atomically during initialization ([`docs/delegation/SHARED.md`](docs/delegation/SHARED.md)).
- **Two-Phase Settlement & Reservations:** Creating a root permission reserves its finite lifetime allocation from unallocated company principal. Child permissions subdivide that allocation. Dispatching a payment (`execute`) reserves every ancestor's budget and debits `available` liquidity before emitting an asynchronous NEAR promise. Only a proven failed callback restores principal and releases the reservation; oversized/unreadable callback payloads flag `needs_reconciliation` rather than guessing.
- **Replay Protection & Canonical Hashing:** `execute` and `owner_withdraw` enforce replay uniqueness on `(actor, request_id)` and verify a versioned Borsh envelope hash scoped to `network_domain` (including `company_id`), `contract_id`, and `actor`.
- **Exact Integer Boundaries:** All amounts at JSON/SDK boundaries are decimal strings in base units (24 decimals for NEAR, 6 for USDC) via `parseTokenAmount` / `formatTokenAmount`; `Number` rounding and scientific notation are rejected.
- **Known Limitations (Testnet / Unaudited):** This codebase is unaudited and built for NEAR Testnet verification. Keyless treasury deployments have no built-in upgrade path; fixed-duration windows are not calendar months; missing callbacks can hold reservations pending reconciliation; and maximum-policy adversarial gas benchmarks remain pre-production work.

---

## Hackathon Disclosures

- **Build Window & Baseline (`Q-002`, `Q-005`):** The entire native NEAR implementation—all four Rust contracts (`shared`, `treasury`, `mock-usdc`, `factory`), `@allocard/delegation-sdk`, deployment/CLI scripts, Privy native NEAR wallet authentication, NEP-366 meta-transaction sponsorship, and the NEAR AI agent adapter—was built fresh for NEAR during the hackathon development window (`Nov 1 – Nov 14, 2026`). The product concept and Next.js UI design extend an earlier pre-hackathon prototype originally explored on EVM/MetaMask; legacy SQL column names (e.g., `smartAccountAddress` in `apps/web/drizzle/`) are preserved only for database migration compatibility.
- **Libraries & Ecosystem Tools:** Built with `near-sdk`, `near-contract-standards`, `near-workspaces`, `near-api-js`, `@privy-io/react-auth`, `@privy-io/node`, `@aurora-is-near/intents-swap-widget`, Next.js, Drizzle ORM, Neon Postgres, TanStack Query, Zod, and shadcn/ui.
- **License (`Q-014`):** Released under the [MIT License](LICENSE).
