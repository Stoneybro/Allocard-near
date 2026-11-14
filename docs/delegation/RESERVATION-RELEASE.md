# Allowance accounting (shared schema 5)

Creating an employee root permission requires a finite lifetime budget and sufficient unallocated company principal. The contract reserves that budget atomically. Funds stay in the treasury until dispatched for payment. Agent permissions reserve subdivisions of the employee's budget, not additional company funds.

## Company balances

`get_treasury_budget(asset)` returns decimal base-unit strings:

- `available`: principal not currently dispatched; includes unused employee allocations.
- `allocated`: unused lifetime budgets of live root permissions, excluding pending and settled usage.
- `unallocated`: available principal minus employee allocations; available for another employee grant or owner withdrawal.
- `pending_outgoing`: dispatched principal awaiting settlement; unavailable to allocate or withdraw.

Example: fund 2,000 USDC, allocate 500 to an employee, and let that employee allocate 100 to an agent. The company still holds 2,000 USDC, with 500 allocated and 1,500 unallocated. A settled 10-USDC payment leaves 1,990 available, 490 allocated, and 1,500 unallocated.

An employee's immediately spendable amount also depends on recurring allowances, per-payment caps, recipient rules, execution counts, expiry, ancestor permissions, blocks, and child reservations. A 500-USDC lifetime allowance does not mean 500 USDC can be spent immediately.

## Isolation and release

- Reserved employee funds cannot be withdrawn by the owner or assigned to another employee.
- Direct employee payments and sibling-agent payments cannot consume another live child allocation.
- Successful payments consume applicable budgets. A definitive failed-transfer callback restores capacity; a missing callback does not fabricate a refund.
- Revocation or expiry releases unused allocations. Exhausted transaction counts, pauses, and reversible principal blocks do not release them.
- Revoking a parent blocks future spending by its descendants. Payments already dispatched may still settle.

There are at most 64 live root allocations per company and 16 live immediate children per permission. Future-dated root grants reserve funds immediately. Expired, revoked, and previous-epoch roots are pruned when another root grant is created.

`get_spending_snapshot` and its bounded batch variant provide advisory capacity at a contract timestamp. The contract independently enforces current rules in `preview_execute` and `execute`; a cached display cannot authorize payment.

## Compatibility and tests

New company registration and employee grants require shared schema 5. The app retains legacy reading/spending paths and matching artifacts for existing shared schemas 3/4 and standalone schemas 2/3. The standalone schema-4 engine also supports funded allocations. See [shared treasury setup](SHARED.md) before deployment or migration.

Core implementation and embedded accounting tests are in `packages/contracts/treasury/src/allocations.rs`; company isolation tests are in `packages/contracts/shared/src/lib.rs`. Run:

```sh
cargo test --manifest-path packages/contracts/Cargo.toml --workspace --lib
```

For compiled-contract integration tests and end-to-end reproduction, see the [verification guide](../VERIFICATION.md) and [walkthrough acceptance checks](TODAY.md).
