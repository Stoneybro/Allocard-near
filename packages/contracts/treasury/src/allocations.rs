use crate::{errors::*, types::*, TreasuryContract};
use near_sdk::env;

const MAX_CHILDREN: usize = 16;

impl TreasuryContract {
    // Future-dated grants reserve immediately. Blocking is reversible, so it must
    // never release an allocation that would spring back on unblocking.
    fn allocation_live(&self, child: &Permission, now: u64) -> bool {
        !child.revoked && child.epoch == self.config.authority_epoch
            && child.expires_at_ms.is_none_or(|expiry| expiry.0 > now)
    }

    fn lifetime_remaining(&self, permission: &Permission, asset: &AssetId) -> u128 {
        let Some(rule) = permission.rules.iter().find(|rule| &rule.asset == asset) else { return 0; };
        let Some(limit) = rule.lifetime_limit else { return u128::MAX; };
        let usage = self.get_usage(permission.id, asset.clone(), BudgetScope::Lifetime);
        limit.0.saturating_sub(usage.settled.0.saturating_add(usage.pending.0))
    }

    pub(crate) fn reserved_budget(&self, parent: u64, asset: &AssetId, exclude: Option<u64>, now: u64) -> u128 {
        self.permission_children.get(&parent).into_iter().flatten()
            .filter(|id| Some(**id) != exclude)
            .filter_map(|id| self.permissions.get(id))
            .filter(|child| self.allocation_live(child, now))
            .try_fold(0u128, |sum, child| sum.checked_add(self.lifetime_remaining(child, asset)))
            .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT))
    }

    pub(crate) fn validate_child_allocation(&self, parent: &Permission, spec: &PermissionSpec, now: u64) -> Vec<u64> {
        let children: Vec<u64> = self.permission_children.get(&parent.id.0).into_iter().flatten()
            .filter(|id| self.permissions.get(id).is_some_and(|child| self.allocation_live(child, now)))
            .copied().collect();
        if children.len() >= MAX_CHILDREN { env::panic_str("Too many active agent allocations"); }
        for rule in &spec.rules {
            let amount = rule.lifetime_limit.unwrap_or_else(|| env::panic_str("Child allocations require a finite lifetime limit")).0;
            let remaining = self.lifetime_remaining(parent, &rule.asset);
            let reserved = self.reserved_budget(parent.id.0, &rule.asset, None, now);
            if amount > remaining.saturating_sub(reserved) { env::panic_str("Child allocation exceeds unallocated parent budget"); }
        }
        children
    }

    pub(crate) fn check_allocated_budget(&self, path: &[Permission], asset: &AssetId, amount: u128, now: u64) -> Result<(), &'static str> {
        let available = self.asset_ledgers.get(asset).map_or(0, |ledger| ledger.available.0);
        for (index, permission) in path.iter().enumerate() {
            let branch = index.checked_sub(1).map(|index| path[index].id.0);
            let reserved = self.reserved_budget(permission.id.0, asset, branch, now);
            let capacity = self.lifetime_remaining(permission, asset).min(available).saturating_sub(reserved);
            if amount > capacity { return Err(ERR_LIFETIME_LIMIT); }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{json_types::{U128, U64}, test_utils::{accounts, VMContextBuilder}, testing_env, NearToken};

    fn permission(id: u64, parent: Option<u64>, limit: u128) -> Permission {
        Permission { id: U64(id), parent_id: parent.map(U64), issuer: accounts(if parent.is_some() {2} else {1}), delegate: accounts(if parent.is_some() {3} else {2}), epoch: U64(1), depth: u8::from(parent.is_some()), valid_from_ms: U64(0), expires_at_ms: Some(U64(2_000_000)), max_executions: None,
            rules: vec![AssetRule { asset: AssetId::NativeNear, recipients: Recipients::Any, min_per_action: None, max_per_action: None, lifetime_limit: Some(U128(limit)), fixed_window: None, streaming: None, approval: None, acknowledge_unbounded_budget: false }], redelegation_depth: 1, revoked: false, metadata_hash: None }
    }
    fn setup() -> TreasuryContract {
        testing_env!(VMContextBuilder::new().current_account_id(accounts(0)).predecessor_account_id(accounts(2)).signer_account_id(accounts(2)).block_timestamp(1_000_000_000_000).account_balance(NearToken::from_near(100)).build());
        let mut contract = TreasuryContract::new(InitConfig { owner: accounts(1), network_domain: "near:testnet".into(), max_total_permissions: None, max_pending_executions: None, min_operating_reserve: Some(U128(0)), callback_gas: None, transfer_gas: None });
        contract.config.storage_funding_remaining = U128(10u128.pow(24));
        contract.permissions.insert(1, permission(1, None, 1000));
        contract.permissions.insert(2, permission(2, Some(1), 300));
        contract.permission_children.insert(1, vec![2]);
        contract.asset_ledgers.insert(AssetId::NativeNear, AssetLedger { available: U128(1000), pending_outgoing: U128(0), enabled: true });
        contract
    }
    fn usage(contract: &mut TreasuryContract, id: u64, settled: u128, pending: u128) {
        contract.usage.insert(BudgetKey { permission_id: id, asset: AssetId::NativeNear, scope: BudgetScope::Lifetime }, Usage { settled: U128(settled), pending: U128(pending) });
    }
    fn request(id: u64, amount: u128) -> ExecuteRequest {
        ExecuteRequest { api_version: 1, permission_id: U64(id), request_id: "ab".repeat(32), deadline_ms: U64(1_500_000), action: Action::Transfer { asset: AssetId::NativeNear, receiver: accounts(4), amount: U128(amount) } }
    }
    #[test]
    fn direct_preview_protects_agent_allocation_but_agent_can_use_its_branch() {
        let c = setup();
        assert!(c.preview_execute(accounts(2), request(1, 700)).allowed);
        assert!(!c.preview_execute(accounts(2), request(1, 701)).allowed);
        assert!(c.preview_execute(accounts(3), request(2, 300)).allowed);
    }
    #[test]
    #[should_panic(expected="ALLOCARD_LIFETIME_LIMIT")]
    fn execute_cannot_bypass_allocation_even_when_ui_is_bypassed() {
        let mut c = setup(); c.execute(request(1, 701));
    }
    #[test]
    fn pending_success_and_failure_do_not_double_reserve_or_unlock_agent_funds() {
        let mut c = setup();
        for (settled, pending) in [(0, 100), (100, 0), (0, 0)] {
            usage(&mut c, 1, settled, pending); usage(&mut c, 2, settled, pending);
            c.asset_ledgers.get_mut(&AssetId::NativeNear).unwrap().available = U128(1000-settled-pending);
            assert_eq!(c.get_reserved_budget(U64(1), AssetId::NativeNear, None).0, 300-settled-pending);
            let root = c.permissions.get(&1).unwrap().clone();
            assert!(c.check_allocated_budget(&[root.clone()], &AssetId::NativeNear, 700, 1_000_000).is_ok());
            assert!(c.check_allocated_budget(&[root], &AssetId::NativeNear, 701, 1_000_000).is_err());
        }
    }
    #[test]
    fn revoke_and_expiry_release_unused_budget_but_blocking_does_not() {
        let mut c = setup();
        c.blocked_principals.insert(accounts(3), true);
        assert_eq!(c.get_reserved_budget(U64(1), AssetId::NativeNear, None).0, 300);
        assert_eq!(c.reserved_budget(1, &AssetId::NativeNear, None, 2_000_000), 0);
        c.permissions.get_mut(&2).unwrap().revoked = true;
        assert_eq!(c.get_reserved_budget(U64(1), AssetId::NativeNear, None).0, 0);
    }
    #[test]
    fn descendant_spending_cannot_consume_a_sibling_branch() {
        let mut c = setup(); c.permissions.insert(3, permission(3, Some(1), 700)); c.permission_children.insert(1, vec![2,3]);
        let path = vec![c.permissions.get(&2).unwrap().clone(), c.permissions.get(&1).unwrap().clone()];
        assert!(c.check_allocated_budget(&path, &AssetId::NativeNear, 300, 1_000_000).is_ok());
        assert_eq!(c.reserved_budget(1, &AssetId::NativeNear, Some(2), 1_000_000), 700);
    }
    #[test]
    #[should_panic(expected="Child allocation exceeds unallocated parent budget")]
    fn siblings_cannot_overallocate_the_parent() {
        let c = setup(); let mut child = permission(3, Some(1), 701);
        c.validate_child_allocation(c.permissions.get(&1).unwrap(), &PermissionSpec { delegate: accounts(4), valid_from_ms: child.valid_from_ms, expires_at_ms: child.expires_at_ms, max_executions: None, rules: std::mem::take(&mut child.rules), redelegation_depth: 0, metadata_hash: None }, 1_000_000);
    }
}
