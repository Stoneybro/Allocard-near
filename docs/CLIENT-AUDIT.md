# Client audit and demo operations

## Implemented

Privy email/Google is the sole login path. The landing button opens its modal and routes using the verified workspace. Embedded NEAR wallets are created/reused after login; external Meteor/MyNearWallet connectors and wallet-proof login are removed. Existing external NEAR wallets are not a login option in this app.

Session verification uses a shared Privy client and signing-key cache, bounded requests, and distinct invalid-token/configuration/upstream errors. Background renewal preserves the displayed wallet. Onboarding has bounded reads and explicit retry states. Account changes clear private queries.

Opaque HttpOnly cookies now reference hashed server-side session records, with a 24-hour absolute and 30-minute idle lifetime. Logout revokes all app sessions for the same Privy session, including concurrent renewals. Previous JWT cookies require login again. Server guards verify both Privy identity and wallet.

## TanStack Query coverage

Account-scoped keys include network, Privy identity, wallet and company where relevant. Coverage includes profiles, workspaces, onboarding, both dashboard snapshots, employees and permissions, treasury/configuration, agent signer lookups, paginated activity, receipt extraction/verification and reimbursement submission/status. Confirmed transactions and database mutations invalidate related account reads. Dashboard polling refreshes changes made in other browsers. Payment mutations never automatically retry; status polling only reads/reconciles existing requests.

Form drafts and drawer visibility remain local React state. The cache is not payment idempotency or authorization.

## Employee demo workflow

The employer enters an employee email and shares the Allocard link manually. No Resend, email provider, or delivery service is needed. The employee logs in with that same verified email, accepts the workspace invitation and receives/reuses a Privy NEAR wallet. The server binds membership to verified identity and wallet; employers do not invent employee wallet addresses. No emails are automatically sent.

## Native payments and retired features

Application amounts use NEAR names and 24-decimal integer arithmetic. NEAR validation rejects EVM addresses. Historical SQL column names remain for compatibility; old monetary rows are marked `legacy:unknown`, rather than assumed to represent NEAR.

Reimbursements use a configured NEAR signer and an explicitly authorized company budget. Receipt quotes are signed, bound to user and receipt, and expire after five minutes. USD receipts use a current NEAR/USD price; NEAR receipts preserve native precision. Unsupported currencies and unavailable prices fail closed. AI rejection is never changed into approval based on wording.

A durable payout record stores signed bytes before broadcasting. Retries reuse those exact bytes. Pending transactions are reconciled against chain execution before displaying success, with recipient, amount, actor and permission checked. Ambiguous results remain pending and must not be replaced by another payment.

Travel/procurement/DevOps fulfillment, Agora remittances and the old faucet return HTTP 410. Their legacy EVM execution, generated credentials, unused drawers/catalogs, fake merchant account aliases and old demo page were removed. Real vendor or FX integrations are required before reintroducing those features. Direct MetaMask/Pimlico/viem dependencies were removed; Privy may retain transitive EVM packages.

## Deployment and demo setup

1. Configure matching `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_ID`, plus server-only `PRIVY_APP_SECRET`. Configure email/Google login in Privy. An optional `PRIVY_JWT_VERIFICATION_KEY` avoids JWKS network retrieval, but must follow key rotation.
2. From the repository root, inspect pending migrations with `pnpm --filter @allocard/web exec node scripts/migrate_db.mjs --plan`. Apply reviewed migrations with `pnpm --filter @allocard/web db:migrate`, then run `pnpm --filter @allocard/web db:check`. Migration 0011 adds session/payout tables and provenance columns without deleting historical rows. Never reset a deployed database to resolve a journal conflict.
3. Reimbursements require `NEAR_REIMBURSEMENT_ACCOUNT_ID` and server-only `NEAR_REIMBURSEMENT_PRIVATE_KEY` (Ed25519), a funded registered testnet signing account, and the existing testnet RPC/treasury setup. Run `pnpm --filter @allocard/web reimbursement:configure` to validate the public key and register the supported agent. The employer must then authorize its budget on chain. Missing configuration disables claims.
4. Set the existing session-secret environment configuration for receipt quote signing. Receipt AI configuration and outbound price API access are required. Never expose signing keys in public variables.
5. Restart/rebuild after configuration changes. Existing JWT sessions require login again. Run tests, typecheck and a production build before deployment.

Tests cover session revocation, receipt binding/conversion, native payout signing and exact-byte retries, authorization, onboarding and dashboard queries. Mocked payment tests do not establish that a funded live payout or real Privy OAuth flow has succeeded. A submitted transaction without a settled execution remains pending; operators must reconcile it rather than issue a replacement payment.
