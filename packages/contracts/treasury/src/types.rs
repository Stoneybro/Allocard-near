use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, Gas};

pub type PermissionId = u64;
pub type ExecutionId = u64;

/// Supported asset identifiers in Allocard.
#[derive(
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", tag = "type", content = "contract_id")]
pub enum AssetId {
    NativeNear,
    Nep141(AccountId),
}

/// Allowed recipients for an asset transfer.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", tag = "type", content = "accounts")]
pub enum Recipients {
    Any,
    Only(Vec<AccountId>),
}

/// Fixed recurring budget window (half-open interval [anchor + k*duration, anchor + (k+1)*duration)).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct FixedWindowLimit {
    pub limit: U128,
    pub duration_ms: U64,
    pub anchor_ms: U64,
}

/// Continuous linear streaming limit (accrues rate_per_second continuously after start_ms).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct StreamingLimit {
    pub rate_per_second: U128,
    pub start_ms: U64,
    pub max_cap: Option<U128>,
}

/// Explicit approver rule required when transfer amount > above_amount.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ApprovalRule {
    pub approver: AccountId,
    pub above_amount: U128,
}

/// Key used to look up approved requests.
#[derive(
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ApprovalKey {
    #[serde(with = "hex32")]
    pub request_hash: [u8; 32],
    #[serde(with = "decimal_u64")]
    pub permission_id: PermissionId,
    pub asset: AssetId,
}

/// Recorded approval by an authorized approver.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ApprovalRecord {
    pub approver: AccountId,
    pub expires_at_ms: U64,
}

/// Granular asset spending rule within a Permission.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct AssetRule {
    pub asset: AssetId,
    pub recipients: Recipients,
    pub min_per_action: Option<U128>,
    pub max_per_action: Option<U128>,
    pub lifetime_limit: Option<U128>,
    pub fixed_window: Option<FixedWindowLimit>,
    pub streaming: Option<StreamingLimit>,
    pub approval: Option<ApprovalRule>,
    pub acknowledge_unbounded_budget: bool,
}

/// Specification submitted to create a new root or child permission.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct PermissionSpec {
    pub delegate: AccountId,
    pub valid_from_ms: U64,
    pub expires_at_ms: Option<U64>,
    pub max_executions: Option<u32>,
    pub rules: Vec<AssetRule>,
    pub redelegation_depth: u8,
    pub metadata_hash: Option<String>,
}

/// Stored, immutable Permission record.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Permission {
    pub id: U64,
    pub parent_id: Option<U64>,
    pub issuer: AccountId,
    pub delegate: AccountId,
    pub epoch: U64,
    pub depth: u8,
    pub valid_from_ms: U64,
    pub expires_at_ms: Option<U64>,
    pub max_executions: Option<u32>,
    pub rules: Vec<AssetRule>,
    pub redelegation_depth: u8,
    pub revoked: bool,
    #[serde(with = "optional_hex32")]
    pub metadata_hash: Option<[u8; 32]>,
}

/// Budget scope for counter tracking.
#[derive(
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", tag = "type", content = "window_index")]
pub enum BudgetScope {
    Lifetime,
    FixedWindow(#[serde(with = "decimal_u64")] u64),
    Streaming,
}

/// Storage key for budget usage.
#[derive(
    BorshSerialize,
    BorshDeserialize,
    Serialize,
    Deserialize,
    Clone,
    Debug,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct BudgetKey {
    #[serde(with = "decimal_u64")]
    pub permission_id: PermissionId,
    pub asset: AssetId,
    pub scope: BudgetScope,
}

/// Settled and pending financial usage for a specific budget key.
#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Usage {
    pub settled: U128,
    pub pending: U128,
}

/// Execution usage tracking on a Permission (for max_executions limit).
#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct PermissionUsage {
    pub executions_count: u32,
}

/// Treasury balance ledger for an asset.
#[derive(
    BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct AssetLedger {
    pub available: U128,
    pub pending_outgoing: U128,
    pub enabled: bool,
}

/// Executable action within Allocard.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", tag = "type")]
pub enum Action {
    Transfer {
        asset: AssetId,
        receiver: AccountId,
        amount: U128,
    },
}

impl Action {
    pub fn asset(&self) -> &AssetId {
        match self {
            Action::Transfer { asset, .. } => asset,
        }
    }

    pub fn receiver(&self) -> &AccountId {
        match self {
            Action::Transfer { receiver, .. } => receiver,
        }
    }

    pub fn amount(&self) -> u128 {
        match self {
            Action::Transfer { amount, .. } => amount.0,
        }
    }
}

/// Request to execute an action via a delegated Permission.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct ExecuteRequest {
    pub api_version: u16,
    pub request_id: String, // 64 lowercase hex characters
    pub permission_id: U64,
    pub action: Action,
    pub deadline_ms: U64,
}

/// Request for direct treasury withdrawal by the authenticated owner.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct OwnerWithdrawRequest {
    pub api_version: u16,
    pub request_id: String, // 64 lowercase hex characters
    pub authority_epoch: U64,
    pub action: Action,
    pub deadline_ms: U64,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum AuthorityMode {
    Delegated,
    OwnerWithdrawal,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum ExecutionStatus {
    Pending,
    Succeeded,
    Failed,
}

/// Individual budget reservation locked during execution dispatch.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Reservation {
    pub budget_key: BudgetKey,
    pub amount: U128,
}

/// Record of an execution attempt.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Execution {
    pub id: U64,
    pub actor: AccountId,
    #[serde(with = "hex32")]
    pub request_id: [u8; 32],
    #[serde(with = "hex32")]
    pub request_hash: [u8; 32],
    pub authority_mode: AuthorityMode,
    pub permission_id: Option<U64>,
    pub epoch: U64,
    pub action: Action,
    pub created_at_ms: U64,
    pub status: ExecutionStatus,
    pub needs_reconciliation: bool,
    pub reservations: Vec<Reservation>,
    pub failure_code: Option<String>,
}

/// Global treasury configuration and health parameters.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct TreasuryConfig {
    pub schema_version: u16,
    pub network_domain: String,
    pub owner: AccountId,
    pub pending_owner: Option<AccountId>,
    pub authority_epoch: U64,
    pub paused: bool,
    pub next_permission_id: U64,
    pub next_execution_id: U64,
    pub max_total_permissions: u32,
    pub max_pending_executions: u32,
    pub min_operating_reserve: U128,
    pub callback_gas: Gas,
    pub transfer_gas: Gas,
    pub callback_storage_reserved: U128,
    pub storage_funding_remaining: U128,
    pub operating_budget_remaining: U128,
    pub pending_execution_count: u32,
}

/// Configuration arguments passed to contract initialization (`new`).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct InitConfig {
    pub network_domain: String,
    pub owner: AccountId,
    pub max_total_permissions: Option<u32>,
    pub max_pending_executions: Option<u32>,
    pub min_operating_reserve: Option<U128>,
    pub callback_gas: Option<Gas>,
    pub transfer_gas: Option<Gas>,
}

/// Result returned by `preview_execute` view method.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct PreviewResult {
    pub allowed: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub required_approver: Option<AccountId>,
    pub offending_permission_id: Option<U64>,
    pub requested_amount: U128,
    pub available_budget: Option<U128>,
}

// JSON adapters do not alter Borsh state or canonical request hashes.
mod decimal_u64 {
    use near_sdk::serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(near_sdk::serde::de::Error::custom)
    }
}
mod hex32 {
    use near_sdk::serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(value: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&hex::encode(value))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<[u8; 32], D::Error> {
        crate::canonical::parse_request_id(&String::deserialize(deserializer)?)
            .map_err(near_sdk::serde::de::Error::custom)
    }
}
mod optional_hex32 {
    use near_sdk::serde::{Deserialize, Deserializer, Serialize, Serializer};
    pub fn serialize<S: Serializer>(
        value: &Option<[u8; 32]>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.map(hex::encode).serialize(serializer)
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<[u8; 32]>, D::Error> {
        Option::<String>::deserialize(deserializer)?
            .map(|value| {
                crate::canonical::parse_request_id(&value)
                    .map_err(near_sdk::serde::de::Error::custom)
            })
            .transpose()
    }
}
