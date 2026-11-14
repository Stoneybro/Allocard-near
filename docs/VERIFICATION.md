# Allocard verification guide

This guide maps Allocard’s features to their implementation, tests, and reproducible checks. Use the [root README](../README.md) to try the app, or [watch the demo](https://youtu.be/-zg-bYNrpVE).

## Claims and evidence

| Claim | Implementation | Test evidence |
| --- | --- | --- |
| Plain-English instructions become structured policy settings; unclear or unsupported requests require clarification. | [Policy engine](../apps/web/lib/policy-engine.ts), [review validation](../apps/web/lib/policy-review.ts), [authorized policy actions](../apps/web/app/actions/policy.ts) | [Policy action tests](../apps/web/__tests__/policy-actions.test.ts), including all six supported controls and omitted restrictions |
| Users review and acknowledge settings before signing. Manual setup is available; a fallback parser result cannot bypass AI review. | [Configuration drawer](../apps/web/components/policy-configuration-drawer.tsx) | [Drawer tests](../apps/web/__tests__/policy-configuration-drawer.test.tsx), including failed AI review and manual acknowledgement |
| Contracts enforce spending rules and reject child permissions that expand an employee's authority. | [Policy evaluation and narrowing](../packages/contracts/treasury/src/policy.rs), [permission creation and execution](../packages/contracts/treasury/src/lib.rs) | Embedded policy tests, including `test_validate_child_expansion_rejected` and `test_evaluate_path_pure_full_flow` |
| Employee allowances reserve company funds. Agent budgets subdivide employee allocations, protecting competing employee and sibling-agent budgets. | [Allocation accounting](../packages/contracts/treasury/src/allocations.rs) | Embedded tests including `other_employee_reservations_protect_root_and_agent_execution`, `siblings_cannot_overallocate_the_parent`, and `descendant_spending_cannot_consume_a_sibling_branch` |
| Revocation and expiry release unused allocations; future spending through a revoked parent is blocked. | [Permission revocation](../packages/contracts/treasury/src/lib.rs), [allocation liveness](../packages/contracts/treasury/src/allocations.rs) | Embedded accounting tests; [employer revocation](../apps/web/__tests__/employer-revocation.test.ts) and [employee revocation](../apps/web/__tests__/employee-revocation.test.ts) tests |
| Displayed spending capacity comes from contract state and reflects limits and allocations. Execution rechecks the live rules. | [Contract snapshots](../packages/contracts/treasury/src/allocations.rs), [capacity reads](../apps/web/lib/live-capacity.ts) | [Live-capacity tests](../apps/web/__tests__/live-capacity.test.ts), [capacity calculations](../apps/web/__tests__/spending-capacity.test.ts); embedded contract allocation tests |
| Privy sign-in creates or reuses an embedded NEAR account, with employee identity verified on the server. | [Auth provider](../apps/web/components/AuthProvider.tsx), [identity verification](../apps/web/lib/privy-server.ts) | [Auth-provider tests](../apps/web/__tests__/auth-provider.test.tsx), [server verification tests](../apps/web/__tests__/privy-server.test.ts) |
| NEP-366 actions preserve the user's signed authority while the relayer pays gas. Funding also pays token setup costs directly. | [Signed actions](../apps/web/lib/near-sponsored-action.ts), [payment and funding relay](../apps/web/lib/near-sponsor-server.ts), [root grants](../apps/web/lib/near-root-sponsor-server.ts), [revocation](../apps/web/lib/near-revoke-sponsor-server.ts) | [Sponsorship tests](../apps/web/__tests__/near-sponsor.test.ts), [root sponsorship](../apps/web/__tests__/root-sponsorship.test.ts), [revocation sponsorship](../apps/web/__tests__/revoke-sponsorship.test.ts) |
| Company owners can inspect delegation hierarchy and research activity associated with an agent permission. | [Delegation view](../apps/web/components/delegation-cards-view.tsx) | [Hierarchy tests](../apps/web/__tests__/delegation-hierarchy.test.tsx), [research activity tests](../apps/web/__tests__/delegation-research-activity.test.tsx), [company research scope](../apps/web/__tests__/company-research-scope.test.ts) |
| Marketplace discovery uses NEAR AI Market; the configured research agent runs only after confirmation and returns sourced research. | [Catalog](../apps/web/lib/agent-adapter/catalog.ts), [hire dialog](../apps/web/components/agent-hire-dialog.tsx), [worker](../packages/research-worker/api/index.ts) | [Catalog tests](../apps/web/__tests__/agent-catalog.test.ts), [confirmation flow](../apps/web/__tests__/employee-agents-workspace.test.tsx), [worker tests](../packages/research-worker/tests/worker.test.mjs) |
| Uncertain payments retain their original identity for reconciliation; retries must not invent another payment. | [Pending-payment recovery](../apps/web/lib/pending-payment.ts), [sponsor journal](../apps/web/lib/near-sponsor-store.ts) | [Payment recovery tests](../apps/web/__tests__/pending-payment.test.ts), [submission tests](../apps/web/__tests__/payment-submission.test.ts), sponsorship tests |
| Company ownership, balances, permissions, and executions are isolated within the shared contract. | [Shared contract](../packages/contracts/shared/src/lib.rs), [company-aware SDK](../packages/delegation-sdk/src/company.ts) | Embedded shared-contract tests; [native company-isolation sandbox test](../packages/contracts/shared/tests/shared_sandbox.rs) and [mock-USDC sandbox test](../packages/contracts/shared/tests/mock_usdc_sandbox.rs) |
| Aurora Intents is integrated for cross-chain funding; it cannot fund this testnet treasury. | [Widget](../apps/web/components/aurora-intent-widget.tsx), [funding dialog](../apps/web/components/top-up-treasury-dialog.tsx) | [Widget tests](../apps/web/__tests__/aurora-intent-widget.test.tsx), [configuration tests](../apps/web/__tests__/aurora-config.test.ts) |

## Run the checks

Run from the repository root after installing workspace dependencies. Use Node.js 24 and the pnpm version in `package.json`. Contract checks require Rust; WASM builds require the `wasm32-unknown-unknown` target.

```sh
# SDK and application tests
pnpm test

# Research-worker tests (not included in pnpm test)
node packages/research-worker/tests/worker.test.mjs

# Contract unit tests
cargo test --manifest-path packages/contracts/Cargo.toml --workspace --lib

# Application type checking
pnpm --filter @allocard/web run typecheck
```

For compiled shared-contract integration tests:

```sh
pnpm contracts:build
cargo test --manifest-path packages/contracts/Cargo.toml \
  -p allocard-shared --test shared_sandbox --test mock_usdc_sandbox
```

Sandbox tests execute compiled contracts on a local NEAR network and require local process/socket access; the sandbox binary may need downloading. Contract unit tests use a simulated runtime; application and worker tests mock external services where appropriate.

## Verify the demo end to end

The builder has verified the complete employer–employee demo end to end. Reproduce it with the [walkthrough acceptance checks](delegation/TODAY.md), using two accessible emails and separate browser sessions:

1. Activate a company treasury and confirm 2,000 test USDC.
2. Grant the default 500-USDC employee allowance; confirm funds stay in the treasury and 1,500 USDC remains unallocated.
3. Settle a 10-USDC payment to a permitted recipient and inspect its transaction receipt.
4. Try an over-limit amount or disallowed recipient and confirm rejection.
5. Activate agent access, run Purchasing Research, and inspect the sourced report and company activity view.
6. Revoke agent or employee access and check the resulting permissions and released allocation.

The linked walkthrough gives exact buttons, expected balances, and recovery checks.

## Demo scope

- The demo uses test USDC on NEAR Testnet. Aurora Intents uses mainnet assets and cannot fund this treasury.
- The marketplace-listed Purchasing Research agent runs through its configured worker without a treasury charge or paid marketplace hire. Its permission is checked, but research does not consume on-chain payment limits. Other listings are browse-only here.
- Spending purpose and receipt instructions are advisory. Supported budgets, recipient restrictions, execution counts, and expiry are contract-enforced. Approval workflows and streaming budgets are not available in the current employee configuration flow.
- Revocation and expiry stop future spending and release unused capacity. Dispatched payments may settle, and running research may finish.

For service prerequisites, see [shared treasury and mock-token setup](delegation/SHARED.md), [gas sponsorship](delegation/SPONSORSHIP.md), and [research operations](AGENT-ADAPTER-OPERATIONS.md).
