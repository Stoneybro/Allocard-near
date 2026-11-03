# Company → employee → payment acceptance run

This build wires Privy email/Google login to native NEAR signing. Stablecoin UI and agent execution are separate integrations. No path should report simulated success. Server sessions verify Privy access tokens and linked NEAR wallets; invitations use the verified email address.

## Preparation

The existing local configuration has database and session-secret variable names present. Confirm that the database is reachable from your development environment and `SESSION_SECRET` is at least 32 random characters. Never send wallet private keys to the agent, browser application server, or repository.

In the Privy dashboard, enable Email and Google and allow your app origin. Configure NEXT_PUBLIC_PRIVY_APP_ID, PRIVY_APP_ID, and server-only PRIVY_APP_SECRET for the same app. The installed Privy SDK creates a native NEAR wallet through its extended-chain API.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run contracts:build
pnpm run sdk:build
pnpm --filter @allocard/web run db:migrate
pnpm run dev
```

The new migration adds unique treasury/execution identities for payment history , a single-use login nonce table, and a separate NEAR account binding for existing users. Run it before signing in with the updated app. It preserves historical rows. It does not turn old database-only delegations into valid NEAR permissions.

The treasury Wasm must be available to the web server at `packages/contracts/res/allocard_treasury.wasm`. A deployed host can override its location with server-only `TREASURY_WASM_PATH`. The server checks a linked treasury's code hash against this artifact, in addition to schema, owner, and network domain.

Use two email accounts in separate browser profiles. After login, fund the displayed employer NEAR account with roughly 15 test NEAR and the employee account with about 0.1 test NEAR for gas. An existing recipient account is also needed; the employer account can be the recipient. Privy signing and dashboard settings still require a live browser test.

## Acceptance steps

1. Employer signs in with Email or Google. The app creates a native NEAR wallet and verifies its link to the Privy identity on the server.
2. Create the company workspace.
3. In treasury setup, create a company treasury. For Privy, approve two transactions: register a named testnet account with 10 NEAR using the user’s public key, then deploy/init the treasury and atomically delete that temporary key. The owner remains the employer’s original NEAR account. This creates a fixed-version testnet contract with no retained deployment key or upgrade method. Read that restriction before signing. Alternatively, verify/connect an existing compatible treasury owned by the employer. Existing named wallet accounts can use the direct subaccount shortcut.
4. Fund the pools. One atomic transaction adds 0.5 NEAR to storage funding, 0.2 NEAR to operations, and 1 NEAR of spendable capital. The dashboard should show 1 NEAR available, not the account balance including storage collateral.
5. Invite the employee’s verified email address. The employee signs in in the other browser profile, sees the pending workspace, and accepts. The signing account itself is the employee principal; it is not another treasury.
6. Employer creates a delegation to that employee. Set a 0.5-NEAR lifetime limit, optionally a 0.2-NEAR per-payment limit, and an explicit recipient account. Activate it with a real signed `create_root_permission` call. A failed/cancelled call must leave it inactive.
7. Employee pays 0.1 NEAR to the approved recipient. Preview must pass, the wallet must sign `execute`, the contract must settle `Succeeded`, and only then can the server record the payment. Confirm the recipient's balance increase and the actual transaction in the explorer.
8. Refresh both views. Employee lifetime capacity should have decreased by 0.1 NEAR, and spendable treasury liquidity should be 0.9 NEAR. Pending transfers count against capacity.
9. Attempt an over-limit payment and a payment to a disallowed recipient. Both must fail without moving funds or creating successful history rows.
10. Revoke the permission from the employer view. The contract must confirm revocation before the application marks it revoked. The employee's next payment must fail.

## Recovery checks

- Cancel a wallet request: the app must not activate authority or record payment success.
- Lose connectivity after signing: keep the saved payment request. Retrying uses the same request ID, so the contract cannot send twice. The form restores the original recipient and amount after refresh.
- If a payment settled but history saving failed, retry the same request to synchronize history. The database's unique treasury/execution identity prevents duplicate records.
- An expired request can be discarded only after a finalized chain clock has passed its deadline and no execution exists. A pending execution remains reserved; no timeout fabricates a refund.
- Do not clear browser storage or switch treasuries while reconciling a payment.

## What still requires external verification

Local automated checks validate signatures, unsigned-login rejection, nonce reuse rejection, exact payment binding, idempotent history recording, budgets, and SDK/contract behavior. A live browser/wallet/RPC/database run has not been established by those tests. The sandbox and Next.js build may be blocked in the coding environment by local socket restrictions. Run the checks and the acceptance sequence in a normal development environment before calling the main flow complete.

No deployment, transaction signing, or remote database migration is performed merely by preparing this code. Those actions happen when you run the migration and confirm the wallet transactions.
