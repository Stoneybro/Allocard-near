# Allocard Delegation Foundation

This directory contains technical notes, trust models, and architectural guides for the Allocard Delegation Foundation on native NEAR.

## Workspace Layout

- `packages/contracts`: Native NEAR contracts written in Rust (active `allocard-shared`, reusable `allocard-treasury` engine, and optional global factory).
- `packages/delegation-sdk`: TypeScript client SDK providing Borsh hashing, DTOs, and typed methods over `near-api-js`.
- `packages/scripts`: Contract build, test, deploy, and verification scripts.
- `apps/web`: Next.js web application for treasury management and spending.


## Current implementation status

See [SHARED.md](./SHARED.md) for the active schema-3 multi-company implementation and rollout. The root README also covers legacy schema-2 deployment requirements, separate resource pools, SDK JSON formats, and validation commands. The separate delegation-demo page is a simulation; the main company/employee app now uses wallet signatures and confirmed contract reads. See TODAY.md for the live acceptance run. The contract/SDK fixes do not establish completion of all foundation acceptance categories; maximum-bound sandbox measurements and relayer/FT adversarial coverage remain outstanding.

Employee gas sponsorship is documented in [SPONSORSHIP.md](./SPONSORSHIP.md): NEP-366 signing, eligible Privy employee activation, bounded relayer configuration, database migration and transaction recovery.
