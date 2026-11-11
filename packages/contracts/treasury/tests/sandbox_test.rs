use near_sdk::json_types::U64;
use near_workspaces::types::NearToken;
use serde_json::json;

const WASM_PATH: &str = "../res/allocard_treasury.wasm";

#[tokio::test]
async fn test_full_delegation_and_shared_budget() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let contract_wasm = std::fs::read(WASM_PATH)?;
    let treasury = worker.dev_deploy(&contract_wasm).await?;

    let owner = worker.dev_create_account().await?;
    let manager = worker.dev_create_account().await?;
    let agent_1 = worker.dev_create_account().await?;
    let agent_2 = worker.dev_create_account().await?;
    let recipient_1 = worker.dev_create_account().await?;
    let recipient_2 = worker.dev_create_account().await?;

    // 1. Initialize treasury
    let init_res = treasury
        .call("new")
        .args_json(json!({
            "config": {
                "network_domain": "sandbox",
                "owner": owner.id(),
            }
        }))
        .transact()
        .await?;
    assert!(init_res.is_success());

    owner
        .call(treasury.id(), "top_up_storage")
        .deposit(NearToken::from_near(2))
        .transact()
        .await?
        .into_result()?;

    // 2. Deposit 10 NEAR to treasury
    let deposit_res = owner
        .call(treasury.id(), "deposit_native")
        .deposit(NearToken::from_near(10))
        .transact()
        .await?;
    assert!(deposit_res.is_success());

    // Check ledger available
    let ledger: serde_json::Value = treasury
        .view("get_asset_ledger")
        .args_json(json!({ "asset": { "type": "NativeNear" } }))
        .await?
        .json()?;
    assert_eq!(
        ledger["available"],
        NearToken::from_near(10).as_yoctonear().to_string()
    );

    // 3. Owner creates root permission for manager with 2 NEAR lifetime limit and max depth 2
    let root_res = owner
        .call(treasury.id(), "create_root_permission")
        .args_json(json!({
            "spec": {
                "delegate": manager.id(),
                "valid_from_ms": "0",
                "expires_at_ms": "2000000000000",
                "max_executions": 20,
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": NearToken::from_near(2).as_yoctonear().to_string(),
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 2
            }
        }))
        .transact()
        .await?;
    assert!(root_res.is_success());
    let root_id: U64 = root_res.json()?;
    assert_eq!(root_id.0, 1);

    // 4. Manager creates child permission for agent_1 with a reserved 1.2 NEAR limit
    let child1_res = manager
        .call(treasury.id(), "create_child_permission")
        .args_json(json!({
            "parent_id": "1",
            "spec": {
                "delegate": agent_1.id(),
                "valid_from_ms": "0",
                "expires_at_ms": "2000000000000",
                "max_executions": 10,
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": NearToken::from_millinear(1200).as_yoctonear().to_string(),
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 1
            }
        }))
        .transact()
        .await?;
    assert!(child1_res.is_success());
    let child1_id: U64 = child1_res.json()?;
    assert_eq!(child1_id.0, 2);

    // Manager creates sibling child permission for agent_2 with the reserved 0.8 NEAR remainder
    let child2_res = manager
        .call(treasury.id(), "create_child_permission")
        .args_json(json!({
            "parent_id": "1",
            "spec": {
                "delegate": agent_2.id(),
                "valid_from_ms": "0",
                "expires_at_ms": "2000000000000",
                "max_executions": 10,
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": NearToken::from_millinear(800).as_yoctonear().to_string(),
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 1
            }
        }))
        .transact()
        .await?;
    assert!(child2_res.is_success());
    let child2_id: U64 = child2_res.json()?;
    assert_eq!(child2_id.0, 3);

    // 5. Agent 1 executes a transfer of 1.2 NEAR to recipient_1
    let rcpt1_bal_before = recipient_1.view_account().await?.balance;
    let req1_id = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let exec1_res = agent_1
        .call(treasury.id(), "execute")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": req1_id,
                "permission_id": child1_id.0.to_string(),
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": recipient_1.id(),
                    "amount": NearToken::from_millinear(1200).as_yoctonear().to_string()
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(exec1_res.is_success());
    let exec1_id: U64 = exec1_res.json()?;
    assert_eq!(exec1_id.0, 1);

    // Verify recipient_1 received 1.2 NEAR
    let rcpt1_bal_after = recipient_1.view_account().await?.balance;
    assert_eq!(
        rcpt1_bal_after.as_yoctonear() - rcpt1_bal_before.as_yoctonear(),
        NearToken::from_millinear(1200).as_yoctonear()
    );

    // Verify execution status is Succeeded
    let exec1_record: serde_json::Value = treasury
        .view("get_execution")
        .args_json(json!({ "execution_id": "1" }))
        .await?
        .json()?;
    assert_eq!(exec1_record["status"], "Succeeded");

    // Replay idempotency: repeated execute returns existing execution_id and doesn't re-dispatch
    let replay_res = agent_1
        .call(treasury.id(), "execute")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": req1_id,
                "permission_id": child1_id.0.to_string(),
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": recipient_1.id(),
                    "amount": NearToken::from_millinear(1200).as_yoctonear().to_string()
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .transact()
        .await?;
    assert!(replay_res.is_success());
    let replay_id: U64 = replay_res.json()?;
    assert_eq!(replay_id.0, 1);

    // 6. Test Shared Budget: Parent had 2.0 NEAR. Agent 1 used 1.2 NEAR, leaving 0.8 NEAR parent capacity.
    // Agent 2 has a reserved 0.8 NEAR cap; it cannot consume its sibling allocation.
    // If Agent 2 tries to spend 1.0 NEAR, it MUST fail closed with LIFETIME_LIMIT!
    let req2_fail_id = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f21";
    let overspend_res = agent_2
        .call(treasury.id(), "execute")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": req2_fail_id,
                "permission_id": child2_id.0.to_string(),
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": recipient_2.id(),
                    "amount": NearToken::from_millinear(1000).as_yoctonear().to_string()
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact()
        .await;
    assert!(overspend_res.is_err() || !overspend_res.as_ref().unwrap().is_success());

    // Agent 2 spends 0.8 NEAR (exact remaining parent budget) -> MUST succeed!
    let req2_ok_id = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f22";
    let exact_res = agent_2
        .call(treasury.id(), "execute")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": req2_ok_id,
                "permission_id": child2_id.0.to_string(),
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": recipient_2.id(),
                    "amount": NearToken::from_millinear(800).as_yoctonear().to_string()
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact()
        .await?;
    assert!(exact_res.is_success());

    // Verify parent budget is fully exhausted (2.0 NEAR total settled)
    let parent_usage: serde_json::Value = treasury
        .view("get_usage")
        .args_json(json!({
            "permission_id": "1",
            "asset": { "type": "NativeNear" },
            "scope": { "type": "Lifetime" }
        }))
        .await?
        .json()?;
    assert_eq!(
        parent_usage["settled"],
        NearToken::from_near(2).as_yoctonear().to_string()
    );
    assert_eq!(parent_usage["pending"], "0");

    Ok(())
}

#[tokio::test]
async fn test_adversarial_isolation_and_security() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let contract_wasm = std::fs::read(WASM_PATH)?;
    let treasury = worker.dev_deploy(&contract_wasm).await?;

    let owner = worker.dev_create_account().await?;
    let attacker = worker.dev_create_account().await?;

    // 1. Initialize treasury
    let _ = treasury
        .call("new")
        .args_json(json!({
            "config": {
                "network_domain": "sandbox",
                "owner": owner.id(),
            }
        }))
        .transact()
        .await?;

    owner
        .call(treasury.id(), "top_up_storage")
        .deposit(NearToken::from_near(2))
        .transact()
        .await?
        .into_result()?;

    // 2. Attacker cannot create root permission
    let attack_root = attacker
        .call(treasury.id(), "create_root_permission")
        .args_json(json!({
            "spec": {
                "delegate": attacker.id(),
                "valid_from_ms": "0",
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": "1000000000000000000000000",
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 0
            }
        }))
        .transact()
        .await;
    assert!(attack_root.is_err() || !attack_root.as_ref().unwrap().is_success());

    // 3. Attacker cannot call private callback directly
    let attack_callback = attacker
        .call(treasury.id(), "on_transfer_result")
        .args_json(json!({ "execution_id": "1" }))
        .transact()
        .await;
    assert!(attack_callback.is_err() || !attack_callback.as_ref().unwrap().is_success());

    // 4. Attacker cannot block principals or pause contract
    let attack_pause = attacker
        .call(treasury.id(), "set_paused")
        .args_json(json!({ "paused": true }))
        .transact()
        .await;
    assert!(attack_pause.is_err() || !attack_pause.as_ref().unwrap().is_success());

    // 5. Attacker cannot withdraw treasury funds
    let attack_withdraw = attacker
        .call(treasury.id(), "owner_withdraw")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f99",
                "authority_epoch": "1",
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": attacker.id(),
                    "amount": "1000000000000000000000000"
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .transact()
        .await;
    assert!(attack_withdraw.is_err() || !attack_withdraw.as_ref().unwrap().is_success());

    Ok(())
}

#[tokio::test]
async fn test_gas_measurement_and_revocation_cascade() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let contract_wasm = std::fs::read(WASM_PATH)?;
    let treasury = worker.dev_deploy(&contract_wasm).await?;

    let owner = worker.dev_create_account().await?;
    let l1_delegate = worker.dev_create_account().await?;
    let l2_delegate = worker.dev_create_account().await?;
    let l3_delegate = worker.dev_create_account().await?;
    let recipient = worker.dev_create_account().await?;

    // 1. Initialize
    let _ = treasury
        .call("new")
        .args_json(json!({
            "config": {
                "network_domain": "sandbox",
                "owner": owner.id(),
            }
        }))
        .transact()
        .await?;

    owner
        .call(treasury.id(), "top_up_storage")
        .deposit(NearToken::from_near(2))
        .transact()
        .await?
        .into_result()?;

    // Fund treasury
    let _ = owner
        .call(treasury.id(), "deposit_native")
        .deposit(NearToken::from_near(20))
        .transact()
        .await?;

    // Create 3-level chain: Owner -> L1 -> L2 -> L3
    let root_res = owner
        .call(treasury.id(), "create_root_permission")
        .args_json(json!({
            "spec": {
                "delegate": l1_delegate.id(),
                "valid_from_ms": "0",
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": NearToken::from_near(10).as_yoctonear().to_string(),
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 3
            }
        }))
        .transact()
        .await?;
    let root_id: U64 = root_res.json()?;

    // Exercise the maximum root-allocation scan using the SDK's standalone
    // mutation gas budget. Existing root 1 holds 10 NEAR; 63 roots hold 0.1 each.
    for _ in 0..63 {
        owner.call(treasury.id(), "create_root_permission").args_json(json!({"spec":{
            "delegate":l1_delegate.id(),"valid_from_ms":"0","rules":[{
                "asset":{"type":"NativeNear"},"recipients":{"type":"Any"},
                "lifetime_limit":NearToken::from_millinear(100).as_yoctonear().to_string(),"acknowledge_unbounded_budget":false
            }],"redelegation_depth":0
        }})).gas(near_workspaces::types::Gas::from_tgas(40)).transact().await?.into_result()?;
    }

    let l2_res = l1_delegate
        .call(treasury.id(), "create_child_permission")
        .args_json(json!({
            "parent_id": root_id.0.to_string(),
            "spec": {
                "delegate": l2_delegate.id(),
                "valid_from_ms": "0",
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": NearToken::from_near(5).as_yoctonear().to_string(),
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 2
            }
        }))
        .transact()
        .await?;
    let l2_id: U64 = l2_res.json()?;

    let l3_res = l2_delegate
        .call(treasury.id(), "create_child_permission")
        .args_json(json!({
            "parent_id": l2_id.0.to_string(),
            "spec": {
                "delegate": l3_delegate.id(),
                "valid_from_ms": "0",
                "rules": [{
                    "asset": { "type": "NativeNear" },
                    "recipients": { "type": "Any" },
                    "lifetime_limit": NearToken::from_near(2).as_yoctonear().to_string(),
                    "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 1
            }
        }))
        .transact()
        .await?;
    let l3_id: U64 = l3_res.json()?;

    let queries: Vec<_> = (1..=8)
        .map(|id| json!({"permission_id":id.to_string(),"actor":l1_delegate.id()}))
        .collect();
    let snapshots: Vec<serde_json::Value> = treasury
        .view("get_spending_snapshots")
        .args_json(json!({"asset":{"type":"NativeNear"},"queries":queries}))
        .await?
        .json()?;
    assert_eq!(snapshots.len(), 8);
    assert_eq!(
        snapshots[0]["remaining"],
        NearToken::from_near(5).as_yoctonear().to_string()
    );
    // Measure L3 execution at the maximum number of root allocations.
    let exec_res = l3_delegate
        .call(treasury.id(), "execute")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1fff",
                "permission_id": l3_id.0.to_string(),
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": recipient.id(),
                    "amount": NearToken::from_near(1).as_yoctonear().to_string()
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact()
        .await?;

    assert!(exec_res.is_success());
    let gas_burnt = exec_res.total_gas_burnt;
    println!(
        "MEASURED GAS BURNT FOR 64-ROOT / 3-DEPTH EXECUTION: {} Gas ({:.2} TGas)",
        gas_burnt.as_gas(),
        (gas_burnt.as_gas() as f64) / 1e12
    );

    // Now test revocation cascading: L1 revokes L2 permission
    let revoke_res = l1_delegate
        .call(treasury.id(), "revoke_permission")
        .args_json(json!({ "permission_id": l2_id.0.to_string() }))
        .transact()
        .await?;
    assert!(revoke_res.is_success());

    // Subsequent execute by L3 delegate MUST fail because ancestor L2 is revoked!
    let blocked_exec = l3_delegate
        .call(treasury.id(), "execute")
        .args_json(json!({
            "request": {
                "api_version": 1,
                "request_id": "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1fee",
                "permission_id": l3_id.0.to_string(),
                "action": {
                    "type": "Transfer",
                    "asset": { "type": "NativeNear" },
                    "receiver": recipient.id(),
                    "amount": NearToken::from_millinear(500).as_yoctonear().to_string()
                },
                "deadline_ms": "2000000000000"
            }
        }))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact()
        .await;

    assert!(blocked_exec.is_err() || !blocked_exec.as_ref().unwrap().is_success());

    Ok(())
}
