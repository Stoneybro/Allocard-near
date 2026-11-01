pub mod canonical;
pub mod errors;
pub mod events;
pub mod policy;
pub mod types;

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

use crate::canonical::parse_request_id;
use crate::errors::*;
use crate::events::{emit_event, EventLogData};
use crate::policy::{validate_child_narrowing, validate_permission_spec, MAX_DEPTH};
use crate::types::*;

const DEFAULT_MAX_TOTAL_PERMISSIONS: u32 = 1024;
const DEFAULT_MAX_PENDING_EXECUTIONS: u32 = 64;
const DEFAULT_MIN_OPERATING_RESERVE: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR
const DEFAULT_CALLBACK_GAS: Gas = Gas::from_tgas(30);
const DEFAULT_TRANSFER_GAS: Gas = Gas::from_tgas(20);

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Permissions,
    BlockedPrincipals,
    Usage,
    PermissionUsage,
    AssetLedgers,
    RegisteredAssets,
    Executions,
    ReplayMap,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TreasuryContract {
    pub config: TreasuryConfig,
    pub permissions: LookupMap<PermissionId, Permission>,
    pub blocked_principals: LookupMap<AccountId, bool>,
    pub usage: LookupMap<BudgetKey, Usage>,
    pub permission_usage: LookupMap<PermissionId, PermissionUsage>,
    pub asset_ledgers: LookupMap<AssetId, AssetLedger>,
    pub registered_assets: Vector<AssetId>,
    pub executions: LookupMap<ExecutionId, Execution>,
    pub replay_map: LookupMap<(AccountId, [u8; 32]), ExecutionId>,
}

#[near]
impl TreasuryContract {
    #[init]
    pub fn new(config: InitConfig) -> Self {
        assert!(!env::state_exists(), "Contract is already initialized");

        let mut asset_ledgers = LookupMap::new(StorageKey::AssetLedgers);
        let mut registered_assets = Vector::new(StorageKey::RegisteredAssets);

        // Native NEAR is automatically registered and enabled at initialization
        asset_ledgers.insert(
            AssetId::NativeNear,
            AssetLedger {
                available: U128(0),
                pending_outgoing: U128(0),
                enabled: true,
            },
        );
        registered_assets.push(AssetId::NativeNear);

        let treasury_config = TreasuryConfig {
            schema_version: 1,
            network_domain: config.network_domain.clone(),
            owner: config.owner.clone(),
            pending_owner: None,
            authority_epoch: U64(1),
            paused: false,
            next_permission_id: U64(1),
            next_execution_id: U64(1),
            max_total_permissions: config.max_total_permissions.unwrap_or(DEFAULT_MAX_TOTAL_PERMISSIONS),
            max_pending_executions: config.max_pending_executions.unwrap_or(DEFAULT_MAX_PENDING_EXECUTIONS),
            min_operating_reserve: config.min_operating_reserve.unwrap_or(U128(DEFAULT_MIN_OPERATING_RESERVE)),
            callback_gas: config.callback_gas.unwrap_or(DEFAULT_CALLBACK_GAS),
            transfer_gas: config.transfer_gas.unwrap_or(DEFAULT_TRANSFER_GAS),
            storage_funding_remaining: U128(0),
            operating_budget_remaining: U128(0),
            pending_execution_count: 0,
        };

        emit_event(EventLogData::TreasuryInitialized {
            network_domain: &config.network_domain,
            owner: &config.owner,
        });

        Self {
            config: treasury_config,
            permissions: LookupMap::new(StorageKey::Permissions),
            blocked_principals: LookupMap::new(StorageKey::BlockedPrincipals),
            usage: LookupMap::new(StorageKey::Usage),
            permission_usage: LookupMap::new(StorageKey::PermissionUsage),
            asset_ledgers,
            registered_assets,
            executions: LookupMap::new(StorageKey::Executions),
            replay_map: LookupMap::new(StorageKey::ReplayMap),
        }
    }

    // --- Authority Lifecycle & Permissions ---

    /// Creates a root permission (depth 0, issuer is treasury owner).
    pub fn create_root_permission(&mut self, spec: PermissionSpec) -> U64 {
        self.assert_zero_deposit();
        self.assert_unpaused();
        self.assert_owner();
        self.assert_not_blocked(&self.config.owner);

        // Self-delegation is rejected
        if spec.delegate == self.config.owner {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if (self.config.next_permission_id.0 as u32) > self.config.max_total_permissions {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if spec.redelegation_depth >= MAX_DEPTH {
            env::panic_str(ERR_MAX_DEPTH);
        }

        validate_permission_spec(&spec).unwrap_or_else(|e| env::panic_str(e));

        let metadata_hash = match spec.metadata_hash {
            Some(ref h) => Some(parse_request_id(h).unwrap_or_else(|e| env::panic_str(e))),
            None => None,
        };

        let permission_id = self.config.next_permission_id.0;
        self.config.next_permission_id = U64(permission_id + 1);

        let permission = Permission {
            id: U64(permission_id),
            parent_id: None,
            issuer: self.config.owner.clone(),
            delegate: spec.delegate.clone(),
            epoch: self.config.authority_epoch,
            depth: 0,
            valid_from_ms: spec.valid_from_ms,
            expires_at_ms: spec.expires_at_ms,
            max_executions: spec.max_executions,
            rules: spec.rules,
            redelegation_depth: spec.redelegation_depth,
            revoked: false,
            metadata_hash,
        };

        self.permissions.insert(permission_id, permission);

        emit_event(EventLogData::PermissionCreated {
            permission_id: U64(permission_id),
            parent_id: None,
            issuer: &self.config.owner,
            delegate: &spec.delegate,
            depth: 0,
            epoch: self.config.authority_epoch,
        });

        U64(permission_id)
    }

    /// Creates a child permission under an existing active parent permission.
    pub fn create_child_permission(&mut self, parent_id: U64, spec: PermissionSpec) -> U64 {
        self.assert_zero_deposit();
        self.assert_unpaused();

        let caller = env::predecessor_account_id();
        self.assert_not_blocked(&caller);

        let parent = self
            .permissions
            .get(&parent_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_PERMISSION_NOT_FOUND));

        if caller != parent.delegate {
            env::panic_str(ERR_UNAUTHORIZED);
        }

        // Self-delegation is rejected
        if spec.delegate == caller {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if (self.config.next_permission_id.0 as u32) > self.config.max_total_permissions {
            env::panic_str(ERR_INVALID_INPUT);
        }

        // Parent must be currently live
        if parent.revoked {
            env::panic_str(ERR_PERMISSION_REVOKED);
        }
        if parent.epoch != self.config.authority_epoch {
            env::panic_str(ERR_STALE_EPOCH);
        }
        let now_ms = env::block_timestamp_ms();
        if now_ms < parent.valid_from_ms.0 {
            env::panic_str(ERR_PERMISSION_NOT_STARTED);
        }
        if let Some(exp) = parent.expires_at_ms {
            if now_ms >= exp.0 {
                env::panic_str(ERR_PERMISSION_EXPIRED);
            }
        }

        // Also check if any ancestor or issuer is blocked or revoked
        self.assert_path_active(parent_id.0, now_ms);

        validate_child_narrowing(&parent, &spec).unwrap_or_else(|e| env::panic_str(e));

        let metadata_hash = match spec.metadata_hash {
            Some(ref h) => Some(parse_request_id(h).unwrap_or_else(|e| env::panic_str(e))),
            None => None,
        };

        let permission_id = self.config.next_permission_id.0;
        self.config.next_permission_id = U64(permission_id + 1);

        let permission = Permission {
            id: U64(permission_id),
            parent_id: Some(parent_id),
            issuer: caller.clone(),
            delegate: spec.delegate.clone(),
            epoch: parent.epoch,
            depth: parent.depth + 1,
            valid_from_ms: spec.valid_from_ms,
            expires_at_ms: spec.expires_at_ms,
            max_executions: spec.max_executions,
            rules: spec.rules,
            redelegation_depth: spec.redelegation_depth,
            revoked: false,
            metadata_hash,
        };

        self.permissions.insert(permission_id, permission);

        emit_event(EventLogData::PermissionCreated {
            permission_id: U64(permission_id),
            parent_id: Some(parent_id),
            issuer: &caller,
            delegate: &spec.delegate,
            depth: parent.depth + 1,
            epoch: self.config.authority_epoch,
        });

        U64(permission_id)
    }

    /// Revokes a permission. Can be called by owner, issuer, any ancestor delegate, or the delegate themselves.
    pub fn revoke_permission(&mut self, permission_id: U64) {
        self.assert_zero_deposit();
        let caller = env::predecessor_account_id();

        let perm = self
            .permissions
            .get(&permission_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_PERMISSION_NOT_FOUND));

        // Idempotent: already revoked is a no-op
        if perm.revoked {
            return;
        }

        // Check if caller is authorized to revoke
        let mut authorized = false;
        if caller == self.config.owner || caller == perm.issuer || caller == perm.delegate {
            authorized = true;
        } else {
            // Check if caller is a strict ancestor delegate
            let mut curr_parent_id = perm.parent_id;
            let mut depth_counter = 0;
            while let Some(pid) = curr_parent_id {
                if depth_counter >= MAX_DEPTH {
                    break;
                }
                depth_counter += 1;
                if let Some(parent) = self.permissions.get(&pid.0) {
                    if parent.delegate == caller {
                        authorized = true;
                        break;
                    }
                    curr_parent_id = parent.parent_id;
                } else {
                    break;
                }
            }
        }

        if !authorized {
            env::panic_str(ERR_UNAUTHORIZED);
        }

        if let Some(target) = self.permissions.get_mut(&permission_id.0) {
            target.revoked = true;
        }

        emit_event(EventLogData::PermissionRevoked {
            permission_id,
            revoker: &caller,
        });
    }

    /// Blocks or unblocks a principal account.
    pub fn set_principal_blocked(&mut self, account: AccountId, blocked: bool) {
        self.assert_zero_deposit();
        self.assert_owner();

        // Owner cannot block itself
        if account == self.config.owner && blocked {
            env::panic_str(ERR_INVALID_INPUT);
        }

        self.blocked_principals.insert(account.clone(), blocked);

        emit_event(EventLogData::PrincipalBlockChanged {
            principal: &account,
            blocked,
        });
    }

    /// Sets the treasury paused state.
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_zero_deposit();
        self.assert_owner();

        self.config.paused = paused;

        emit_event(EventLogData::PauseChanged { paused });
    }

    /// Advances the authority epoch in O(1), immediately invalidating all past permissions.
    pub fn invalidate_all_permissions(&mut self) {
        self.assert_zero_deposit();
        self.assert_owner();

        self.config.authority_epoch = U64(self.config.authority_epoch.0 + 1);

        emit_event(EventLogData::AuthorityEpochChanged {
            new_epoch: self.config.authority_epoch,
        });
    }

    // --- Views ---

    pub fn get_config(&self) -> TreasuryConfig {
        self.config.clone()
    }

    pub fn get_permission(&self, permission_id: U64) -> Option<Permission> {
        self.permissions.get(&permission_id.0).cloned()
    }

    pub fn get_permission_path(&self, permission_id: U64) -> Vec<Permission> {
        self.load_path_internal(permission_id.0)
            .unwrap_or_else(|e| env::panic_str(e))
    }

    pub fn is_principal_blocked(&self, account: AccountId) -> bool {
        self.blocked_principals.get(&account).copied().unwrap_or(false)
    }

    pub fn get_permission_usage(&self, permission_id: U64) -> PermissionUsage {
        self.permission_usage
            .get(&permission_id.0)
            .cloned()
            .unwrap_or_default()
    }
}

// --- Internal Helper Methods (not exposed to NEAR RPC) ---
impl TreasuryContract {
    fn assert_zero_deposit(&self) {
        if env::attached_deposit() > NearToken::from_yoctonear(0) {
            env::panic_str(ERR_INVALID_INPUT);
        }
    }

    fn assert_unpaused(&self) {
        if self.config.paused {
            env::panic_str(ERR_PAUSED);
        }
    }

    fn assert_owner(&self) {
        if env::predecessor_account_id() != self.config.owner {
            env::panic_str(ERR_UNAUTHORIZED);
        }
    }

    fn assert_not_blocked(&self, account: &AccountId) {
        if self.is_principal_blocked(account.clone()) {
            env::panic_str(ERR_PRINCIPAL_BLOCKED);
        }
    }

    fn assert_path_active(&self, permission_id: u64, now_ms: u64) {
        let path = self
            .load_path_internal(permission_id)
            .unwrap_or_else(|e| env::panic_str(e));
        for perm in path {
            if perm.revoked {
                env::panic_str(ERR_PERMISSION_REVOKED);
            }
            if perm.epoch != self.config.authority_epoch {
                env::panic_str(ERR_STALE_EPOCH);
            }
            self.assert_not_blocked(&perm.issuer);
            self.assert_not_blocked(&perm.delegate);
            if now_ms < perm.valid_from_ms.0 {
                env::panic_str(ERR_PERMISSION_NOT_STARTED);
            }
            if let Some(exp) = perm.expires_at_ms {
                if now_ms >= exp.0 {
                    env::panic_str(ERR_PERMISSION_EXPIRED);
                }
            }
        }
    }

    pub fn load_path_internal(&self, permission_id: u64) -> Result<Vec<Permission>, &'static str> {
        let mut path = Vec::new();
        let mut curr_id = Some(permission_id);
        let mut depth_counter = 0;

        while let Some(id) = curr_id {
            if depth_counter >= MAX_DEPTH {
                return Err(ERR_MAX_DEPTH);
            }
            depth_counter += 1;

            let perm = self.permissions.get(&id).ok_or(ERR_PERMISSION_NOT_FOUND)?;
            path.push(perm.clone());
            curr_id = perm.parent_id.map(|p| p.0);
        }

        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn owner() -> AccountId {
        "company.near".parse().unwrap()
    }

    fn manager() -> AccountId {
        "manager.near".parse().unwrap()
    }

    fn employee() -> AccountId {
        "employee.near".parse().unwrap()
    }

    fn vendor() -> AccountId {
        "vendor.near".parse().unwrap()
    }

    fn setup_contract() -> TreasuryContract {
        let context = VMContextBuilder::new()
            .current_account_id("treasury.near".parse().unwrap())
            .signer_account_id(owner())
            .predecessor_account_id(owner())
            .block_timestamp(1_000_000_000_000) // ms timestamp: 1_000_000_000
            .build();
        testing_env!(context);

        TreasuryContract::new(InitConfig {
            network_domain: "near:testnet".to_string(),
            owner: owner(),
            max_total_permissions: Some(100),
            max_pending_executions: Some(10),
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        })
    }

    #[test]
    fn test_init_state() {
        let contract = setup_contract();
        let cfg = contract.get_config();
        assert_eq!(cfg.owner, owner());
        assert_eq!(cfg.authority_epoch.0, 1);
        assert!(!cfg.paused);
        assert_eq!(cfg.next_permission_id.0, 1);
    }

    #[test]
    fn test_create_root_permission_success() {
        let mut contract = setup_contract();

        let spec = PermissionSpec {
            delegate: manager(),
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(10),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(500)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 2,
            metadata_hash: None,
        };

        let perm_id = contract.create_root_permission(spec);
        assert_eq!(perm_id.0, 1);

        let perm = contract.get_permission(perm_id).expect("should exist");
        assert_eq!(perm.id.0, 1);
        assert_eq!(perm.issuer, owner());
        assert_eq!(perm.delegate, manager());
        assert_eq!(perm.depth, 0);
        assert_eq!(perm.epoch.0, 1);
        assert!(!perm.revoked);
    }

    #[test]
    fn test_create_child_permission_success() {
        let mut contract = setup_contract();

        // 1. Root permission to manager
        let root_spec = PermissionSpec {
            delegate: manager(),
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(10),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(500)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 2,
            metadata_hash: None,
        };
        let root_id = contract.create_root_permission(root_spec);

        // 2. Manager creates child permission for employee
        let context = VMContextBuilder::new()
            .current_account_id("treasury.near".parse().unwrap())
            .signer_account_id(manager())
            .predecessor_account_id(manager())
            .block_timestamp(1_500_000_000_000)
            .build();
        testing_env!(context);

        let child_spec = PermissionSpec {
            delegate: employee(),
            valid_from_ms: U64(1_200_000),
            expires_at_ms: Some(U64(1_800_000)),
            max_executions: Some(3),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![vendor()]),
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(200)),
                lifetime_limit: Some(U128(1000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1,
            metadata_hash: None,
        };

        let child_id = contract.create_child_permission(root_id, child_spec);
        assert_eq!(child_id.0, 2);

        let child = contract.get_permission(child_id).expect("child exists");
        assert_eq!(child.parent_id, Some(root_id));
        assert_eq!(child.issuer, manager());
        assert_eq!(child.delegate, employee());
        assert_eq!(child.depth, 1);

        // Test path
        let path = contract.get_permission_path(child_id);
        assert_eq!(path.len(), 2);
        assert_eq!(path[0].id, child_id);
        assert_eq!(path[1].id, root_id);
    }

    #[test]
    fn test_revocation_by_manager() {
        let mut contract = setup_contract();

        let root_spec = PermissionSpec {
            delegate: manager(),
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(10),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(500)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 2,
            metadata_hash: None,
        };
        let root_id = contract.create_root_permission(root_spec);

        // Switch to manager
        testing_env!(VMContextBuilder::new()
            .current_account_id("treasury.near".parse().unwrap())
            .predecessor_account_id(manager())
            .block_timestamp(1_500_000_000_000)
            .build());

        let child_spec = PermissionSpec {
            delegate: employee(),
            valid_from_ms: U64(1_200_000),
            expires_at_ms: Some(U64(1_800_000)),
            max_executions: Some(3),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![vendor()]),
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(200)),
                lifetime_limit: Some(U128(1000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        };
        let child_id = contract.create_child_permission(root_id, child_spec);

        // Manager revokes child
        contract.revoke_permission(child_id);

        let child = contract.get_permission(child_id).unwrap();
        assert!(child.revoked);
    }

    #[test]
    fn test_invalidate_all_permissions() {
        let mut contract = setup_contract();

        let root_spec = PermissionSpec {
            delegate: manager(),
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: None,
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1,
            metadata_hash: None,
        };
        let root_id = contract.create_root_permission(root_spec);

        // Invalidate all
        contract.invalidate_all_permissions();

        let cfg = contract.get_config();
        assert_eq!(cfg.authority_epoch.0, 2);

        // Creating child from old epoch root fails
        testing_env!(VMContextBuilder::new()
            .current_account_id("treasury.near".parse().unwrap())
            .predecessor_account_id(manager())
            .block_timestamp(1_500_000_000_000)
            .build());

        let child_spec = PermissionSpec {
            delegate: employee(),
            valid_from_ms: U64(1_200_000),
            expires_at_ms: Some(U64(1_800_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: None,
                lifetime_limit: Some(U128(1000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        };

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut c = contract;
            c.create_child_permission(root_id, child_spec);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_pause_and_block_principal() {
        let mut contract = setup_contract();

        // Pause contract
        contract.set_paused(true);
        assert!(contract.get_config().paused);

        // Blocking account
        contract.set_principal_blocked(employee(), true);
        assert!(contract.is_principal_blocked(employee()));

        // Cannot create root while paused
        let spec = PermissionSpec {
            delegate: manager(),
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: None,
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1,
            metadata_hash: None,
        };

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut c = contract;
            c.create_root_permission(spec);
        }));
        assert!(result.is_err());
    }
}
