export type AssetId =
  | { type: "NativeNear" }
  | { type: "Nep141"; contract_id: string };

export type Recipients =
  | { type: "Any" }
  | { type: "Only"; accounts: string[] };

export interface FixedWindowLimit {
  limit: string;
  duration_ms: string;
  anchor_ms: string;
}

export interface StreamingLimit {
  rate_per_second: string;
  start_ms: string;
  max_cap?: string | null;
}

export interface ApprovalRule {
  approver: string;
  above_amount: string;
}

export interface AssetRule {
  asset: AssetId;
  recipients: Recipients;
  min_per_action?: string | null;
  max_per_action?: string | null;
  lifetime_limit?: string | null;
  fixed_window?: FixedWindowLimit | null;
  streaming?: StreamingLimit | null;
  approval?: ApprovalRule | null;
  acknowledge_unbounded_budget: boolean;
}

export interface PermissionSpec {
  delegate: string;
  valid_from_ms: string;
  expires_at_ms?: string | null;
  max_executions?: number | null;
  rules: AssetRule[];
  redelegation_depth: number;
  metadata_hash?: string | null;
}

export interface Permission {
  id: string;
  parent_id?: string | null;
  issuer: string;
  delegate: string;
  epoch: string;
  depth: number;
  valid_from_ms: string;
  expires_at_ms?: string | null;
  max_executions?: number | null;
  rules: AssetRule[];
  redelegation_depth: number;
  revoked: boolean;
  metadata_hash?: string | null;
}

export interface BudgetScopeLifetime {
  type: "Lifetime";
}

export interface BudgetScopeFixedWindow {
  type: "FixedWindow";
  window_index: string;
}

export interface BudgetScopeStreaming {
  type: "Streaming";
}

export type BudgetScope =
  | BudgetScopeLifetime
  | BudgetScopeFixedWindow
  | BudgetScopeStreaming;

export interface BudgetKey {
  permission_id: string;
  asset: AssetId;
  scope: BudgetScope;
}

export interface Usage {
  settled: string;
  pending: string;
}

export interface PermissionUsage {
  executions_count: number;
}

export interface AssetLedger {
  available: string;
  pending_outgoing: string;
  enabled: boolean;
}

export type Action = {
  type: "Transfer";
  asset: AssetId;
  receiver: string;
  amount: string;
};

export interface ExecuteRequest {
  api_version: number;
  request_id: string; // 64 lowercase hex characters
  permission_id: string;
  action: Action;
  deadline_ms: string;
}

export interface OwnerWithdrawRequest {
  api_version: number;
  request_id: string;
  authority_epoch: string;
  action: Action;
  deadline_ms: string;
}

export type ExecutionStatus = "Pending" | "Succeeded" | "Failed";

export interface Reservation {
  budget_key: BudgetKey;
  amount: string;
}

export interface Execution {
  id: string;
  actor: string;
  request_id: string;
  request_hash: string;
  authority_mode: "Delegated" | "OwnerWithdrawal";
  permission_id?: string | null;
  epoch: string;
  action: Action;
  created_at_ms: string;
  status: ExecutionStatus;
  needs_reconciliation: boolean;
  reservations: Reservation[];
  failure_code?: string | null;
}

export interface TreasuryConfig {
  schema_version: number;
  network_domain: string;
  owner: string;
  pending_owner?: string | null;
  authority_epoch: string;
  paused: boolean;
  next_permission_id: string;
  next_execution_id: string;
  max_total_permissions: number;
  max_pending_executions: number;
  min_operating_reserve: string;
  callback_gas: string;
  transfer_gas: string;
  callback_storage_reserved: string;
  storage_funding_remaining: string;
  operating_budget_remaining: string;
  pending_execution_count: number;
}

export interface PreviewResult {
  allowed: boolean;
  error_code?: string | null;
  error_message?: string | null;
  required_approver?: string | null;
  offending_permission_id?: string | null;
  requested_amount: string;
  available_budget?: string | null;
}

export interface ApprovalRecord {
  approver: string;
  expires_at_ms: string;
}
