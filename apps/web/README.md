This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Authentication configuration

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

The application now uses Privy exclusively. Employees are invited by verified
email and receive an embedded NEAR wallet when they sign in. Old wallet-only
session cookies require signing in again. No connector fallback is enabled when
Privy configuration is missing.

TanStack Query owns authenticated workspace/dashboard reads and is scoped by
Privy user, NEAR account, network and company. See
[the client audit](../../docs/CLIENT-AUDIT.md) for cache coverage, migration steps, manual invitation sharing and NEAR reimbursement configuration.

App cookies are opaque server-side sessions with idle expiry and revocation. Apply migration 0011 before starting this version. For the demo, add employee emails and share the Allocard link manually; no email provider is required.
