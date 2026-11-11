use crate::{errors::*, types::*, TreasuryContract};
use near_sdk::env;
use near_sdk::json_types::{U128, U64};

const MAX_CHILDREN: usize = 16;
const MAX_ROOT_ALLOCATIONS: usize = 64;

impl TreasuryContract {
    pub(crate) fn treasury_reserved(
        &self,
        asset: &AssetId,
        exclude: Option<u64>,
        now: u64,
    ) -> u128 {
        self.root_permissions
            .iter()
            .filter(|id| Some(**id) != exclude)
            .filter_map(|id| self.permissions.get(id))
            .filter(|root| self.allocation_live(root, now))
            .try_fold(0u128, |sum, root| {
                sum.checked_add(self.lifetime_remaining(root, asset))
            })
            .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT))
    }

    pub(crate) fn validate_root_allocation(&self, spec: &PermissionSpec, now: u64) -> Vec<u64> {
        let roots: Vec<_> = self
            .root_permissions
            .iter()
            .copied()
            .filter(|id| {
                self.permissions
                    .get(id)
                    .is_some_and(|root| self.allocation_live(root, now))
            })
            .collect();
        if roots.len() >= MAX_ROOT_ALLOCATIONS {
            env::panic_str("ALLOCARD_ROOT_ALLOCATION_LIMIT");
        }
        for rule in &spec.rules {
            let amount = rule
                .lifetime_limit
                .unwrap_or_else(|| env::panic_str("ALLOCARD_FINITE_ALLOCATION_REQUIRED"))
                .0;
            let ledger = self
                .asset_ledgers
                .get(&rule.asset)
                .filter(|ledger| ledger.enabled)
                .unwrap_or_else(|| env::panic_str(ERR_ASSET_DISABLED));
            if amount
                > ledger
                    .available
                    .0
                    .saturating_sub(self.treasury_reserved(&rule.asset, None, now))
            {
                env::panic_str("ALLOCARD_INSUFFICIENT_UNALLOCATED_FUNDS");
            }
        }
        roots
    }

    // Future-dated grants reserve immediately. Blocking is reversible, so it must
    // never release an allocation that would spring back on unblocking.
    fn allocation_live(&self, child: &Permission, now: u64) -> bool {
        !child.revoked
            && child.epoch == self.config.authority_epoch
            && child.expires_at_ms.is_none_or(|expiry| expiry.0 > now)
    }

    fn lifetime_remaining(&self, permission: &Permission, asset: &AssetId) -> u128 {
        let Some(rule) = permission.rules.iter().find(|rule| &rule.asset == asset) else {
            return 0;
        };
        let Some(limit) = rule.lifetime_limit else {
            return u128::MAX;
        };
        let usage = self.get_usage(permission.id, asset.clone(), BudgetScope::Lifetime);
        limit
            .0
            .saturating_sub(usage.settled.0.saturating_add(usage.pending.0))
    }

    pub(crate) fn reserved_budget(
        &self,
        parent: u64,
        asset: &AssetId,
        exclude: Option<u64>,
        now: u64,
    ) -> u128 {
        self.permission_children
            .get(&parent)
            .into_iter()
            .flatten()
            .filter(|id| Some(**id) != exclude)
            .filter_map(|id| self.permissions.get(id))
            .filter(|child| self.allocation_live(child, now))
            .try_fold(0u128, |sum, child| {
                sum.checked_add(self.lifetime_remaining(child, asset))
            })
            .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT))
    }

    pub(crate) fn validate_child_allocation(
        &self,
        parent: &Permission,
        spec: &PermissionSpec,
        now: u64,
    ) -> Vec<u64> {
        let children: Vec<u64> = self
            .permission_children
            .get(&parent.id.0)
            .into_iter()
            .flatten()
            .filter(|id| {
                self.permissions
                    .get(id)
                    .is_some_and(|child| self.allocation_live(child, now))
            })
            .copied()
            .collect();
        if children.len() >= MAX_CHILDREN {
            env::panic_str("Too many active agent allocations");
        }
        for rule in &spec.rules {
            let amount = rule
                .lifetime_limit
                .unwrap_or_else(|| {
                    env::panic_str("Child allocations require a finite lifetime limit")
                })
                .0;
            let remaining = self.lifetime_remaining(parent, &rule.asset);
            let reserved = self.reserved_budget(parent.id.0, &rule.asset, None, now);
            if amount > remaining.saturating_sub(reserved) {
                env::panic_str("Child allocation exceeds unallocated parent budget");
            }
        }
        children
    }

    pub(crate) fn check_allocated_budget(
        &self,
        path: &[Permission],
        asset: &AssetId,
        amount: u128,
        now: u64,
    ) -> Result<(), &'static str> {
        let available = self
            .asset_ledgers
            .get(asset)
            .map_or(0, |ledger| ledger.available.0);
        let root = path.last().map(|root| root.id.0);
        if amount > available.saturating_sub(self.treasury_reserved(asset, root, now)) {
            return Err(ERR_INSUFFICIENT_AVAILABLE_FUNDS);
        }
        for (index, permission) in path.iter().enumerate() {
            let branch = index.checked_sub(1).map(|index| path[index].id.0);
            let reserved = self.reserved_budget(permission.id.0, asset, branch, now);
            let capacity = self
                .lifetime_remaining(permission, asset)
                .min(available)
                .saturating_sub(reserved);
            if amount > capacity {
                return Err(ERR_LIFETIME_LIMIT);
            }
        }
        Ok(())
    }

    pub(crate) fn spending_snapshot(
        &self,
        permission_id: U64,
        actor: near_sdk::AccountId,
        asset: AssetId,
    ) -> SpendingSnapshot {
        let now = env::block_timestamp_ms();
        let path = self.get_permission_path(permission_id);
        let usage = self.get_usage(permission_id, asset.clone(), BudgetScope::Lifetime);
        let approved = path[0]
            .rules
            .iter()
            .find(|rule| rule.asset == asset)
            .and_then(|rule| rule.lifetime_limit)
            .unwrap_or(U128(0));
        let allocated = self.reserved_budget(permission_id.0, &asset, None, now);
        let mut remaining = self
            .asset_ledgers
            .get(&asset)
            .filter(|ledger| ledger.enabled)
            .map_or(0, |ledger| ledger.available.0)
            .saturating_sub(self.treasury_reserved(&asset, path.last().map(|root| root.id.0), now));
        if self.config.paused || path[0].delegate != actor {
            remaining = 0;
        }
        for (index, permission) in path.iter().enumerate() {
            if !self.allocation_live(permission, now)
                || permission.valid_from_ms.0 > now
                || self.is_principal_blocked(permission.delegate.clone())
                || self.is_principal_blocked(permission.issuer.clone())
                || permission.max_executions.is_some_and(|max| {
                    self.get_permission_usage(permission.id).executions_count >= max
                })
            {
                remaining = 0;
                break;
            }
            let Some(rule) = permission.rules.iter().find(|rule| rule.asset == asset) else {
                remaining = 0;
                break;
            };
            let reserved = self.reserved_budget(
                permission.id.0,
                &asset,
                index.checked_sub(1).map(|i| path[i].id.0),
                now,
            );
            remaining = remaining.min(
                self.lifetime_remaining(permission, &asset)
                    .saturating_sub(reserved),
            );
            if let Some(window) = &rule.fixed_window {
                if now < window.anchor_ms.0 {
                    remaining = 0;
                    break;
                }
                let used = self.get_usage(
                    permission.id,
                    asset.clone(),
                    BudgetScope::FixedWindow((now - window.anchor_ms.0) / window.duration_ms.0),
                );
                remaining = remaining.min(
                    window
                        .limit
                        .0
                        .saturating_sub(used.settled.0.saturating_add(used.pending.0)),
                );
            }
            if let Some(stream) = &rule.streaming {
                let accrued = u128::from(now.saturating_sub(stream.start_ms.0) / 1000)
                    .saturating_mul(stream.rate_per_second.0)
                    .min(stream.max_cap.map_or(u128::MAX, |cap| cap.0));
                let used = self.get_usage(permission.id, asset.clone(), BudgetScope::Streaming);
                remaining = remaining
                    .min(accrued.saturating_sub(used.settled.0.saturating_add(used.pending.0)));
            }
        }
        SpendingSnapshot {
            approved,
            allocated: U128(allocated),
            spent: usage.settled,
            remaining: U128(remaining),
            timestamp_ms: U64(now),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        json_types::{U128, U64},
        test_utils::{accounts, VMContextBuilder},
        testing_env, NearToken,
    };

    fn permission(id: u64, parent: Option<u64>, limit: u128) -> Permission {
        Permission {
            id: U64(id),
            parent_id: parent.map(U64),
            issuer: accounts(if parent.is_some() { 2 } else { 1 }),
            delegate: accounts(if parent.is_some() { 3 } else { 2 }),
            epoch: U64(1),
            depth: u8::from(parent.is_some()),
            valid_from_ms: U64(0),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: None,
                lifetime_limit: Some(U128(limit)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1,
            revoked: false,
            metadata_hash: None,
        }
    }
    fn setup() -> TreasuryContract {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(2))
            .signer_account_id(accounts(2))
            .block_timestamp(1_000_000_000_000)
            .account_balance(NearToken::from_near(100))
            .build());
        let mut contract = TreasuryContract::new(InitConfig {
            owner: accounts(1),
            network_domain: "near:testnet".into(),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: Some(U128(0)),
            callback_gas: None,
            transfer_gas: None,
        });
        contract.config.storage_funding_remaining = U128(10u128.pow(24));
        contract.permissions.insert(1, permission(1, None, 1000));
        contract.permissions.insert(2, permission(2, Some(1), 300));
        contract.permission_children.insert(1, vec![2]);
        contract.root_permissions.push(1);
        contract.asset_ledgers.insert(
            AssetId::NativeNear,
            AssetLedger {
                available: U128(1000),
                pending_outgoing: U128(0),
                enabled: true,
            },
        );
        contract
    }
    fn usage(contract: &mut TreasuryContract, id: u64, settled: u128, pending: u128) {
        contract.usage.insert(
            BudgetKey {
                permission_id: id,
                asset: AssetId::NativeNear,
                scope: BudgetScope::Lifetime,
            },
            Usage {
                settled: U128(settled),
                pending: U128(pending),
            },
        );
    }
    fn request(id: u64, amount: u128) -> ExecuteRequest {
        ExecuteRequest {
            api_version: 1,
            permission_id: U64(id),
            request_id: "ab".repeat(32),
            deadline_ms: U64(1_500_000),
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(amount),
            },
        }
    }
    #[test]
    fn direct_preview_protects_agent_allocation_but_agent_can_use_its_branch() {
        let c = setup();
        assert!(c.preview_execute(accounts(2), request(1, 700)).allowed);
        assert!(!c.preview_execute(accounts(2), request(1, 701)).allowed);
        assert!(c.preview_execute(accounts(3), request(2, 300)).allowed);
    }
    #[test]
    #[should_panic(expected = "ALLOCARD_LIFETIME_LIMIT")]
    fn execute_cannot_bypass_allocation_even_when_ui_is_bypassed() {
        let mut c = setup();
        c.execute(request(1, 701));
    }
    #[test]
    fn pending_success_and_failure_do_not_double_reserve_or_unlock_agent_funds() {
        let mut c = setup();
        for (settled, pending) in [(0, 100), (100, 0), (0, 0)] {
            usage(&mut c, 1, settled, pending);
            usage(&mut c, 2, settled, pending);
            c.asset_ledgers
                .get_mut(&AssetId::NativeNear)
                .unwrap()
                .available = U128(1000 - settled - pending);
            assert_eq!(
                c.get_reserved_budget(U64(1), AssetId::NativeNear, None).0,
                300 - settled - pending
            );
            let root = c.permissions.get(&1).unwrap().clone();
            assert!(c
                .check_allocated_budget(&[root.clone()], &AssetId::NativeNear, 700, 1_000_000)
                .is_ok());
            assert!(c
                .check_allocated_budget(&[root], &AssetId::NativeNear, 701, 1_000_000)
                .is_err());
        }
    }
    #[test]
    fn revoke_and_expiry_release_unused_budget_but_blocking_does_not() {
        let mut c = setup();
        c.blocked_principals.insert(accounts(3), true);
        assert_eq!(
            c.get_reserved_budget(U64(1), AssetId::NativeNear, None).0,
            300
        );
        assert_eq!(
            c.reserved_budget(1, &AssetId::NativeNear, None, 2_000_000),
            0
        );
        c.permissions.get_mut(&2).unwrap().revoked = true;
        assert_eq!(
            c.get_reserved_budget(U64(1), AssetId::NativeNear, None).0,
            0
        );
    }
    #[test]
    fn descendant_spending_cannot_consume_a_sibling_branch() {
        let mut c = setup();
        c.permissions.insert(3, permission(3, Some(1), 700));
        c.permission_children.insert(1, vec![2, 3]);
        let path = vec![
            c.permissions.get(&2).unwrap().clone(),
            c.permissions.get(&1).unwrap().clone(),
        ];
        assert!(c
            .check_allocated_budget(&path, &AssetId::NativeNear, 300, 1_000_000)
            .is_ok());
        assert_eq!(
            c.reserved_budget(1, &AssetId::NativeNear, Some(2), 1_000_000),
            700
        );
    }
    #[test]
    #[should_panic(expected = "Child allocation exceeds unallocated parent budget")]
    fn siblings_cannot_overallocate_the_parent() {
        let c = setup();
        let mut child = permission(3, Some(1), 701);
        c.validate_child_allocation(
            c.permissions.get(&1).unwrap(),
            &PermissionSpec {
                delegate: accounts(4),
                valid_from_ms: child.valid_from_ms,
                expires_at_ms: child.expires_at_ms,
                max_executions: None,
                rules: std::mem::take(&mut child.rules),
                redelegation_depth: 0,
                metadata_hash: None,
            },
            1_000_000,
        );
    }

    fn owner_context() {
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .signer_account_id(accounts(1))
            .block_timestamp(1_000_000_000_000)
            .account_balance(NearToken::from_near(100))
            .prepaid_gas(near_sdk::Gas::from_tgas(300))
            .build());
    }
    fn root_spec(limit: u128) -> PermissionSpec {
        let p = permission(3, None, limit);
        PermissionSpec {
            delegate: accounts(4),
            valid_from_ms: p.valid_from_ms,
            expires_at_ms: p.expires_at_ms,
            max_executions: None,
            rules: p.rules,
            redelegation_depth: 1,
            metadata_hash: None,
        }
    }
    fn withdrawal(amount: u128) -> OwnerWithdrawRequest {
        OwnerWithdrawRequest {
            api_version: 1,
            request_id: "cd".repeat(32),
            authority_epoch: U64(1),
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(amount),
            },
            deadline_ms: U64(1_500_000),
        }
    }

    #[test]
    #[should_panic(expected = "ALLOCARD_INSUFFICIENT_UNALLOCATED_FUNDS")]
    fn new_employee_cannot_overallocate_the_treasury() {
        let mut c = setup();
        owner_context();
        c.create_root_permission(root_spec(1));
    }
    #[test]
    #[should_panic(expected = "ALLOCARD_FINITE_ALLOCATION_REQUIRED")]
    fn employee_allocations_require_a_finite_limit() {
        let mut c = setup();
        owner_context();
        let mut spec = root_spec(1);
        spec.rules[0].lifetime_limit = None;
        spec.rules[0].acknowledge_unbounded_budget = true;
        c.create_root_permission(spec);
    }
    #[test]
    #[should_panic(expected = "ALLOCARD_INSUFFICIENT_UNALLOCATED_FUNDS")]
    fn owner_cannot_withdraw_an_employee_allocation() {
        let mut c = setup();
        owner_context();
        c.owner_withdraw(withdrawal(1));
    }
    #[test]
    fn owner_can_withdraw_only_unallocated_principal() {
        let mut c = setup();
        owner_context();
        c.asset_ledgers
            .get_mut(&AssetId::NativeNear)
            .unwrap()
            .available = U128(1200);
        c.owner_withdraw(withdrawal(200));
        let budget = c.get_treasury_budget(AssetId::NativeNear);
        assert_eq!(
            (
                budget.available.0,
                budget.allocated.0,
                budget.unallocated.0,
                budget.pending_outgoing.0
            ),
            (1000, 1000, 0, 200)
        );
    }
    #[test]
    fn company_budget_counts_roots_once_and_preserves_unallocated_through_settlement() {
        let mut c = setup();
        c.asset_ledgers
            .get_mut(&AssetId::NativeNear)
            .unwrap()
            .available = U128(1500);
        for (settled, pending) in [(0, 100), (100, 0), (0, 0)] {
            usage(&mut c, 1, settled, pending);
            usage(&mut c, 2, settled, pending);
            let ledger = c.asset_ledgers.get_mut(&AssetId::NativeNear).unwrap();
            ledger.available = U128(1500 - settled - pending);
            ledger.pending_outgoing = U128(pending);
            let budget = c.get_treasury_budget(AssetId::NativeNear);
            assert_eq!(budget.allocated.0, 1000 - settled - pending);
            assert_eq!(budget.unallocated.0, 500);
            assert_eq!(
                c.get_spending_snapshot(U64(1), accounts(2), AssetId::NativeNear)
                    .remaining
                    .0,
                700
            );
        }
    }
    #[test]
    fn expiry_revocation_and_epoch_release_roots_but_pause_and_block_do_not() {
        let mut c = setup();
        c.config.paused = true;
        c.blocked_principals.insert(accounts(2), true);
        assert_eq!(c.get_treasury_budget(AssetId::NativeNear).allocated.0, 1000);
        assert_eq!(
            c.get_spending_snapshot(U64(1), accounts(2), AssetId::NativeNear)
                .remaining
                .0,
            0
        );
        c.config.paused = false;
        c.blocked_principals.insert(accounts(2), false);
        c.permissions.get_mut(&1).unwrap().valid_from_ms = U64(1_100_000);
        assert_eq!(c.get_treasury_budget(AssetId::NativeNear).allocated.0, 1000); // Future grants reserve now.
        assert_eq!(
            c.get_spending_snapshot(U64(1), accounts(2), AssetId::NativeNear)
                .remaining
                .0,
            0
        );
        c.permissions.get_mut(&1).unwrap().expires_at_ms = Some(U64(1_000_000));
        assert_eq!(c.get_treasury_budget(AssetId::NativeNear).allocated.0, 0);
        c.permissions.get_mut(&1).unwrap().expires_at_ms = None;
        c.permissions.get_mut(&1).unwrap().revoked = true;
        assert_eq!(c.get_treasury_budget(AssetId::NativeNear).allocated.0, 0);
        c.permissions.get_mut(&1).unwrap().revoked = false;
        c.config.authority_epoch = U64(2);
        assert_eq!(c.get_treasury_budget(AssetId::NativeNear).allocated.0, 0);
    }
    #[test]
    fn other_employee_reservations_protect_root_and_agent_execution() {
        let mut c = setup();
        c.permissions.get_mut(&1).unwrap().rules[0].lifetime_limit = Some(U128(600));
        c.permissions.insert(3, permission(3, None, 400));
        c.root_permissions.push(3);
        assert_eq!(c.get_treasury_budget(AssetId::NativeNear).unallocated.0, 0);
        assert_eq!(
            c.get_spending_snapshot(U64(1), accounts(2), AssetId::NativeNear)
                .remaining
                .0,
            300
        );
        assert_eq!(
            c.get_spending_snapshot(U64(2), accounts(3), AssetId::NativeNear)
                .remaining
                .0,
            300
        );
        assert!(c
            .check_allocated_budget(
                &c.get_permission_path(U64(1)),
                &AssetId::NativeNear,
                601,
                1_000_000
            )
            .is_err());
    }
    fn callback_case(failed: bool) {
        let mut c = setup();
        c.asset_ledgers
            .get_mut(&AssetId::NativeNear)
            .unwrap()
            .available = U128(1500);
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .signer_account_id(accounts(3))
            .block_timestamp(1_000_000_000_000)
            .account_balance(NearToken::from_near(100))
            .prepaid_gas(near_sdk::Gas::from_tgas(300));
        testing_env!(context.build());
        let id = c.execute(request(2, 100));
        let pending = c.get_treasury_budget(AssetId::NativeNear);
        assert_eq!(
            (
                pending.available.0,
                pending.allocated.0,
                pending.unallocated.0,
                pending.pending_outgoing.0
            ),
            (1400, 900, 500, 100)
        );
        context.predecessor_account_id(accounts(0));
        near_sdk::test_utils::testing_env_with_promise_results(
            context.build(),
            near_sdk::PromiseResult::Successful(vec![0; 4097]),
        );
        c.on_transfer_result(id);
        assert_eq!(
            c.get_treasury_budget(AssetId::NativeNear).unallocated.0,
            500
        );
        near_sdk::test_utils::testing_env_with_promise_results(
            context.build(),
            if failed {
                near_sdk::PromiseResult::Failed
            } else {
                near_sdk::PromiseResult::Successful(vec![])
            },
        );
        c.on_transfer_result(id);
        c.on_transfer_result(id); // Repeated callbacks cannot double-release.
        let settled = c.get_treasury_budget(AssetId::NativeNear);
        assert_eq!(settled.unallocated.0, 500);
        assert_eq!(settled.pending_outgoing.0, 0);
        assert_eq!(settled.allocated.0, if failed { 1000 } else { 900 });
    }
    #[test]
    fn successful_callback_consumes_reserved_employee_funds_once() {
        callback_case(false);
    }
    #[test]
    fn failed_callback_restores_reserved_employee_funds_once() {
        callback_case(true);
    }
}
