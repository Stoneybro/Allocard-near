# Activation latency follow-up

Production traces on November 12, 2026 showed roughly 3.1 seconds per RPC read. In one activation, reserve funding took 6.7 seconds and the USDC transaction took 7.9 seconds. The surrounding request sequence suggested about 40 seconds in the treasury/demo-funding stage. The transaction timing excludes preflight and database work.

The follow-up web release adds these changes without changing contract code:

- New Privy company registrations explicitly sign `fundReserves: true`. Their existing company creation / token setup transaction also includes the bounded 0.2 NEAR storage top-up and 0.02 NEAR operating top-up. The gas sponsor pays these deposits; they are separate from employee spending funds.
- The activation action passes its freshly owner-verified config into funding. If both reserve pools are already sufficient, funding skips the separate reserve transaction. Old clients, incomplete registrations and insufficient pools retain the existing journaled fallback. A client cannot supply this trusted config to the server action.
- Ownership config, code and access-key reads run together. Gas price, relayer balance and relayer nonce checks run together under the existing key lease. Funding network, minter, ledger and token-storage checks run together.
- Successful verification of an exact keyless shared contract is reused per server process and release hash. Mutable tenant ownership, balances, permissions and nonces are never cached by this optimization. Failed verification is discarded.
- Recovery looks for the original funding job before performing fresh token preflights. Company intent hashes remain compatible with earlier registration jobs; the signed action includes the new reserve choice. Old owner proofs remain valid for their original bounded action list.

Durable signed-transaction storage, signature validation, key leases, nonce allocation, relayer balance checks and exact USDC credit verification remain required. USDC funding still waits for final settlement. Logs now include `[activation timing]` for funding preflight, funding completion and the full company activation action. Compare those measurements after a fresh signed-in activation; removing work does not establish a guaranteed wall-clock duration.

## Release verification

Deployed to `https://www.allocard.xyz` on November 12, 2026 as Vercel deployment `dpl_5UMYJ6AJrr3xsmmWTr11TzPFDu8b` (`READY`). The release was assembled from the reviewed `b9c7ed4` baseline plus the activation changes so concurrent policy-editor work was preserved in the workspace.

All 432 web tests, type checking and targeted lint passed. The updated Mock USDC NEAR sandbox test passed with creation, token setup and both reserve top-ups in one batch, followed by funding and spending. Vercel compilation, type checking and page generation passed. Read-only production checks confirmed the homepage, sign-in redirects and schema-5 treasury endpoint. A repeated immutable-configuration request took 622 ms after an initial 4,128 ms read in this smoke check; this is not an end-to-end activation measurement. A signed-in activation still needs fresh timing logs. Reload an existing browser tab before testing so it uses the new owner-signed batch.
