use near_sdk::AccountId;

use crate::errors::*;
use crate::types::{
    Action, BudgetKey, BudgetScope, Permission, PermissionId, PermissionSpec,
    PermissionUsage, Recipients, Reservation, StreamingLimit, Usage,
};

pub const MAX_DEPTH: u8 = 8; // Root is depth 0, max depth index is 7
pub const MAX_RULES_PER_PERMISSION: usize = 16;
pub const MAX_RECIPIENTS_PER_RULE: usize = 64;
pub const MAX_SERIALIZED_INPUT_BYTES: usize = 8192; // 8 KiB

/// Validates that a permission specification adheres to hard bounds and positive amounts.
pub fn validate_permission_spec(spec: &PermissionSpec) -> Result<(), &'static str> {
    if spec.rules.is_empty() || spec.rules.len() > MAX_RULES_PER_PERMISSION {
        return Err(ERR_INVALID_INPUT);
    }

    if let Some(expires_at) = spec.expires_at_ms {
        if expires_at.0 <= spec.valid_from_ms.0 {
            return Err(ERR_INVALID_INPUT);
        }
    }

    if let Some(max_exec) = spec.max_executions {
        if max_exec == 0 {
            return Err(ERR_INVALID_INPUT);
        }
    }

    // Check for duplicate assets in rules
    let mut seen_assets = Vec::with_capacity(spec.rules.len());
    for rule in &spec.rules {
        if seen_assets.contains(&rule.asset) {
            return Err(ERR_INVALID_INPUT); // No duplicate asset rules
        }
        seen_assets.push(rule.asset.clone());

        // Validate recipients
        if let Recipients::Only(ref accounts) = rule.recipients {
            if accounts.is_empty() || accounts.len() > MAX_RECIPIENTS_PER_RULE {
                return Err(ERR_INVALID_INPUT); // Only([]) is rejected
            }
            // Check duplicate recipients
            let mut seen_recipients = Vec::with_capacity(accounts.len());
            for acc in accounts {
                if seen_recipients.contains(acc) {
                    return Err(ERR_INVALID_INPUT);
                }
                seen_recipients.push(acc.clone());
            }
        }

        // Validate min/max per action
        if let (Some(min), Some(max)) = (rule.min_per_action, rule.max_per_action) {
            if min.0 == 0 || max.0 == 0 || max.0 < min.0 {
                return Err(ERR_INVALID_INPUT);
            }
        } else {
            if let Some(min) = rule.min_per_action {
                if min.0 == 0 {
                    return Err(ERR_INVALID_INPUT);
                }
            }
            if let Some(max) = rule.max_per_action {
                if max.0 == 0 {
                    return Err(ERR_INVALID_INPUT);
                }
            }
        }

        // Validate lifetime limit
        if let Some(lifetime) = rule.lifetime_limit {
            if lifetime.0 == 0 {
                return Err(ERR_INVALID_INPUT);
            }
        }

        // Validate fixed window
        if let Some(ref window) = rule.fixed_window {
            if window.limit.0 == 0 || window.duration_ms.0 == 0 {
                return Err(ERR_INVALID_INPUT);
            }
        }

        // Validate streaming limit
        if let Some(ref stream) = rule.streaming {
            if stream.rate_per_second.0 == 0 {
                return Err(ERR_INVALID_INPUT);
            }
            if let Some(cap) = stream.max_cap {
                if cap.0 == 0 {
                    return Err(ERR_INVALID_INPUT);
                }
            }
        }

        // Validate approval rule
        if let Some(ref approval) = rule.approval {
            if approval.above_amount.0 == 0 {
                return Err(ERR_INVALID_INPUT);
            }
        }

        // Validate unbounded budget acknowledgment requirement
        let has_cumulative_limit =
            rule.lifetime_limit.is_some() || rule.fixed_window.is_some() || rule.streaming.is_some();
        if !has_cumulative_limit && !rule.acknowledge_unbounded_budget {
            return Err(ERR_INVALID_INPUT);
        }
    }

    Ok(())
}

/// Validates child permission creation against parent terms (strictly narrowing or equal).
pub fn validate_child_narrowing(parent: &Permission, child_spec: &PermissionSpec) -> Result<(), &'static str> {
    validate_permission_spec(child_spec)?;

    if parent.redelegation_depth == 0 {
        return Err(ERR_REDELEGATION_DISABLED);
    }

    if child_spec.redelegation_depth >= parent.redelegation_depth {
        return Err(ERR_CHILD_PERMISSION_EXPANSION);
    }

    if parent.depth + 1 >= MAX_DEPTH {
        return Err(ERR_MAX_DEPTH);
    }

    // Child valid_from must be >= parent.valid_from
    if child_spec.valid_from_ms.0 < parent.valid_from_ms.0 {
        return Err(ERR_CHILD_PERMISSION_EXPANSION);
    }

    // If parent has finite expiry, child must have finite expiry and child.expires_at <= parent.expires_at
    if let Some(parent_expiry) = parent.expires_at_ms {
        match child_spec.expires_at_ms {
            Some(child_expiry) => {
                if child_expiry.0 > parent_expiry.0 {
                    return Err(ERR_CHILD_PERMISSION_EXPANSION);
                }
            }
            None => return Err(ERR_CHILD_PERMISSION_EXPANSION),
        }
    }

    // If parent has max_executions, child must supply max_executions <= parent.max_executions
    if let Some(parent_max_exec) = parent.max_executions {
        match child_spec.max_executions {
            Some(child_max_exec) => {
                if child_max_exec > parent_max_exec {
                    return Err(ERR_CHILD_PERMISSION_EXPANSION);
                }
            }
            None => return Err(ERR_CHILD_PERMISSION_EXPANSION),
        }
    }

    // Every child asset rule must have a parent rule that is equal or wider
    for child_rule in &child_spec.rules {
        let parent_rule = parent
            .rules
            .iter()
            .find(|p| p.asset == child_rule.asset)
            .ok_or(ERR_ASSET_NOT_ALLOWED)?;

        // Recipients check: if parent has Only, child must also have Only and be a subset
        if let Recipients::Only(ref parent_allowed) = parent_rule.recipients {
            match child_rule.recipients {
                Recipients::Only(ref child_allowed) => {
                    for r in child_allowed {
                        if !parent_allowed.contains(r) {
                            return Err(ERR_RECIPIENT_NOT_ALLOWED);
                        }
                    }
                }
                Recipients::Any => return Err(ERR_CHILD_PERMISSION_EXPANSION),
            }
        }

        // Max per action: child cap <= parent cap
        if let Some(parent_max) = parent_rule.max_per_action {
            match child_rule.max_per_action {
                Some(child_max) => {
                    if child_max.0 > parent_max.0 {
                        return Err(ERR_CHILD_PERMISSION_EXPANSION);
                    }
                }
                None => return Err(ERR_CHILD_PERMISSION_EXPANSION),
            }
        }

        // Min per action: child min >= parent min
        if let Some(parent_min) = parent_rule.min_per_action {
            match child_rule.min_per_action {
                Some(child_min) => {
                    if child_min.0 < parent_min.0 {
                        return Err(ERR_CHILD_PERMISSION_EXPANSION);
                    }
                }
                None => return Err(ERR_CHILD_PERMISSION_EXPANSION),
            }
        }

        // Lifetime limit: child cap <= parent cap
        if let Some(parent_lifetime) = parent_rule.lifetime_limit {
            match child_rule.lifetime_limit {
                Some(child_lifetime) => {
                    if child_lifetime.0 > parent_lifetime.0 {
                        return Err(ERR_CHILD_PERMISSION_EXPANSION);
                    }
                }
                None => return Err(ERR_CHILD_PERMISSION_EXPANSION),
            }
        }
    }

    Ok(())
}

/// Calculates window index: (now_ms - anchor_ms) / duration_ms for now_ms >= anchor_ms.
pub fn calculate_window_index(now_ms: u64, anchor_ms: u64, duration_ms: u64) -> Result<u64, &'static str> {
    if duration_ms == 0 {
        return Err(ERR_INVALID_INPUT);
    }
    if now_ms < anchor_ms {
        return Err(ERR_WINDOW_LIMIT);
    }
    Ok((now_ms - anchor_ms) / duration_ms)
}

/// Computes accrued streaming allowance at timestamp now_ms.
pub fn calculate_streaming_accrued(now_ms: u64, stream: &StreamingLimit) -> u128 {
    if now_ms < stream.start_ms.0 {
        return 0;
    }
    let elapsed_sec = ((now_ms - stream.start_ms.0) / 1000) as u128;
    let accrued = elapsed_sec.saturating_mul(stream.rate_per_second.0);
    if let Some(cap) = stream.max_cap {
        accrued.min(cap.0)
    } else {
        accrued
    }
}

/// Context passed to pure policy evaluation.
pub struct PathEvaluationContext<'a> {
    pub now_ms: u64,
    pub current_epoch: u64,
    pub action: &'a Action,
    pub leaf_actor: &'a AccountId,
    pub path: &'a [Permission], // from leaf (index 0) to root (last index)
}

/// Policy evaluation outcome containing reservations to lock and required approvals.
pub struct EvaluationOutcome {
    pub reservations: Vec<Reservation>,
    pub required_approvals: Vec<(PermissionId, AccountId)>, // (permission_id, approver)
}

/// Pure policy evaluator checking permission ancestry, rules, limits, and approvals without mutating state.
pub fn evaluate_path_pure<FUsage, FPermissionUsage>(
    ctx: &PathEvaluationContext,
    get_usage: FUsage,
    get_permission_usage: FPermissionUsage,
) -> Result<EvaluationOutcome, &'static str>
where
    FUsage: Fn(&BudgetKey) -> Usage,
    FPermissionUsage: Fn(PermissionId) -> PermissionUsage,
{
    if ctx.path.is_empty() {
        return Err(ERR_PERMISSION_NOT_FOUND);
    }
    if ctx.path.len() > MAX_DEPTH as usize {
        return Err(ERR_MAX_DEPTH);
    }

    let leaf = &ctx.path[0];
    if &leaf.delegate != ctx.leaf_actor {
        return Err(ERR_UNAUTHORIZED);
    }

    let asset = ctx.action.asset();
    let receiver = ctx.action.receiver();
    let amount = ctx.action.amount();

    if amount == 0 {
        return Err(ERR_INVALID_INPUT);
    }

    let mut reservations = Vec::new();
    let mut required_approvals = Vec::new();

    // Verify ancestry continuity from leaf up to root
    for (i, perm) in ctx.path.iter().enumerate() {
        // Epoch check
        if perm.epoch.0 != ctx.current_epoch {
            return Err(ERR_STALE_EPOCH);
        }

        // Revocation check
        if perm.revoked {
            return Err(ERR_PERMISSION_REVOKED);
        }

        // Time window check
        if ctx.now_ms < perm.valid_from_ms.0 {
            return Err(ERR_PERMISSION_NOT_STARTED);
        }
        if let Some(expiry) = perm.expires_at_ms {
            if ctx.now_ms >= expiry.0 {
                return Err(ERR_PERMISSION_EXPIRED);
            }
        }

        // Max executions check
        if let Some(max_exec) = perm.max_executions {
            let usage = get_permission_usage(perm.id.0);
            if usage.executions_count >= max_exec {
                return Err(ERR_EXECUTION_COUNT_EXCEEDED);
            }
        }

        // Continuity link to parent
        if i + 1 < ctx.path.len() {
            let parent = &ctx.path[i + 1];
            if perm.parent_id != Some(parent.id) {
                return Err(ERR_INVALID_ANCESTRY);
            }
            if perm.depth != parent.depth + 1 {
                return Err(ERR_INVALID_ANCESTRY);
            }
            if perm.issuer != parent.delegate {
                return Err(ERR_INVALID_ANCESTRY);
            }
        } else {
            // Root permission must have parent_id == None and depth == 0
            if perm.parent_id.is_some() || perm.depth != 0 {
                return Err(ERR_INVALID_ANCESTRY);
            }
        }

        // Match asset rule on this permission
        let rule = perm
            .rules
            .iter()
            .find(|p| &p.asset == asset)
            .ok_or(ERR_ASSET_NOT_ALLOWED)?;

        // Check recipient allowlist
        if let Recipients::Only(ref allowed) = rule.recipients {
            if !allowed.contains(receiver) {
                return Err(ERR_RECIPIENT_NOT_ALLOWED);
            }
        }

        // Check per-action limits
        if let Some(max_action) = rule.max_per_action {
            if amount > max_action.0 {
                return Err(ERR_PER_ACTION_LIMIT);
            }
        }
        if let Some(min_action) = rule.min_per_action {
            if amount < min_action.0 {
                return Err(ERR_PER_ACTION_LIMIT);
            }
        }

        // Check lifetime budget
        if let Some(lifetime) = rule.lifetime_limit {
            let budget_key = BudgetKey {
                permission_id: perm.id.0,
                asset: asset.clone(),
                scope: BudgetScope::Lifetime,
            };
            let usage = get_usage(&budget_key);
            let total = usage
                .settled
                .0
                .checked_add(usage.pending.0)
                .and_then(|sum| sum.checked_add(amount))
                .ok_or(ERR_LIFETIME_LIMIT)?;
            if total > lifetime.0 {
                return Err(ERR_LIFETIME_LIMIT);
            }
            reservations.push(Reservation {
                budget_key,
                amount: near_sdk::json_types::U128(amount),
            });
        }

        // Check recurring fixed window budget
        if let Some(ref window) = rule.fixed_window {
            let window_idx = calculate_window_index(ctx.now_ms, window.anchor_ms.0, window.duration_ms.0)?;
            let budget_key = BudgetKey {
                permission_id: perm.id.0,
                asset: asset.clone(),
                scope: BudgetScope::FixedWindow(window_idx),
            };
            let usage = get_usage(&budget_key);
            let total = usage
                .settled
                .0
                .checked_add(usage.pending.0)
                .and_then(|sum| sum.checked_add(amount))
                .ok_or(ERR_WINDOW_LIMIT)?;
            if total > window.limit.0 {
                return Err(ERR_WINDOW_LIMIT);
            }
            reservations.push(Reservation {
                budget_key,
                amount: near_sdk::json_types::U128(amount),
            });
        }

        // Check continuous streaming budget
        if let Some(ref stream) = rule.streaming {
            let accrued = calculate_streaming_accrued(ctx.now_ms, stream);
            let budget_key = BudgetKey {
                permission_id: perm.id.0,
                asset: asset.clone(),
                scope: BudgetScope::Streaming,
            };
            let usage = get_usage(&budget_key);
            let total = usage
                .settled
                .0
                .checked_add(usage.pending.0)
                .and_then(|sum| sum.checked_add(amount))
                .ok_or(ERR_STREAMING_LIMIT)?;
            if total > accrued {
                return Err(ERR_STREAMING_LIMIT);
            }
            reservations.push(Reservation {
                budget_key,
                amount: near_sdk::json_types::U128(amount),
            });
        }

        // Check approval requirements: triggers when amount > above_amount
        if let Some(ref approval) = rule.approval {
            if amount > approval.above_amount.0 {
                required_approvals.push((perm.id.0, approval.approver.clone()));
            }
        }
    }

    Ok(EvaluationOutcome {
        reservations,
        required_approvals,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AssetId, AssetRule};
    use near_sdk::json_types::{U128, U64};

    fn test_account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    #[test]
    fn test_calculate_window_index() {
        let anchor = 1_000_000;
        let duration = 60_000; // 1 min

        // Before anchor -> window limit error
        assert!(calculate_window_index(999_999, anchor, duration).is_err());

        // At anchor -> window 0
        assert_eq!(calculate_window_index(1_000_000, anchor, duration).unwrap(), 0);

        // Within window 0
        assert_eq!(calculate_window_index(1_059_999, anchor, duration).unwrap(), 0);

        // Next window
        assert_eq!(calculate_window_index(1_060_000, anchor, duration).unwrap(), 1);
        assert_eq!(calculate_window_index(1_120_000, anchor, duration).unwrap(), 2);
    }

    #[test]
    fn test_calculate_streaming_accrued() {
        let stream = StreamingLimit {
            rate_per_second: U128(10), // 10 units per second
            start_ms: U64(1_000_000),
            max_cap: Some(U128(100)),
        };

        // Before start
        assert_eq!(calculate_streaming_accrued(900_000, &stream), 0);

        // 5 seconds elapsed -> 50 units
        assert_eq!(calculate_streaming_accrued(1_005_000, &stream), 50);

        // 10 seconds elapsed -> 100 units (capped)
        assert_eq!(calculate_streaming_accrued(1_010_000, &stream), 100);

        // 20 seconds elapsed -> still 100 units due to max_cap
        assert_eq!(calculate_streaming_accrued(1_020_000, &stream), 100);
    }

    #[test]
    fn test_validate_child_narrowing_success() {
        let parent = Permission {
            id: U64(1),
            parent_id: None,
            issuer: test_account("company.near"),
            delegate: test_account("manager.near"),
            epoch: U64(1),
            depth: 0,
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(10),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(100)),
                lifetime_limit: Some(U128(1000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 2,
            revoked: false,
            metadata_hash: None,
        };

        let child_spec = PermissionSpec {
            delegate: test_account("employee.near"),
            valid_from_ms: U64(1_100_000),
            expires_at_ms: Some(U64(1_900_000)),
            max_executions: Some(5),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![test_account("vendor.near")]),
                min_per_action: Some(U128(15)), // >= parent min (10)
                max_per_action: Some(U128(80)),  // <= parent max (100)
                lifetime_limit: Some(U128(500)), // <= parent lifetime (1000)
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1, // < parent redelegation_depth (2)
            metadata_hash: None,
        };

        assert!(validate_child_narrowing(&parent, &child_spec).is_ok());
    }

    #[test]
    fn test_validate_child_expansion_rejected() {
        let parent = Permission {
            id: U64(1),
            parent_id: None,
            issuer: test_account("company.near"),
            delegate: test_account("manager.near"),
            epoch: U64(1),
            depth: 0,
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: Some(5),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![test_account("vendor1.near")]),
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(100)),
                lifetime_limit: Some(U128(500)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1,
            revoked: false,
            metadata_hash: None,
        };

        // Child attempts to expand recipients to Any -> rejected
        let child_expand_recipients = PermissionSpec {
            delegate: test_account("employee.near"),
            valid_from_ms: U64(1_100_000),
            expires_at_ms: Some(U64(1_900_000)),
            max_executions: Some(3),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(50)),
                lifetime_limit: Some(U128(200)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        };
        assert_eq!(
            validate_child_narrowing(&parent, &child_expand_recipients),
            Err(ERR_CHILD_PERMISSION_EXPANSION)
        );

        // Child attempts to exceed parent's max_per_action -> rejected
        let child_expand_max_action = PermissionSpec {
            delegate: test_account("employee.near"),
            valid_from_ms: U64(1_100_000),
            expires_at_ms: Some(U64(1_900_000)),
            max_executions: Some(3),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![test_account("vendor1.near")]),
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(150)), // > 100
                lifetime_limit: Some(U128(200)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            metadata_hash: None,
        };
        assert_eq!(
            validate_child_narrowing(&parent, &child_expand_max_action),
            Err(ERR_CHILD_PERMISSION_EXPANSION)
        );
    }

    #[test]
    fn test_evaluate_path_pure_full_flow() {
        let root = Permission {
            id: U64(1),
            parent_id: None,
            issuer: test_account("company.near"),
            delegate: test_account("manager.near"),
            epoch: U64(1),
            depth: 0,
            valid_from_ms: U64(1_000_000),
            expires_at_ms: Some(U64(2_000_000)),
            max_executions: None,
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Any,
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(500)),
                lifetime_limit: Some(U128(1000)),
                fixed_window: None,
                streaming: None,
                approval: Some(crate::types::ApprovalRule {
                    approver: test_account("ceo.near"),
                    above_amount: U128(300),
                }),
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 2,
            revoked: false,
            metadata_hash: None,
        };

        let leaf = Permission {
            id: U64(2),
            parent_id: Some(U64(1)),
            issuer: test_account("manager.near"),
            delegate: test_account("employee.near"),
            epoch: U64(1),
            depth: 1,
            valid_from_ms: U64(1_100_000),
            expires_at_ms: Some(U64(1_900_000)),
            max_executions: Some(3),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![test_account("vendor.near")]),
                min_per_action: Some(U128(10)),
                max_per_action: Some(U128(400)),
                lifetime_limit: Some(U128(800)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 0,
            revoked: false,
            metadata_hash: None,
        };

        let action = Action::Transfer {
            asset: AssetId::NativeNear,
            receiver: test_account("vendor.near"),
            amount: U128(350), // exceeds root approval threshold of 300!
        };

        let path = vec![leaf.clone(), root.clone()];
        let ctx = PathEvaluationContext {
            now_ms: 1_200_000,
            current_epoch: 1,
            action: &action,
            leaf_actor: &test_account("employee.near"),
            path: &path,
        };

        let outcome = evaluate_path_pure(
            &ctx,
            |_key| Usage {
                settled: U128(0),
                pending: U128(0),
            },
            |_permission_id| PermissionUsage {
                executions_count: 1, // < max_executions (3)
            },
        )
        .expect("path should evaluate successfully");

        // Outcome must include reservations for both leaf and root lifetime budgets
        assert_eq!(outcome.reservations.len(), 2);
        // And required approval from ceo.near because 350 > 300 on root permission
        assert_eq!(outcome.required_approvals.len(), 1);
        assert_eq!(outcome.required_approvals[0], (1, test_account("ceo.near")));
    }
}
