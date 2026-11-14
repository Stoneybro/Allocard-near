# Allocard web application

Next.js application for company onboarding, employee/agent permissions, sponsored NEAR Testnet payments, and purchasing research.

Use the [root README](../../README.md#run-locally) and [.env.example](.env.example) for installation, environment variables, migrations, and startup. The current demo uses a schema-5 shared treasury and mock USDC; native-token and factory paths are not prerequisites for that walkthrough.

Additional setup:

- [Shared treasury and mock token](../../docs/delegation/SHARED.md)
- [Relayer and gas sponsorship](../../docs/delegation/SPONSORSHIP.md)
- [Research worker and adapter](../../docs/AGENT-ADAPTER-OPERATIONS.md)
- [Client behaviour](../../docs/CLIENT-AUDIT.md)
- [Walkthrough acceptance checks](../../docs/delegation/TODAY.md)

From the repository root:

```sh
pnpm web:test
pnpm --filter @allocard/web run typecheck
pnpm web:build
```

See the [verification guide](../../docs/VERIFICATION.md) for claim-to-code evidence and the end-to-end walkthrough.
