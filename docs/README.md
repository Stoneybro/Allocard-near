# Allocard documentation

The [root README](../README.md) describes the product, hosted demo, and local app configuration. The current onboarding flow uses a schema-5 shared treasury on NEAR Testnet and mock USDC.

- [Shared treasury setup](delegation/SHARED.md): contract deployment, company isolation, RPC, and the test token.
- [Allowance accounting](delegation/RESERVATION-RELEASE.md): employee and agent reservations, spending capacity, settlement, and release.
- [Gas sponsorship](delegation/SPONSORSHIP.md): relayer setup, signed actions, and transaction recovery.
- [Walkthrough acceptance checks](delegation/TODAY.md): expected balances, rejection cases, and recovery checks.
- [Verification guide](VERIFICATION.md): claims, implementation and test evidence, commands, and verification status.
- [Research operations](AGENT-ADAPTER-OPERATIONS.md): adapter registration, worker configuration, and task recovery.
- [Client behaviour](CLIENT-AUDIT.md): authentication, refresh behaviour, and payment state.
- [Research worker](../packages/research-worker/README.md): worker runtime and deployment configuration.

Contract source and tests remain in `packages/contracts`; the TypeScript SDK is in `packages/delegation-sdk`. The optional factory and standalone contracts remain for compatibility and tests; they are not the current company onboarding path. Do not remove migrations, legacy verification artifacts, or `delegation/fixtures/execution.json` as documentation cleanup: active code and tests still use them.
