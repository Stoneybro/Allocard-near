# Allocard Web Application (`@allocard/web`)

Next.js 16 application for company treasury onboarding, hierarchical employee/agent spending permissions, NEP-366 gas-sponsored payments, and AI purchasing research workflows on NEAR Testnet.

## Local Setup

1. Install workspace dependencies from the repository root:

   ```sh
   pnpm install --frozen-lockfile
   ```

2. Copy [`apps/web/.env.example`](.env.example) to `apps/web/.env.local` and configure:
   - **Database (Neon Postgres):** `DATABASE_URL`
   - **Session secret (required, >= 32 chars):** `SESSION_SECRET`
   - **Privy auth:** `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, and server-only `PRIVY_APP_SECRET`
   - **NEAR Testnet contracts:** `SHARED_TREASURY_ACCOUNT_ID` (see [`docs/delegation/SHARED.md`](../../docs/delegation/SHARED.md)) and optional `NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID`
   - **Optional NEP-366 gas sponsorship:** `NEAR_SPONSOR_ENABLED`, `NEAR_RELAYER_ACCOUNT_ID`, `NEAR_RELAYER_PRIVATE_KEY` (see [`docs/delegation/SPONSORSHIP.md`](../../docs/delegation/SPONSORSHIP.md))

3. Build the contracts and SDK, apply all Drizzle migrations (`0000`–`0013`), and start the development server from the repository root:

   ```sh
   pnpm run contracts:build
   pnpm run sdk:build
   pnpm --filter @allocard/web run db:migrate
   pnpm --filter @allocard/web run db:check
   pnpm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000). For full live acceptance steps, see [`docs/delegation/TODAY.md`](../../docs/delegation/TODAY.md).

## Verification Commands

Run from the repository root:

```sh
pnpm run web:test
pnpm --filter @allocard/web run typecheck
pnpm run web:build
```

## Authentication Configuration

Set `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_ID` to the same Privy app,
with its server-only `PRIVY_APP_SECRET`. Restart the development server after
changing environment variables; rebuild deployments when changing the public app ID.

Signing keys are cached per server process. The first verification requires
outbound HTTPS access to `https://api.privy.io/v1/apps/<app-id>/jwks.json`.
An optional server-only `PRIVY_JWT_VERIFICATION_KEY` can contain the app's PEM
public verification key from the Privy dashboard (literal `\n` is supported).
This avoids signing-key network retrieval, but you must update the configured
key when signing keys rotate. Never put the app secret in a public variable.

The session endpoint returns `TOKEN_EXPIRED`/`TOKEN_INVALID` with 401,
identity binding errors with 403, `AUTH_CONFIGURATION` with 500, and
`AUTH_UNAVAILABLE` with 503. The browser shares concurrent Privy exchanges,
refreshes an expired token once, and retries temporary authentication outages
at most twice. Logs contain error codes rather than tokens or credentials.

The application uses Privy email/Google authentication exclusively. Employees
are invited by verified email and receive an embedded NEAR wallet when they sign
in. Old wallet-only session cookies require signing in again. No connector
fallback is enabled when Privy configuration is missing.

TanStack Query owns authenticated workspace/dashboard reads and is scoped by
Privy user, NEAR account, network, and company. See
[the client audit](../../docs/CLIENT-AUDIT.md) for cache coverage, migration
steps, manual invitation sharing, and reimbursement configuration.

App cookies are opaque server-side sessions with idle expiry and revocation.
Run `pnpm --filter @allocard/web run db:migrate` to apply all migrations
(through `0013_agent_research_calls.sql`) before starting the server. For the
demo, add employee emails and share the Allocard link manually; no email
provider is required.
