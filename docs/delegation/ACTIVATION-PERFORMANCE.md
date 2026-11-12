# Activation latency follow-up

Production traces on November 12, 2026 showed roughly 3.1 seconds per RPC read. In one activation, reserve funding took 6.7 seconds and the USDC transaction took 7.9 seconds. The surrounding request sequence suggested about 40 seconds in the treasury/demo-funding stage. The transaction timing excludes preflight and database work.

The follow-up web release adds these changes without changing contract code:

- New Privy company registrations explicitly sign `fundReserves: true`. Their existing company creation / token setup transaction also includes the bounded 0.2 NEAR storage top-up and 0.02 NEAR operating top-up. The gas sponsor pays these deposits; they are separate from employee spending funds.
- The activation action passes its freshly owner-verified config into funding. If both reserve pools are already sufficient, funding skips the separate reserve transaction. Old clients, incomplete registrations and insufficient pools retain the existing journaled fallback. A client cannot supply this trusted config to the server action.
- Ownership config, code and access-key reads run together. Gas price, relayer balance and relayer nonce checks run together under the existing key lease. Funding network, minter, ledger and token-storage checks run together.
- Successful verification of an exact keyless shared contract is reused per server process and release hash. Mutable tenant ownership, balances, permissions and nonces are never cached by this optimization. Failed verification is discarded.
- Recovery looks for the original funding job before performing fresh token preflights. Company intent hashes remain compatible with earlier registration jobs; the signed action includes the new reserve choice. Old owner proofs remain valid for their original bounded action list.

Durable signed-transaction storage, signature validation, key leases, nonce allocation, relayer balance checks and exact USDC credit verification remain required. USDC funding still waits for final settlement. Logs now include `[activation timing]` for funding preflight, funding completion and the full company activation action. Compare those measurements after a fresh signed-in activation; removing work does not establish a guaranteed wall-clock duration.
