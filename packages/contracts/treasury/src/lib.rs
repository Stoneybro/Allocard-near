mod allocations;
pub mod canonical;
pub mod errors;
pub mod events;
pub mod policy;
pub mod types;

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

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
const MAX_APPROVAL_DURATION_MS: u64 = 7 * 24 * 60 * 60 * 1000; // 7 days

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
    Approvals,
    PermissionChildren,
}

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[cfg_attr(not(feature = "shared-engine"), near(contract_state))]
#[cfg_attr(feature = "shared-engine", near(serializers = [borsh]))]
#[derive(PanicOnDefault)]
pub struct TreasuryContract {
    #[cfg(feature = "shared-engine")]
    #[borsh(skip)]
    pub company_context: Option<String>,
    pub config: TreasuryConfig,
    pub permissions: LookupMap<PermissionId, Permission>,
    pub blocked_principals: LookupMap<AccountId, bool>,
    pub usage: LookupMap<BudgetKey, Usage>,
    pub permission_usage: LookupMap<PermissionId, PermissionUsage>,
    pub asset_ledgers: LookupMap<AssetId, AssetLedger>,
    pub registered_assets: Vector<AssetId>,
    pub executions: LookupMap<ExecutionId, Execution>,
    pub replay_map: LookupMap<(AccountId, [u8; 32]), ExecutionId>,
    pub approvals: LookupMap<ApprovalKey, ApprovalRecord>,
    pub permission_children: LookupMap<PermissionId, Vec<PermissionId>>,
}

impl TreasuryContract {
    fn build(config: InitConfig, company_id: Option<String>) -> Self {
        let prefix = |key: StorageKey| -> Vec<u8> {
            let mut bytes = match &company_id {
                Some(id) => [b"company:".as_slice(), id.as_bytes(), b":"].concat(),
                None => vec![],
            };
            bytes.extend(borsh::to_vec(&key).unwrap());
            bytes
        };
        if config.network_domain.is_empty() || config.network_domain.len() > 64 {
            env::panic_str(ERR_INVALID_INPUT);
        }
        if config
            .callback_gas
            .is_some_and(|gas| gas < Gas::from_tgas(10))
            || config
                .transfer_gas
                .is_some_and(|gas| gas < Gas::from_tgas(10))
        {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let mut asset_ledgers = LookupMap::new(prefix(StorageKey::AssetLedgers));
        let mut registered_assets = Vector::new(prefix(StorageKey::RegisteredAssets));

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
            schema_version: if company_id.is_some() { 4 } else { 3 },
            network_domain: config.network_domain.clone(),
            owner: config.owner.clone(),
            pending_owner: None,
            authority_epoch: U64(1),
            paused: false,
            next_permission_id: U64(1),
            next_execution_id: U64(1),
            max_total_permissions: config
                .max_total_permissions
                .unwrap_or(DEFAULT_MAX_TOTAL_PERMISSIONS),
            max_pending_executions: config
                .max_pending_executions
                .unwrap_or(DEFAULT_MAX_PENDING_EXECUTIONS),
            min_operating_reserve: config
                .min_operating_reserve
                .unwrap_or(U128(DEFAULT_MIN_OPERATING_RESERVE)),
            callback_gas: config.callback_gas.unwrap_or(DEFAULT_CALLBACK_GAS),
            transfer_gas: config.transfer_gas.unwrap_or(DEFAULT_TRANSFER_GAS),
            callback_storage_reserved: U128(0),
            storage_funding_remaining: U128(0),
            operating_budget_remaining: U128(0),
            pending_execution_count: 0,
        };

        emit_event(EventLogData::TreasuryInitialized {
            network_domain: &config.network_domain,
            owner: &config.owner,
        });

        let mut contract = Self {
            #[cfg(feature = "shared-engine")]
            company_context: company_id.clone(),
            config: treasury_config,
            permissions: LookupMap::new(prefix(StorageKey::Permissions)),
            blocked_principals: LookupMap::new(prefix(StorageKey::BlockedPrincipals)),
            usage: LookupMap::new(prefix(StorageKey::Usage)),
            permission_usage: LookupMap::new(prefix(StorageKey::PermissionUsage)),
            asset_ledgers,
            registered_assets,
            executions: LookupMap::new(prefix(StorageKey::Executions)),
            replay_map: LookupMap::new(prefix(StorageKey::ReplayMap)),
            approvals: LookupMap::new(prefix(StorageKey::Approvals)),
            permission_children: LookupMap::new(prefix(StorageKey::PermissionChildren)),
        };
        contract.flush_collections();
        contract.assert_physical_solvency(0);
        contract
    }
}

#[cfg_attr(not(feature = "shared-engine"), near)]
impl TreasuryContract {
    // --- Authority Lifecycle & Permissions ---

    /// Creates a root permission (depth 0, issuer is treasury owner).
    pub fn create_root_permission(&mut self, spec: PermissionSpec) -> U64 {
        let storage_before = self.storage_checkpoint();
        self.assert_input_bound();
        self.assert_zero_deposit();
        self.assert_unpaused();
        self.assert_owner();
        self.assert_not_blocked(&self.config.owner);

        // Self-delegation is rejected
        if spec.delegate == self.config.owner {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if self.config.next_permission_id.0 > u64::from(self.config.max_total_permissions) {
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

        self.charge_storage(storage_before);
        U64(permission_id)
    }

    /// Creates a child permission under an existing active parent permission.
    pub fn create_child_permission(&mut self, parent_id: U64, spec: PermissionSpec) -> U64 {
        let storage_before = self.storage_checkpoint();
        self.assert_input_bound();
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

        if self.config.next_permission_id.0 > u64::from(self.config.max_total_permissions) {
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
        let mut children = self.validate_child_allocation(&parent, &spec, now_ms);

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
        children.push(permission_id);
        self.permission_children.insert(parent_id.0, children);

        emit_event(EventLogData::PermissionCreated {
            permission_id: U64(permission_id),
            parent_id: Some(parent_id),
            issuer: &caller,
            delegate: &spec.delegate,
            depth: parent.depth + 1,
            epoch: self.config.authority_epoch,
        });

        self.charge_storage(storage_before);
        U64(permission_id)
    }

    /// Revokes a permission. Can be called by owner, issuer, any ancestor delegate, or the delegate themselves.
    pub fn revoke_permission(&mut self, permission_id: U64) {
        let storage_before = self.storage_checkpoint();
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
        self.charge_storage(storage_before);
    }

    /// Blocks or unblocks a principal account.
    pub fn set_principal_blocked(&mut self, account: AccountId, blocked: bool) {
        let storage_before = self.storage_checkpoint();
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
        self.charge_storage(storage_before);
    }

    /// Sets the treasury paused state.
    pub fn set_paused(&mut self, paused: bool) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        self.assert_owner();

        self.config.paused = paused;

        emit_event(EventLogData::PauseChanged { paused });
        self.charge_storage(storage_before);
    }

    /// Advances the authority epoch in O(1), immediately invalidating all past permissions.
    pub fn invalidate_all_permissions(&mut self) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        self.assert_owner();

        self.config.authority_epoch = U64(self.config.authority_epoch.0 + 1);

        emit_event(EventLogData::AuthorityEpochChanged {
            new_epoch: self.config.authority_epoch,
        });
        self.charge_storage(storage_before);
    }

    // --- Ownership Handover (Two-Step) ---

    pub fn nominate_owner(&mut self, nominee: AccountId) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        self.assert_owner();

        if nominee == self.config.owner {
            env::panic_str(ERR_INVALID_INPUT);
        }
        self.assert_not_blocked(&nominee);

        self.config.pending_owner = Some(nominee.clone());

        emit_event(EventLogData::OwnerNominated { nominee: &nominee });
        self.charge_storage(storage_before);
    }

    pub fn cancel_owner_nomination(&mut self) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        self.assert_owner();

        self.config.pending_owner = None;
        self.charge_storage(storage_before);
    }

    pub fn accept_ownership(&mut self) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();

        let caller = env::predecessor_account_id();
        self.assert_not_blocked(&caller);

        let pending = self
            .config
            .pending_owner
            .take()
            .unwrap_or_else(|| env::panic_str(ERR_UNAUTHORIZED));

        if caller != pending {
            env::panic_str(ERR_UNAUTHORIZED);
        }

        let old_owner = self.config.owner.clone();
        self.config.owner = caller.clone();
        self.config.authority_epoch = U64(self.config.authority_epoch.0 + 1);

        emit_event(EventLogData::OwnerChanged {
            old_owner: &old_owner,
            new_owner: &caller,
        });
        emit_event(EventLogData::AuthorityEpochChanged {
            new_epoch: self.config.authority_epoch,
        });
        self.charge_storage(storage_before);
    }

    // --- Asset Registration & Management ---

    pub fn register_asset(&mut self, asset: AssetId) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        self.assert_owner();

        if self.asset_ledgers.contains_key(&asset) {
            env::panic_str(ERR_INVALID_INPUT);
        }

        self.asset_ledgers.insert(
            asset.clone(),
            AssetLedger {
                available: U128(0),
                pending_outgoing: U128(0),
                enabled: false,
            },
        );
        self.registered_assets.push(asset.clone());

        emit_event(EventLogData::AssetRegistered {
            asset: &asset_to_string(&asset),
        });
        self.charge_storage(storage_before);
    }

    pub fn set_asset_enabled(&mut self, asset: AssetId, enabled: bool) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        self.assert_owner();

        let mut ledger = self
            .asset_ledgers
            .get(&asset)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_ASSET_NOT_ALLOWED));

        ledger.enabled = enabled;
        self.asset_ledgers.insert(asset.clone(), ledger);

        emit_event(EventLogData::AssetStatusChanged {
            asset: &asset_to_string(&asset),
            enabled,
        });
        self.charge_storage(storage_before);
    }

    // --- Deposits & Top-ups ---

    /// NEP-141 token receiver callback.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let storage_before = self.storage_checkpoint();
        let token_contract = env::predecessor_account_id();
        let asset = AssetId::Nep141(token_contract.clone());

        if amount.0 == 0 {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if !msg.is_empty() && msg != "{}" {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let mut ledger = self
            .asset_ledgers
            .get(&asset)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_ASSET_DISABLED));

        if !ledger.enabled {
            env::panic_str(ERR_ASSET_DISABLED);
        }

        ledger.available = U128(
            ledger
                .available
                .0
                .checked_add(amount.0)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT)),
        );
        self.asset_ledgers.insert(asset.clone(), ledger);

        emit_event(EventLogData::TreasuryDeposit {
            asset: &token_contract.to_string(),
            sender: &sender_id,
            amount,
        });

        self.charge_storage(storage_before);
        U128(0) // 0 tokens unused, 100% credited to treasury
    }

    // --- Approvals ---

    pub fn approve_request(&mut self, actor: AccountId, request: ExecuteRequest) {
        let storage_before = self.storage_checkpoint();
        self.assert_input_bound();
        self.assert_zero_deposit();

        let approver = env::predecessor_account_id();
        self.assert_not_blocked(&approver);
        self.assert_not_blocked(&actor);

        if request.api_version != 1 {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let now_ms = env::block_timestamp_ms();
        if now_ms >= request.deadline_ms.0 {
            env::panic_str(ERR_DEADLINE_EXPIRED);
        }
        if request.deadline_ms.0 > now_ms + MAX_APPROVAL_DURATION_MS {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let (_request_id_bytes, request_hash) = crate::canonical::compute_execute_hash(
            &self.request_domain(),
            &env::current_account_id(),
            &actor,
            &request,
        )
        .unwrap_or_else(|e| env::panic_str(e));

        let leaf = self
            .permissions
            .get(&request.permission_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_PERMISSION_NOT_FOUND));

        if leaf.delegate != actor {
            env::panic_str(ERR_UNAUTHORIZED);
        }

        let path = self
            .load_path_internal(request.permission_id.0)
            .unwrap_or_else(|e| env::panic_str(e));

        for perm in &path {
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

        let asset = request.action.asset().clone();
        let amount = request.action.amount();
        let mut matched_rules = 0;

        for perm in &path {
            if let Some(rule) = perm.rules.iter().find(|r| &r.asset == &asset) {
                if let Some(ref app_rule) = rule.approval {
                    if app_rule.approver == approver && amount > app_rule.above_amount.0 {
                        let key = ApprovalKey {
                            request_hash,
                            permission_id: perm.id.0,
                            asset: asset.clone(),
                        };
                        self.approvals.insert(
                            key,
                            ApprovalRecord {
                                approver: approver.clone(),
                                expires_at_ms: request.deadline_ms,
                            },
                        );
                        matched_rules += 1;

                        emit_event(EventLogData::ApprovalRecorded {
                            request_hash: &hex::encode(request_hash),
                            permission_id: perm.id,
                            asset: &asset_to_string(&asset),
                            approver: &approver,
                        });
                    }
                }
            }
        }

        if matched_rules == 0 {
            env::panic_str(ERR_UNAUTHORIZED);
        }
        self.charge_storage(storage_before);
    }

    pub fn revoke_approval(&mut self, actor: AccountId, request: ExecuteRequest) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        let approver = env::predecessor_account_id();

        let (_request_id_bytes, request_hash) = crate::canonical::compute_execute_hash(
            &self.request_domain(),
            &env::current_account_id(),
            &actor,
            &request,
        )
        .unwrap_or_else(|e| env::panic_str(e));

        let path = self
            .load_path_internal(request.permission_id.0)
            .unwrap_or_else(|e| env::panic_str(e));

        let asset = request.action.asset().clone();
        for perm in &path {
            let key = ApprovalKey {
                request_hash,
                permission_id: perm.id.0,
                asset: asset.clone(),
            };
            if let Some(record) = self.approvals.get(&key) {
                if record.approver == approver {
                    self.approvals.remove(&key);
                    emit_event(EventLogData::ApprovalRevoked {
                        request_hash: &hex::encode(request_hash),
                        permission_id: perm.id,
                        asset: &asset_to_string(&asset),
                        approver: &approver,
                    });
                }
            }
        }
        self.charge_storage(storage_before);
    }

    // --- Execution Dispatch (Two-Phase) ---

    pub fn execute(&mut self, request: ExecuteRequest) -> U64 {
        let storage_before = self.storage_checkpoint();
        self.assert_input_bound();
        self.assert_zero_deposit();

        let actor = env::predecessor_account_id();

        if request.api_version != 1 {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let (request_id_bytes, hash) = crate::canonical::compute_execute_hash(
            &self.request_domain(),
            &env::current_account_id(),
            &actor,
            &request,
        )
        .unwrap_or_else(|e| env::panic_str(e));

        // Replay handling first!
        if let Some(existing_id) = self
            .replay_map
            .get(&(actor.clone(), request_id_bytes))
            .copied()
        {
            let existing = self
                .executions
                .get(&existing_id)
                .cloned()
                .unwrap_or_else(|| env::panic_str(ERR_EXECUTION_NOT_FOUND));
            if existing.request_hash == hash {
                return U64(existing_id);
            } else {
                env::panic_str(ERR_REQUEST_ID_CONFLICT);
            }
        }

        // New request validation
        self.assert_unpaused();
        self.assert_not_blocked(&actor);

        let now_ms = env::block_timestamp_ms();
        if now_ms >= request.deadline_ms.0 {
            env::panic_str(ERR_DEADLINE_EXPIRED);
        }

        let amount = request.action.amount();
        if amount == 0 {
            env::panic_str(ERR_INVALID_INPUT);
        }
        if request.action.receiver() == &env::current_account_id() {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if self.config.pending_execution_count >= self.config.max_pending_executions {
            env::panic_str(ERR_PENDING_LIMIT);
        }

        let required_gas = self.config.transfer_gas.as_gas() + self.config.callback_gas.as_gas();
        if env::prepaid_gas()
            .as_gas()
            .saturating_sub(env::used_gas().as_gas())
            < required_gas + Gas::from_tgas(10).as_gas()
        {
            env::panic_str(ERR_INSUFFICIENT_GAS);
        }

        let asset = request.action.asset().clone();
        let mut ledger = self
            .asset_ledgers
            .get(&asset)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_ASSET_DISABLED));
        if !ledger.enabled {
            env::panic_str(ERR_ASSET_DISABLED);
        }
        if ledger.available.0 < amount {
            env::panic_str(ERR_INSUFFICIENT_AVAILABLE_FUNDS);
        }

        let path = self
            .load_path_internal(request.permission_id.0)
            .unwrap_or_else(|e| env::panic_str(e));

        // Verify all ancestors not blocked
        for perm in &path {
            self.assert_not_blocked(&perm.issuer);
            self.assert_not_blocked(&perm.delegate);
        }

        let ctx = crate::policy::PathEvaluationContext {
            now_ms,
            current_epoch: self.config.authority_epoch.0,
            action: &request.action,
            leaf_actor: &actor,
            path: &path,
        };

        let outcome = crate::policy::evaluate_path_pure(
            &ctx,
            |k| self.usage.get(k).cloned().unwrap_or_default(),
            |pid| self.permission_usage.get(&pid).cloned().unwrap_or_default(),
        )
        .unwrap_or_else(|e| env::panic_str(e));

        self.check_allocated_budget(&path, &asset, amount, now_ms)
            .unwrap_or_else(|e| env::panic_str(e));

        // Check required approvals and consume them
        for (perm_id, approver) in &outcome.required_approvals {
            self.assert_not_blocked(approver);
            let app_key = ApprovalKey {
                request_hash: hash,
                permission_id: *perm_id,
                asset: asset.clone(),
            };
            let app = self
                .approvals
                .get(&app_key)
                .cloned()
                .unwrap_or_else(|| env::panic_str(ERR_APPROVAL_REQUIRED));
            if &app.approver != approver {
                env::panic_str(ERR_APPROVAL_REQUIRED);
            }
            if now_ms >= app.expires_at_ms.0 {
                env::panic_str(ERR_APPROVAL_EXPIRED);
            }
            // Consume approval
            self.approvals.remove(&app_key);
        }

        // Lock reservations across all ancestors
        for res in &outcome.reservations {
            let mut u = self.usage.get(&res.budget_key).cloned().unwrap_or_default();
            u.pending = U128(u.pending.0 + res.amount.0);
            self.usage.insert(res.budget_key.clone(), u);
        }

        // Increment execution count for permissions with max_executions
        for perm in &path {
            if perm.max_executions.is_some() {
                let mut pu = self
                    .permission_usage
                    .get(&perm.id.0)
                    .cloned()
                    .unwrap_or_default();
                pu.executions_count += 1;
                self.permission_usage.insert(perm.id.0, pu);
            }
        }

        // Debit available, credit pending_outgoing
        ledger.available = U128(ledger.available.0 - amount);
        ledger.pending_outgoing = U128(ledger.pending_outgoing.0 + amount);
        self.asset_ledgers.insert(asset.clone(), ledger);

        let execution_id = self.config.next_execution_id.0;
        self.config.next_execution_id = U64(execution_id + 1);
        self.config.pending_execution_count += 1;

        let execution = Execution {
            id: U64(execution_id),
            actor: actor.clone(),
            request_id: request_id_bytes,
            request_hash: hash,
            authority_mode: AuthorityMode::Delegated,
            permission_id: Some(request.permission_id),
            epoch: self.config.authority_epoch,
            action: request.action.clone(),
            created_at_ms: U64(now_ms),
            status: ExecutionStatus::Pending,
            needs_reconciliation: false,
            reservations: outcome.reservations,
            failure_code: None,
        };

        self.executions.insert(execution_id, execution);
        self.replay_map
            .insert((actor.clone(), request_id_bytes), execution_id);

        emit_event(EventLogData::ExecutionDispatched {
            execution_id: U64(execution_id),
            actor: &actor,
            permission_id: Some(request.permission_id),
            amount: U128(amount),
            asset: &asset_to_string(&asset),
        });

        self.reserve_callback_storage();
        self.charge_storage(storage_before);
        self.prepare_dispatch(&asset, amount);
        self.dispatch_action_promise(&asset, request.action.receiver(), amount, execution_id);

        U64(execution_id)
    }

    pub fn owner_withdraw(&mut self, request: OwnerWithdrawRequest) -> U64 {
        let storage_before = self.storage_checkpoint();
        self.assert_input_bound();
        self.assert_zero_deposit();
        let owner = env::predecessor_account_id();

        if request.api_version != 1 {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let (request_id_bytes, hash) = crate::canonical::compute_owner_withdraw_hash(
            &self.request_domain(),
            &env::current_account_id(),
            &owner,
            &request,
        )
        .unwrap_or_else(|e| env::panic_str(e));

        // Replay check
        if let Some(existing_id) = self
            .replay_map
            .get(&(owner.clone(), request_id_bytes))
            .copied()
        {
            let existing = self
                .executions
                .get(&existing_id)
                .cloned()
                .unwrap_or_else(|| env::panic_str(ERR_EXECUTION_NOT_FOUND));
            if existing.request_hash == hash {
                return U64(existing_id);
            } else {
                env::panic_str(ERR_REQUEST_ID_CONFLICT);
            }
        }

        self.assert_unpaused();
        self.assert_owner();
        self.assert_not_blocked(&owner);
        if request.authority_epoch != self.config.authority_epoch {
            env::panic_str(ERR_STALE_EPOCH);
        }

        let now_ms = env::block_timestamp_ms();
        if now_ms >= request.deadline_ms.0 {
            env::panic_str(ERR_DEADLINE_EXPIRED);
        }

        let amount = request.action.amount();
        if amount == 0 {
            env::panic_str(ERR_INVALID_INPUT);
        }
        if request.action.receiver() == &env::current_account_id() {
            env::panic_str(ERR_INVALID_INPUT);
        }

        if self.config.pending_execution_count >= self.config.max_pending_executions {
            env::panic_str(ERR_PENDING_LIMIT);
        }

        let required_gas = self.config.transfer_gas.as_gas() + self.config.callback_gas.as_gas();
        if env::prepaid_gas()
            .as_gas()
            .saturating_sub(env::used_gas().as_gas())
            < required_gas + Gas::from_tgas(10).as_gas()
        {
            env::panic_str(ERR_INSUFFICIENT_GAS);
        }

        let asset = request.action.asset().clone();
        let mut ledger = self
            .asset_ledgers
            .get(&asset)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_ASSET_DISABLED));
        if !ledger.enabled {
            env::panic_str(ERR_ASSET_DISABLED);
        }
        if ledger.available.0 < amount {
            env::panic_str(ERR_INSUFFICIENT_AVAILABLE_FUNDS);
        }

        ledger.available = U128(ledger.available.0 - amount);
        ledger.pending_outgoing = U128(ledger.pending_outgoing.0 + amount);
        self.asset_ledgers.insert(asset.clone(), ledger);

        let execution_id = self.config.next_execution_id.0;
        self.config.next_execution_id = U64(execution_id + 1);
        self.config.pending_execution_count += 1;

        let execution = Execution {
            id: U64(execution_id),
            actor: owner.clone(),
            request_id: request_id_bytes,
            request_hash: hash,
            authority_mode: AuthorityMode::OwnerWithdrawal,
            permission_id: None,
            epoch: self.config.authority_epoch,
            action: request.action.clone(),
            created_at_ms: U64(now_ms),
            status: ExecutionStatus::Pending,
            needs_reconciliation: false,
            reservations: Vec::new(),
            failure_code: None,
        };

        self.executions.insert(execution_id, execution);
        self.replay_map
            .insert((owner.clone(), request_id_bytes), execution_id);

        emit_event(EventLogData::ExecutionDispatched {
            execution_id: U64(execution_id),
            actor: &owner,
            permission_id: None,
            amount: U128(amount),
            asset: &asset_to_string(&asset),
        });

        self.reserve_callback_storage();
        self.charge_storage(storage_before);
        self.prepare_dispatch(&asset, amount);
        self.dispatch_action_promise(&asset, request.action.receiver(), amount, execution_id);

        U64(execution_id)
    }

    /// Private settlement callback evaluated after transfer promise finishes.

    /// Flags an execution pending for > 10 minutes as needing reconciliation.
    pub fn flag_unresolved(&mut self, execution_id: U64) {
        let storage_before = self.storage_checkpoint();
        self.assert_zero_deposit();
        let caller = env::predecessor_account_id();

        let mut execution = self
            .executions
            .get(&execution_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_EXECUTION_NOT_FOUND));

        if execution.status != ExecutionStatus::Pending {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let now_ms = env::block_timestamp_ms();
        if now_ms < execution.created_at_ms.0 + 600_000 {
            env::panic_str(ERR_TOO_EARLY_TO_FLAG);
        }

        execution.needs_reconciliation = true;
        self.executions.insert(execution_id.0, execution);

        emit_event(EventLogData::ExecutionFlagged {
            execution_id,
            flagger: &caller,
        });
        self.charge_storage(storage_before);
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
        self.blocked_principals
            .get(&account)
            .copied()
            .unwrap_or(false)
    }

    pub fn get_permission_usage(&self, permission_id: U64) -> PermissionUsage {
        self.permission_usage
            .get(&permission_id.0)
            .cloned()
            .unwrap_or_default()
    }

    pub fn get_asset_ledger(&self, asset: AssetId) -> Option<AssetLedger> {
        self.asset_ledgers.get(&asset).cloned()
    }

    pub fn get_registered_assets(&self) -> Vec<AssetId> {
        self.registered_assets.iter().cloned().collect()
    }

    /// Unspent lifetime budget allocated to immediate children; optional path child
    /// excludes that branch when evaluating a descendant's payment.
    pub fn get_reserved_budget(&self, permission_id: U64, asset: AssetId, exclude_child: Option<U64>) -> U128 {
        U128(self.reserved_budget(permission_id.0, &asset, exclude_child.map(|id| id.0), env::block_timestamp_ms()))
    }

    pub fn get_usage(&self, permission_id: U64, asset: AssetId, scope: BudgetScope) -> Usage {
        let key = BudgetKey {
            permission_id: permission_id.0,
            asset,
            scope,
        };
        self.usage.get(&key).cloned().unwrap_or_default()
    }

    pub fn get_execution(&self, execution_id: U64) -> Option<Execution> {
        self.executions.get(&execution_id.0).cloned()
    }

    pub fn get_execution_by_request(
        &self,
        actor: AccountId,
        request_id: String,
    ) -> Option<Execution> {
        let id_bytes = parse_request_id(&request_id).ok()?;
        let exec_id = self.replay_map.get(&(actor, id_bytes)).copied()?;
        self.executions.get(&exec_id).cloned()
    }

    pub fn get_approval(
        &self,
        request_hash: String,
        permission_id: U64,
        asset: AssetId,
    ) -> Option<ApprovalRecord> {
        let hash_bytes = parse_request_id(&request_hash).ok()?;
        let key = ApprovalKey {
            request_hash: hash_bytes,
            permission_id: permission_id.0,
            asset,
        };
        self.approvals.get(&key).cloned()
    }

    pub fn preview_execute(&self, actor: AccountId, request: ExecuteRequest) -> PreviewResult {
        let requested_amount = request.action.amount();
        let default_fail = |code: &'static str, msg: &str| PreviewResult {
            allowed: false,
            error_code: Some(code.to_string()),
            error_message: Some(msg.to_string()),
            required_approver: None,
            offending_permission_id: None,
            requested_amount: U128(requested_amount),
            available_budget: None,
        };

        if self.config.paused {
            return default_fail(ERR_PAUSED, "Treasury is paused");
        }
        if self.is_principal_blocked(actor.clone()) {
            return default_fail(ERR_PRINCIPAL_BLOCKED, "Actor is blocked");
        }
        if request.api_version != 1 {
            return default_fail(ERR_INVALID_INPUT, "Unsupported API version");
        }
        let now_ms = env::block_timestamp_ms();
        if now_ms >= request.deadline_ms.0 {
            return default_fail(ERR_DEADLINE_EXPIRED, "Request deadline expired");
        }
        if requested_amount == 0 {
            return default_fail(ERR_INVALID_INPUT, "Amount must be positive");
        }
        if request.action.receiver() == &env::current_account_id() {
            return default_fail(ERR_INVALID_INPUT, "Recipient cannot be treasury contract");
        }

        let asset = request.action.asset();
        let ledger = match self.asset_ledgers.get(asset) {
            Some(l) => l,
            None => return default_fail(ERR_ASSET_DISABLED, "Asset is not registered"),
        };
        if !ledger.enabled {
            return default_fail(ERR_ASSET_DISABLED, "Asset is disabled");
        }
        if ledger.available.0 < requested_amount {
            return PreviewResult {
                allowed: false,
                error_code: Some(ERR_INSUFFICIENT_AVAILABLE_FUNDS.to_string()),
                error_message: Some("Insufficient available funds in treasury ledger".to_string()),
                required_approver: None,
                offending_permission_id: None,
                requested_amount: U128(requested_amount),
                available_budget: Some(ledger.available),
            };
        }

        let path = match self.load_path_internal(request.permission_id.0) {
            Ok(p) => p,
            Err(e) => return default_fail(e, "Invalid permission path"),
        };

        for perm in &path {
            if self.is_principal_blocked(perm.issuer.clone())
                || self.is_principal_blocked(perm.delegate.clone())
            {
                return default_fail(ERR_PRINCIPAL_BLOCKED, "Ancestor principal is blocked");
            }
        }

        let ctx = crate::policy::PathEvaluationContext {
            now_ms,
            current_epoch: self.config.authority_epoch.0,
            action: &request.action,
            leaf_actor: &actor,
            path: &path,
        };

        let outcome = match crate::policy::evaluate_path_pure(
            &ctx,
            |k| self.usage.get(k).cloned().unwrap_or_default(),
            |pid| self.permission_usage.get(&pid).cloned().unwrap_or_default(),
        ) {
            Ok(o) => o,
            Err(e) => return default_fail(e, "Policy limit exceeded"),
        };

        if let Err(error) = self.check_allocated_budget(&path, &asset, request.action.amount(), now_ms) {
            return default_fail(error, "Funds are allocated to child permissions");
        }

        let (_req_id, hash) = match crate::canonical::compute_execute_hash(
            &self.request_domain(),
            &env::current_account_id(),
            &actor,
            &request,
        ) {
            Ok(h) => h,
            Err(e) => return default_fail(e, "Invalid request ID or serialization"),
        };

        // Check approvals
        for (perm_id, approver) in &outcome.required_approvals {
            let app_key = ApprovalKey {
                request_hash: hash,
                permission_id: *perm_id,
                asset: asset.clone(),
            };
            match self.approvals.get(&app_key) {
                Some(app) => {
                    if &app.approver != approver || now_ms >= app.expires_at_ms.0 {
                        return PreviewResult {
                            allowed: false,
                            error_code: Some(ERR_APPROVAL_REQUIRED.to_string()),
                            error_message: Some("Approval expired or invalid".to_string()),
                            required_approver: Some(approver.clone()),
                            offending_permission_id: Some(U64(*perm_id)),
                            requested_amount: U128(requested_amount),
                            available_budget: None,
                        };
                    }
                }
                None => {
                    return PreviewResult {
                        allowed: false,
                        error_code: Some(ERR_APPROVAL_REQUIRED.to_string()),
                        error_message: Some("Required approval not yet recorded".to_string()),
                        required_approver: Some(approver.clone()),
                        offending_permission_id: Some(U64(*perm_id)),
                        requested_amount: U128(requested_amount),
                        available_budget: None,
                    };
                }
            }
        }

        PreviewResult {
            allowed: true,
            error_code: None,
            error_message: None,
            required_approver: None,
            offending_permission_id: None,
            requested_amount: U128(requested_amount),
            available_budget: Some(ledger.available),
        }
    }
}

// --- Internal Helper Methods (not exposed to NEAR RPC) ---
impl TreasuryContract {
    pub fn request_domain(&self) -> String {
        #[cfg(feature = "shared-engine")]
        if let Some(id) = &self.company_context {
            return format!("{}:company:{}", self.config.network_domain, id);
        }
        self.config.network_domain.clone()
    }

    fn callback_args(&self, execution_id: u64) -> serde_json::Value {
        #[allow(unused_mut)]
        let mut args = serde_json::json!({"execution_id": U64(execution_id)});
        #[cfg(feature = "shared-engine")]
        if let Some(id) = &self.company_context {
            args["company_id"] = serde_json::json!(id);
        }
        args
    }

    fn assert_input_bound(&self) {
        if env::input().is_some_and(|input| input.len() > crate::policy::MAX_SERIALIZED_INPUT_BYTES)
        {
            env::panic_str(ERR_INPUT_TOO_LARGE);
        }
    }

    pub fn flush_collections(&mut self) {
        self.permissions.flush();
        self.blocked_principals.flush();
        self.usage.flush();
        self.permission_usage.flush();
        self.asset_ledgers.flush();
        self.registered_assets.flush();
        self.executions.flush();
        self.replay_map.flush();
        self.approvals.flush();
        self.permission_children.flush();
    }

    fn storage_checkpoint(&mut self) -> u64 {
        self.flush_collections();
        env::storage_usage()
            .checked_add(borsh::to_vec(self).unwrap().len() as u64)
            .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW))
    }

    fn charge_storage(&mut self, before: u64) {
        let after = self.storage_checkpoint();
        let cost = u128::from(after.saturating_sub(before))
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW));
        self.config.storage_funding_remaining = U128(
            self.config
                .storage_funding_remaining
                .0
                .checked_sub(cost)
                .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW)),
        );
        // Freed storage is conservative surplus, never automatically credited as principal.
        if after > before {
            self.assert_physical_solvency(0);
        }
    }

    fn callback_storage_cost(&self) -> u128 {
        // None -> Some(String), including length prefix and the fixed failure code.
        (4 + ERR_EXECUTION_FAILED.len() as u128)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW))
    }

    fn reserve_callback_storage(&mut self) {
        let cost = self.callback_storage_cost();
        self.config.storage_funding_remaining = U128(
            self.config
                .storage_funding_remaining
                .0
                .checked_sub(cost)
                .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW)),
        );
        self.config.callback_storage_reserved = U128(
            self.config
                .callback_storage_reserved
                .0
                .checked_add(cost)
                .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW)),
        );
    }

    fn assert_physical_solvency(&self, extra_outgoing: u128) {
        #[cfg(feature = "shared-engine")]
        if self.company_context.is_some() {
            return;
        }
        // env::storage_usage still includes the prior STATE representation until
        // near-sdk writes the new state after this method returns.
        let state_len = borsh::to_vec(self).unwrap().len() as u64;
        let old_state = env::storage_read(b"STATE");
        let projected_bytes = env::storage_usage()
            .checked_sub(old_state.as_ref().map_or(0, |bytes| bytes.len() as u64))
            .and_then(|bytes| bytes.checked_add(state_len))
            .and_then(|bytes| bytes.checked_add(if old_state.is_none() { 5 } else { 0 }))
            .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW));
        let storage = u128::from(projected_bytes)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .unwrap_or_else(|| env::panic_str(ERR_STORAGE_RESERVE_LOW));
        let principal = self
            .asset_ledgers
            .get(&AssetId::NativeNear)
            .map_or(0, |ledger| ledger.available.0);
        let required = [
            storage,
            self.config.storage_funding_remaining.0,
            self.config.callback_storage_reserved.0,
            self.config
                .operating_budget_remaining
                .0
                .max(self.config.min_operating_reserve.0),
            principal,
            extra_outgoing,
        ]
        .into_iter()
        .try_fold(0u128, |sum, value| sum.checked_add(value))
        .unwrap_or_else(|| env::panic_str(ERR_INSUFFICIENT_AVAILABLE_FUNDS));
        if env::account_balance().as_yoctonear() < required {
            env::panic_str(ERR_INSUFFICIENT_AVAILABLE_FUNDS);
        }
    }

    fn prepare_dispatch(&mut self, asset: &AssetId, amount: u128) {
        let required = self
            .config
            .transfer_gas
            .as_gas()
            .checked_add(self.config.callback_gas.as_gas())
            .and_then(|gas| gas.checked_add(Gas::from_tgas(2).as_gas()))
            .unwrap_or_else(|| env::panic_str(ERR_INSUFFICIENT_GAS));
        if env::prepaid_gas()
            .as_gas()
            .saturating_sub(env::used_gas().as_gas())
            < required
        {
            env::panic_str(ERR_INSUFFICIENT_GAS);
        }
        match asset {
            AssetId::NativeNear => self.assert_physical_solvency(amount),
            AssetId::Nep141(_) => {
                self.config.operating_budget_remaining = U128(
                    self.config
                        .operating_budget_remaining
                        .0
                        .checked_sub(1)
                        .unwrap_or_else(|| env::panic_str(ERR_OPERATING_RESERVE_LOW)),
                );
                self.assert_physical_solvency(1);
            }
        }
    }

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

    fn dispatch_action_promise(
        &self,
        asset: &AssetId,
        receiver: &AccountId,
        amount: u128,
        execution_id: u64,
    ) {
        let args = self.callback_args(execution_id);
        let callback = Promise::new(env::current_account_id()).function_call(
            "on_transfer_result",
            serde_json::to_vec(&args).unwrap(),
            NearToken::from_yoctonear(0),
            self.config.callback_gas,
        );
        match asset {
            AssetId::NativeNear => {
                let _ = Promise::new(receiver.clone())
                    .transfer(NearToken::from_yoctonear(amount))
                    .then(callback);
            }
            AssetId::Nep141(contract_id) => {
                let _ = ext_ft::ext(contract_id.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(self.config.transfer_gas)
                    .ft_transfer(receiver.clone(), U128(amount), None)
                    .then(callback);
            }
        }
    }
}

pub fn asset_to_string(asset: &AssetId) -> String {
    match asset {
        AssetId::NativeNear => "native_near".to_string(),
        AssetId::Nep141(id) => id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn funded_contract(config: InitConfig) -> TreasuryContract {
        let mut contract = TreasuryContract::new(config);
        contract.config.storage_funding_remaining = U128(10u128.pow(24));
        contract.config.operating_budget_remaining = U128(10u128.pow(23));
        contract
    }

    fn get_context(predecessor: AccountId) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .block_timestamp(1_000_000 * 1_000_000); // 1,000,000 ms
        builder
    }

    fn sample_rule(asset: AssetId) -> AssetRule {
        AssetRule {
            asset,
            recipients: Recipients::Any,
            min_per_action: None,
            max_per_action: Some(U128(500)),
            lifetime_limit: Some(U128(2000)),
            fixed_window: None,
            streaming: None,
            approval: None,
            acknowledge_unbounded_budget: false,
        }
    }

    #[test]
    fn global_factory_initial_funding_covers_state_and_operating_floor() {
        let mut context = get_context(accounts(1));
        // Global code is a small reference, not a local WASM allocation.
        context
            .account_balance(NearToken::from_millinear(200))
            .storage_usage(500);
        testing_env!(context.build());
        let contract = TreasuryContract::new(InitConfig {
            network_domain: "near:testnet".into(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });
        assert_eq!(contract.get_config().owner, accounts(1));
        assert_eq!(
            contract
                .get_asset_ledger(AssetId::NativeNear)
                .unwrap()
                .available
                .0,
            0
        );
    }

    #[test]
    fn test_init_state() {
        let context = get_context(accounts(1));
        testing_env!(context.build());

        let contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        let config = contract.get_config();
        assert_eq!(config.owner, accounts(1));
        assert_eq!(config.authority_epoch.0, 1);
        assert!(!config.paused);

        let near_ledger = contract.get_asset_ledger(AssetId::NativeNear).unwrap();
        assert!(near_ledger.enabled);
        assert_eq!(near_ledger.available.0, 0);
    }

    #[test]
    fn test_create_root_permission_success() {
        let context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        let spec = PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(10),
            rules: vec![sample_rule(AssetId::NativeNear)],
            redelegation_depth: 2,
            metadata_hash: None,
        };

        let perm_id = contract.create_root_permission(spec);
        assert_eq!(perm_id.0, 1);

        let perm = contract.get_permission(perm_id).unwrap();
        assert_eq!(perm.issuer, accounts(1));
        assert_eq!(perm.delegate, accounts(2));
        assert_eq!(perm.depth, 0);
        assert_eq!(perm.redelegation_depth, 2);
    }

    #[test]
    fn test_create_child_permission_success() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        let root_spec = PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(10),
            rules: vec![sample_rule(AssetId::NativeNear)],
            redelegation_depth: 2,
            metadata_hash: None,
        };
        let root_id = contract.create_root_permission(root_spec);

        // Switch caller to delegate accounts(2)
        testing_env!(context.predecessor_account_id(accounts(2)).build());

        let child_spec = PermissionSpec {
            delegate: accounts(3),
            valid_from_ms: U64(600_000),
            expires_at_ms: Some(U64(1_500_000)),
            max_executions: Some(5),
            rules: vec![sample_rule(AssetId::NativeNear)],
            redelegation_depth: 1,
            metadata_hash: None,
        };

        let child_id = contract.create_child_permission(root_id, child_spec);
        assert_eq!(child_id.0, 2);

        let child = contract.get_permission(child_id).unwrap();
        assert_eq!(child.parent_id, Some(root_id));
        assert_eq!(child.issuer, accounts(2));
        assert_eq!(child.delegate, accounts(3));
        assert_eq!(child.depth, 1);
        assert_eq!(child.redelegation_depth, 1);

        let path = contract.get_permission_path(child_id);
        assert_eq!(path.len(), 2);
        assert_eq!(path[0].id.0, 2);
        assert_eq!(path[1].id.0, 1);
    }

    #[test]
    fn test_revocation_by_manager() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        let root_id = contract.create_root_permission(PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: None,
            rules: vec![sample_rule(AssetId::NativeNear)],
            redelegation_depth: 1,
            metadata_hash: None,
        });

        testing_env!(context.predecessor_account_id(accounts(2)).build());
        let child_id = contract.create_child_permission(
            root_id,
            PermissionSpec {
                delegate: accounts(3),
                valid_from_ms: U64(500_000),
                expires_at_ms: Some(U64(2_000_000)),
                max_executions: None,
                rules: vec![sample_rule(AssetId::NativeNear)],
                redelegation_depth: 0,
                metadata_hash: None,
            },
        );

        // Ancestor accounts(2) revokes child_id
        contract.revoke_permission(child_id);

        let child = contract.get_permission(child_id).unwrap();
        assert!(child.revoked);

        // Calling revoke again is idempotent
        contract.revoke_permission(child_id);
    }

    #[test]
    fn test_pause_and_block_principal() {
        let context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        contract.set_paused(true);
        assert!(contract.get_config().paused);

        contract.set_principal_blocked(accounts(3), true);
        assert!(contract.is_principal_blocked(accounts(3)));
        contract.set_principal_blocked(accounts(3), false);
        assert!(!contract.is_principal_blocked(accounts(3)));
    }

    #[test]
    fn test_invalidate_all_permissions() {
        let context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        assert_eq!(contract.get_config().authority_epoch.0, 1);
        contract.invalidate_all_permissions();
        assert_eq!(contract.get_config().authority_epoch.0, 2);
    }

    #[test]
    fn test_deposit_native_and_top_ups() {
        let mut context = get_context(accounts(2));
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(1_000_000))
            .build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        contract.deposit_native();
        let ledger = contract.get_asset_ledger(AssetId::NativeNear).unwrap();
        assert_eq!(ledger.available.0, 1_000_000);

        contract.top_up_operating();
        assert_eq!(
            contract.get_config().operating_budget_remaining.0,
            10u128.pow(23) + 1_000_000
        );

        contract.top_up_storage();
        assert_eq!(
            contract.get_config().storage_funding_remaining.0,
            10u128.pow(24) + 1_000_000
        );
    }

    #[test]
    fn test_asset_registration_and_ft_deposit() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        let ft_asset = AssetId::Nep141(accounts(4));
        contract.register_asset(ft_asset.clone());
        assert!(!contract.get_asset_ledger(ft_asset.clone()).unwrap().enabled);

        contract.set_asset_enabled(ft_asset.clone(), true);
        assert!(contract.get_asset_ledger(ft_asset.clone()).unwrap().enabled);

        // FT deposit from ft token contract accounts(4)
        testing_env!(context.predecessor_account_id(accounts(4)).build());
        let unspent = contract.ft_on_transfer(accounts(2), U128(50_000), "".to_string());
        assert_eq!(unspent.0, 0);

        let ledger = contract.get_asset_ledger(ft_asset).unwrap();
        assert_eq!(ledger.available.0, 50_000);
    }

    #[test]
    fn test_ownership_handover() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        contract.nominate_owner(accounts(2));
        assert_eq!(contract.get_config().pending_owner, Some(accounts(2)));

        // Nominee accounts(2) accepts
        testing_env!(context.predecessor_account_id(accounts(2)).build());
        contract.accept_ownership();

        let cfg = contract.get_config();
        assert_eq!(cfg.owner, accounts(2));
        assert_eq!(cfg.pending_owner, None);
        assert_eq!(cfg.authority_epoch.0, 2); // Epoch advanced!
    }

    #[test]
    fn test_approvals_workflow() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        // Create root with approval rule: approver is accounts(3), above 200
        let root_spec = PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: Some(U128(1000)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: Some(ApprovalRule {
                    approver: accounts(3),
                    above_amount: U128(200),
                }),
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        };
        let root_id = contract.create_root_permission(root_spec);

        let req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(300),
            },
            deadline_ms: U64(1_500_000),
        };

        // Approver accounts(3) approves
        testing_env!(context.predecessor_account_id(accounts(3)).build());
        contract.approve_request(accounts(2), req.clone());

        let (_req_id, req_hash) =
            crate::canonical::compute_execute_hash("testnet", &accounts(0), &accounts(2), &req)
                .unwrap();
        let app = contract
            .get_approval(hex::encode(req_hash), root_id, AssetId::NativeNear)
            .unwrap();
        assert_eq!(app.approver, accounts(3));

        // Approver revokes
        contract.revoke_approval(accounts(2), req.clone());
        assert!(contract
            .get_approval(hex::encode(req_hash), root_id, AssetId::NativeNear)
            .is_none());
    }

    #[test]
    fn test_preview_execute_flows() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        // Fund the treasury
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(10_000))
            .build());
        contract.deposit_native();
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());

        // Create root permission for accounts(2)
        let root_id = contract.create_root_permission(PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(5),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![accounts(4)]),
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(500)),
                lifetime_limit: Some(U128(1500)),
                fixed_window: None,
                streaming: None,
                approval: Some(ApprovalRule {
                    approver: accounts(3),
                    above_amount: U128(100),
                }),
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        });

        // 1. Preview valid small request (<= 100, no approval needed)
        let small_req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(80),
            },
            deadline_ms: U64(1_500_000),
        };
        let preview = contract.preview_execute(accounts(2), small_req);
        assert!(preview.allowed);
        assert!(preview.error_code.is_none());

        // 2. Preview large request (> 100, approval needed but not recorded yet)
        let large_req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f21"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(250),
            },
            deadline_ms: U64(1_500_000),
        };
        let preview = contract.preview_execute(accounts(2), large_req.clone());
        assert!(!preview.allowed);
        assert_eq!(preview.error_code, Some(ERR_APPROVAL_REQUIRED.to_string()));
        assert_eq!(preview.required_approver, Some(accounts(3)));

        // Approver approves large request
        testing_env!(context.predecessor_account_id(accounts(3)).build());
        contract.approve_request(accounts(2), large_req.clone());

        // Now preview of large request is allowed
        let preview = contract.preview_execute(accounts(2), large_req);
        assert!(preview.allowed);

        // 3. Preview recipient not allowed
        let invalid_rcpt_req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f22"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(5), // accounts(5) is not allowed
                amount: U128(50),
            },
            deadline_ms: U64(1_500_000),
        };
        let preview = contract.preview_execute(accounts(2), invalid_rcpt_req);
        assert!(!preview.allowed);
        assert_eq!(
            preview.error_code,
            Some(ERR_RECIPIENT_NOT_ALLOWED.to_string())
        );
    }

    #[test]
    fn test_execute_native_and_replay_idempotency() {
        let mut context = get_context(accounts(1));
        context.account_balance(NearToken::from_yoctonear(
            100_000_000_000_000_000_000_000_000,
        ));
        context.prepaid_gas(Gas::from_tgas(100));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        // Deposit funds
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(10_000))
            .build());
        contract.deposit_native();
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());

        let root_id = contract.create_root_permission(PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(5),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: Some(U128(1000)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        });

        let req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(300),
            },
            deadline_ms: U64(1_500_000),
        };

        // Delegate accounts(2) calls execute with zero attached deposit
        testing_env!(context
            .predecessor_account_id(accounts(2))
            .attached_deposit(NearToken::from_yoctonear(0))
            .prepaid_gas(Gas::from_tgas(100))
            .build());

        let exec_id = contract.execute(req.clone());
        assert_eq!(exec_id.0, 1);

        // Verify ledger state
        let ledger = contract.get_asset_ledger(AssetId::NativeNear).unwrap();
        assert_eq!(ledger.available.0, 9_700);
        assert_eq!(ledger.pending_outgoing.0, 300);

        // Verify pending usage
        let usage = contract.get_usage(root_id, AssetId::NativeNear, BudgetScope::Lifetime);
        assert_eq!(usage.pending.0, 300);
        assert_eq!(usage.settled.0, 0);

        // Verify execution usage count
        let perm_usage = contract.get_permission_usage(root_id);
        assert_eq!(perm_usage.executions_count, 1);

        // Verify replay returns existing ID
        let replay_id = contract.execute(req.clone());
        assert_eq!(replay_id.0, 1);

        // Same request_id with different payload must fail with ERR_REQUEST_ID_CONFLICT
        let conflict_req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(400), // modified amount!
            },
            deadline_ms: U64(1_500_000),
        };

        let conflict_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut contract_clone = contract;
            contract_clone.execute(conflict_req);
        }));
        assert!(conflict_result.is_err());
    }

    #[test]
    fn test_owner_withdraw_and_replay() {
        let mut context = get_context(accounts(1));
        context.account_balance(NearToken::from_yoctonear(
            100_000_000_000_000_000_000_000_000,
        ));
        context.prepaid_gas(Gas::from_tgas(100));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        // Deposit funds
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(10_000))
            .build());
        contract.deposit_native();
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());

        let req = OwnerWithdrawRequest {
            api_version: 1,
            request_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                .to_string(),
            authority_epoch: U64(1),
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(5),
                amount: U128(2000),
            },
            deadline_ms: U64(1_500_000),
        };

        testing_env!(context
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(0))
            .prepaid_gas(Gas::from_tgas(100))
            .build());

        let exec_id = contract.owner_withdraw(req.clone());
        assert_eq!(exec_id.0, 1);

        let ledger = contract.get_asset_ledger(AssetId::NativeNear).unwrap();
        assert_eq!(ledger.available.0, 8_000);
        assert_eq!(ledger.pending_outgoing.0, 2_000);

        // Replay returns same ID
        let replay_id = contract.owner_withdraw(req.clone());
        assert_eq!(replay_id.0, 1);
        contract.set_paused(true);
        contract.invalidate_all_permissions();
        contract.nominate_owner(accounts(3));
        testing_env!(context.predecessor_account_id(accounts(3)).build());
        contract.accept_ownership();
        testing_env!(context.predecessor_account_id(accounts(1)).build());
        assert_eq!(contract.owner_withdraw(req).0, 1);
        assert_eq!(contract.config.pending_execution_count, 1);
    }

    #[test]
    #[allow(deprecated)]
    fn test_callback_settlement_success_and_failure() {
        let mut context = get_context(accounts(1));
        context.account_balance(NearToken::from_yoctonear(
            100_000_000_000_000_000_000_000_000,
        ));
        context.prepaid_gas(Gas::from_tgas(100));
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(10_000))
            .build());
        contract.deposit_native();
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());

        let root_id = contract.create_root_permission(PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(5),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: Some(U128(1000)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        });

        // 1. Dispatch execution 1
        let req1 = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(400),
            },
            deadline_ms: U64(1_500_000),
        };
        testing_env!(context.predecessor_account_id(accounts(2)).build());
        let exec_id_1 = contract.execute(req1);
        assert_eq!(exec_id_1.0, 1);

        // Predecessor must be accounts(0) (contract itself) for private callback
        context.predecessor_account_id(accounts(0));
        near_sdk::test_utils::testing_env_with_promise_results(
            context.build(),
            near_sdk::PromiseResult::Successful(vec![]),
        );

        near_sdk::test_utils::testing_env_with_promise_results(
            context.build(),
            near_sdk::PromiseResult::Successful(vec![0; 4097]),
        );
        let unknown = contract.on_transfer_result(exec_id_1);
        assert_eq!(unknown.status, ExecutionStatus::Pending);
        assert!(unknown.needs_reconciliation);
        assert!(contract.config.callback_storage_reserved.0 > 0);
        assert_eq!(
            contract
                .get_usage(root_id, AssetId::NativeNear, BudgetScope::Lifetime)
                .pending
                .0,
            400
        );
        assert_eq!(
            contract
                .get_asset_ledger(AssetId::NativeNear)
                .unwrap()
                .available
                .0,
            9_600
        );
        near_sdk::test_utils::testing_env_with_promise_results(
            context.build(),
            near_sdk::PromiseResult::Successful(vec![]),
        );
        let res1 = contract.on_transfer_result(exec_id_1);
        assert_eq!(res1.status, ExecutionStatus::Succeeded);
        let count = contract.config.pending_execution_count;
        contract.on_transfer_result(exec_id_1);
        assert_eq!(contract.config.pending_execution_count, count);

        // Verify usage: pending is 0, settled is 400
        let u1 = contract.get_usage(root_id, AssetId::NativeNear, BudgetScope::Lifetime);
        assert_eq!(u1.pending.0, 0);
        assert_eq!(u1.settled.0, 400);

        // Verify ledger: pending_outgoing is 0, available is 9,600
        let l1 = contract.get_asset_ledger(AssetId::NativeNear).unwrap();
        assert_eq!(l1.pending_outgoing.0, 0);
        assert_eq!(l1.available.0, 9_600);

        // 2. Dispatch execution 2 and simulate failure
        let req2 = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f21"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(600),
            },
            deadline_ms: U64(1_500_000),
        };
        testing_env!(context.predecessor_account_id(accounts(2)).build());
        let exec_id_2 = contract.execute(req2);
        assert_eq!(exec_id_2.0, 2);

        // Simulate failure on callback
        context.predecessor_account_id(accounts(0));
        near_sdk::test_utils::testing_env_with_promise_results(
            context.build(),
            near_sdk::PromiseResult::Failed,
        );

        let res2 = contract.on_transfer_result(exec_id_2);
        assert_eq!(res2.status, ExecutionStatus::Failed);

        // Verify reservations released (pending is 0, settled remains 400)
        let u2 = contract.get_usage(root_id, AssetId::NativeNear, BudgetScope::Lifetime);
        assert_eq!(u2.pending.0, 0);
        assert_eq!(u2.settled.0, 400);

        // Verify principal restored: available restored back to 9,600, pending_outgoing is 0
        let l2 = contract.get_asset_ledger(AssetId::NativeNear).unwrap();
        assert_eq!(l2.pending_outgoing.0, 0);
        assert_eq!(l2.available.0, 9_600);
        assert_eq!(contract.config.callback_storage_reserved.0, 0);
    }

    #[test]
    fn test_flag_unresolved() {
        let mut context = get_context(accounts(1));
        context.account_balance(NearToken::from_yoctonear(
            100_000_000_000_000_000_000_000_000,
        ));
        context.prepaid_gas(Gas::from_tgas(100));
        context.block_timestamp(1_000_000 * 1_000_000); // 1,000,000 ms
        testing_env!(context.build());

        let mut contract = funded_contract(InitConfig {
            network_domain: "testnet".to_string(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        });

        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(10_000))
            .build());
        contract.deposit_native();
        testing_env!(context
            .attached_deposit(NearToken::from_yoctonear(0))
            .build());

        let root_id = contract.create_root_permission(PermissionSpec {
            delegate: accounts(2),
            valid_from_ms: U64(500_000),
            expires_at_ms: Some(U64(3_000_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: None,
                max_per_action: Some(U128(1000)),
                lifetime_limit: Some(U128(5000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        });

        let req = ExecuteRequest {
            api_version: 1,
            request_id: "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
                .to_string(),
            permission_id: root_id,
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(200),
            },
            deadline_ms: U64(2_500_000),
        };

        testing_env!(context.predecessor_account_id(accounts(2)).build());
        let exec_id = contract.execute(req);

        // Advance block timestamp by 11 minutes (660,000 ms)
        testing_env!(context
            .block_timestamp((1_000_000 + 660_000) * 1_000_000)
            .predecessor_account_id(accounts(5))
            .build());
        contract.flag_unresolved(exec_id);

        let exec = contract.get_execution(exec_id).unwrap();
        assert!(exec.needs_reconciliation);
    }
    fn default_config() -> InitConfig {
        InitConfig {
            network_domain: "near:testnet".into(),
            owner: accounts(1),
            max_total_permissions: None,
            max_pending_executions: None,
            min_operating_reserve: None,
            callback_gas: None,
            transfer_gas: None,
        }
    }

    #[test]
    fn execution_json_matches_sdk_fixture() {
        let json = include_str!("../../../../docs/delegation/fixtures/execution.json");
        let execution: Execution = near_sdk::serde_json::from_str(json).unwrap();
        assert_eq!(
            execution.reservations[0].budget_key.permission_id,
            9_007_199_254_740_993
        );
        assert_eq!(
            near_sdk::serde_json::to_value(execution).unwrap(),
            near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(json).unwrap()
        );
    }

    #[test]
    fn persistent_growth_charges_storage_pool() {
        testing_env!(get_context(accounts(1)).build());
        let mut contract = funded_contract(default_config());
        let before = contract.config.storage_funding_remaining.0;
        contract.set_principal_blocked(accounts(2), true);
        assert!(contract.config.storage_funding_remaining.0 < before);
        let charged = contract.config.storage_funding_remaining.0;
        contract.set_principal_blocked(accounts(2), false);
        assert_eq!(contract.config.storage_funding_remaining.0, charged);
    }

    #[test]
    #[should_panic(expected = "ALLOCARD_STORAGE_RESERVE_LOW")]
    fn unfunded_storage_cannot_borrow_principal() {
        testing_env!(get_context(accounts(1)).build());
        let mut contract = TreasuryContract::new(default_config());
        contract.set_principal_blocked(accounts(2), true);
    }

    #[test]
    fn token_marker_debits_operating_pool() {
        testing_env!(get_context(accounts(1)).build());
        let mut contract = funded_contract(default_config());
        let before = contract.config.operating_budget_remaining.0;
        contract.prepare_dispatch(&AssetId::Nep141(accounts(3)), 100);
        assert_eq!(contract.config.operating_budget_remaining.0, before - 1);
        assert_eq!(
            contract
                .get_asset_ledger(AssetId::NativeNear)
                .unwrap()
                .available
                .0,
            0
        );
    }

    #[test]
    #[should_panic(expected = "ALLOCARD_OPERATING_RESERVE_LOW")]
    fn token_dispatch_rejects_empty_operating_pool() {
        testing_env!(get_context(accounts(1)).build());
        let mut contract = funded_contract(default_config());
        contract.config.operating_budget_remaining = U128(0);
        contract.prepare_dispatch(&AssetId::Nep141(accounts(3)), 100);
    }

    #[test]
    #[should_panic(expected = "ALLOCARD_INSUFFICIENT_AVAILABLE_FUNDS")]
    fn native_dispatch_preserves_unspent_storage_funding() {
        let mut context = get_context(accounts(1));
        testing_env!(context.build());
        let mut contract = funded_contract(default_config());
        context.account_balance(NearToken::from_near(1));
        testing_env!(context.build());
        contract.prepare_dispatch(&AssetId::NativeNear, 1);
    }

    #[test]
    #[should_panic(expected = "ALLOCARD_INPUT_TOO_LARGE")]
    fn execute_rejects_oversized_input() {
        let mut context = get_context(accounts(1));
        context.context.input = vec![0; 8193].into();
        testing_env!(context.build());
        let contract = funded_contract(default_config());
        contract.assert_input_bound();
    }
}

#[cfg(not(feature = "shared-engine"))]
#[near]
impl TreasuryContract {
    #[init]
    pub fn new(config: InitConfig) -> Self {
        assert!(!env::state_exists(), "Contract is already initialized");
        Self::build(config, None)
    }
    #[payable]
    pub fn deposit_native(&mut self) {
        self.deposit_native_inner()
    }
    #[payable]
    pub fn top_up_operating(&mut self) {
        self.top_up_operating_inner()
    }
    #[payable]
    pub fn top_up_storage(&mut self) {
        self.top_up_storage_inner()
    }
    #[private]
    pub fn on_transfer_result(&mut self, execution_id: U64) -> Execution {
        self.on_transfer_result_inner(execution_id)
    }
}

#[cfg(feature = "shared-engine")]
impl TreasuryContract {
    pub fn new(config: InitConfig) -> Self {
        assert!(!env::state_exists(), "Contract is already initialized");
        Self::build(config, None)
    }
    pub fn new_shared(config: InitConfig, company_id: String) -> Self {
        Self::build(config, Some(company_id))
    }
    pub fn deposit_native(&mut self) {
        self.deposit_native_inner()
    }
    pub fn top_up_operating(&mut self) {
        self.top_up_operating_inner()
    }
    pub fn top_up_storage(&mut self) {
        self.top_up_storage_inner()
    }
    pub fn on_transfer_result(&mut self, execution_id: U64) -> Execution {
        self.on_transfer_result_inner(execution_id)
    }
}

impl TreasuryContract {
    fn deposit_native_inner(&mut self) {
        let storage_before = self.storage_checkpoint();
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit == 0 {
            env::panic_str(ERR_INVALID_INPUT);
        }

        let mut ledger = self
            .asset_ledgers
            .get(&AssetId::NativeNear)
            .cloned()
            .unwrap_or_default();

        ledger.available = U128(
            ledger
                .available
                .0
                .checked_add(deposit)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT)),
        );
        self.asset_ledgers.insert(AssetId::NativeNear, ledger);

        let sender = env::predecessor_account_id();
        emit_event(EventLogData::TreasuryDeposit {
            asset: "native_near",
            sender: &sender,
            amount: U128(deposit),
        });
        self.charge_storage(storage_before);
    }
    fn top_up_operating_inner(&mut self) {
        let storage_before = self.storage_checkpoint();
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit == 0 {
            env::panic_str(ERR_INVALID_INPUT);
        }
        self.config.operating_budget_remaining = U128(
            self.config
                .operating_budget_remaining
                .0
                .checked_add(deposit)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT)),
        );
        self.charge_storage(storage_before);
    }
    fn top_up_storage_inner(&mut self) {
        let storage_before = self.storage_checkpoint();
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit == 0 {
            env::panic_str(ERR_INVALID_INPUT);
        }
        self.config.storage_funding_remaining = U128(
            self.config
                .storage_funding_remaining
                .0
                .checked_add(deposit)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_INPUT)),
        );
        self.charge_storage(storage_before);
    }
    fn on_transfer_result_inner(&mut self, execution_id: U64) -> Execution {
        if env::promise_results_count() != 1 {
            env::panic_str(ERR_INVALID_CALLBACK);
        }

        let mut execution = self
            .executions
            .get(&execution_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_EXECUTION_NOT_FOUND));

        // If execution is already terminal, return its state without re-mutating
        match execution.status {
            ExecutionStatus::Succeeded | ExecutionStatus::Failed => return execution,
            ExecutionStatus::Pending => {}
        }

        let succeeded = match env::promise_result_checked(0, 4096) {
            Ok(_) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => {
                // A successful receipt with unreadable data is NOT proof of failure.
                execution.needs_reconciliation = true;
                self.executions.insert(execution_id.0, execution.clone());
                return execution;
            }
        };
        execution.needs_reconciliation = false;
        let callback_storage = self.callback_storage_cost();
        self.config.callback_storage_reserved = U128(
            self.config
                .callback_storage_reserved
                .0
                .checked_sub(callback_storage)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
        );

        if succeeded {
            for res in &execution.reservations {
                let mut u = self.usage.get(&res.budget_key).cloned().unwrap_or_default();
                u.pending = U128(
                    u.pending
                        .0
                        .checked_sub(res.amount.0)
                        .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
                );
                u.settled = U128(
                    u.settled
                        .0
                        .checked_add(res.amount.0)
                        .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
                );
                self.usage.insert(res.budget_key.clone(), u);
            }

            if let Some(mut ledger) = self.asset_ledgers.get(execution.action.asset()).cloned() {
                ledger.pending_outgoing = U128(
                    ledger
                        .pending_outgoing
                        .0
                        .checked_sub(execution.action.amount())
                        .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
                );
                self.asset_ledgers
                    .insert(execution.action.asset().clone(), ledger);
            }

            self.config.pending_execution_count = self
                .config
                .pending_execution_count
                .checked_sub(1)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK));
            execution.status = ExecutionStatus::Succeeded;
            self.executions.insert(execution_id.0, execution.clone());

            emit_event(EventLogData::ExecutionSucceeded { execution_id });
        } else {
            // Proven external failure: release reservations without adding settled; restore principal to available
            for res in &execution.reservations {
                let mut u = self.usage.get(&res.budget_key).cloned().unwrap_or_default();
                u.pending = U128(
                    u.pending
                        .0
                        .checked_sub(res.amount.0)
                        .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
                );
                self.usage.insert(res.budget_key.clone(), u);
            }

            if let Some(mut ledger) = self.asset_ledgers.get(execution.action.asset()).cloned() {
                ledger.pending_outgoing = U128(
                    ledger
                        .pending_outgoing
                        .0
                        .checked_sub(execution.action.amount())
                        .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
                );
                ledger.available = U128(
                    ledger
                        .available
                        .0
                        .checked_add(execution.action.amount())
                        .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK)),
                );
                self.asset_ledgers
                    .insert(execution.action.asset().clone(), ledger);
            }

            self.config.pending_execution_count = self
                .config
                .pending_execution_count
                .checked_sub(1)
                .unwrap_or_else(|| env::panic_str(ERR_INVALID_CALLBACK));
            execution.status = ExecutionStatus::Failed;
            execution.failure_code = Some(ERR_EXECUTION_FAILED.to_string());
            self.executions.insert(execution_id.0, execution.clone());

            emit_event(EventLogData::ExecutionFailed {
                execution_id,
                failure_code: ERR_EXECUTION_FAILED,
            });
        }

        execution
    }
}
