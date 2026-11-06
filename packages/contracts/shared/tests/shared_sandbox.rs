use near_workspaces::{operations::Function, types::NearToken};
use serde_json::{json, Value};

#[tokio::test]
async fn shared_company_native_flow_and_isolation() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let code = std::fs::read("../res/allocard_shared.wasm")?;
    let shared = worker.dev_deploy(&code).await?;
    // Initialize and remove the development access key in the same batch.
    shared
        .as_account()
        .batch(shared.id())
        .call(Function::new("new").args_json(json!({"network_domain":"near:testnet"})))
        .delete_key(shared.as_account().secret_key().public_key())
        .transact()
        .await?
        .into_result()?;
    assert!(shared.view_access_keys().await?.is_empty());
    let owner_a = worker.dev_create_account().await?;
    let owner_b = worker.dev_create_account().await?;
    let employee = worker.dev_create_account().await?;
    let recipient = worker.dev_create_account().await?;
    let mut ids = vec![];
    for owner in [&owner_a, &owner_b] {
        let id: String = owner
            .call(shared.id(), "create_company")
            .args_json(json!({"company_key":"same-key"}))
            .deposit(NearToken::from_millinear(200))
            .max_gas()
            .transact()
            .await?
            .into_result()?
            .json()?;
        owner
            .call(shared.id(), "top_up_storage")
            .args_json(json!({"company_id":id}))
            .deposit(NearToken::from_near(1))
            .transact()
            .await?
            .into_result()?;
        owner
            .call(shared.id(), "deposit_native")
            .args_json(json!({"company_id":id}))
            .deposit(NearToken::from_near(2))
            .transact()
            .await?
            .into_result()?;
        let permission: String=owner.call(shared.id(), "create_root_permission").args_json(json!({"company_id":id,"spec":{
            "delegate":employee.id(),"valid_from_ms":"0","expires_at_ms":null,"max_executions":10,
            "rules":[{"asset":{"type":"NativeNear"},"recipients":{"type":"Only","accounts":[recipient.id()]},
            "min_per_action":null,"max_per_action":NearToken::from_near(1).as_yoctonear().to_string(),
            "lifetime_limit":NearToken::from_near(2).as_yoctonear().to_string(),"fixed_window":null,"streaming":null,"approval":null,"acknowledge_unbounded_budget":false}],
            "redelegation_depth":0,"metadata_hash":null
        }})).max_gas().transact().await?.into_result()?.json()?;
        assert_eq!(permission, "1");
        ids.push(id);
    }
    assert_ne!(ids[0], ids[1]);
    let request = json!({"api_version":1,"request_id":"a".repeat(64),"permission_id":"1",
        "action":{"type":"Transfer","asset":{"type":"NativeNear"},"receiver":recipient.id(),"amount":NearToken::from_millinear(100).as_yoctonear().to_string()},"deadline_ms":"2000000000000"});
    let mut hashes = vec![];
    for (index, id) in ids.iter().enumerate() {
        let execution: String = employee
            .call(shared.id(), "execute")
            .args_json(json!({"company_id":id,"request":request}))
            .max_gas()
            .transact()
            .await?
            .into_result()?
            .json()?;
        assert_eq!(execution, "1");
        let record: Value = shared
            .view("get_execution")
            .args_json(json!({"company_id":id,"execution_id":"1"}))
            .await?
            .json()?;
        assert_eq!(record["status"], "Succeeded");
        hashes.push(record["request_hash"].clone());
        let untouched: Value = shared
            .view("get_asset_ledger")
            .args_json(json!({"company_id":ids[1-index],"asset":{"type":"NativeNear"}}))
            .await?
            .json()?;
        assert_eq!(
            untouched["available"],
            if index == 0 {
                NearToken::from_near(2)
            } else {
                NearToken::from_millinear(1900)
            }
            .as_yoctonear()
            .to_string()
        );
    }
    assert_ne!(hashes[0], hashes[1]);
    let denied = owner_a
        .call(shared.id(), "revoke_permission")
        .args_json(json!({"company_id":ids[1],"permission_id":"1"}))
        .transact()
        .await?;
    assert!(denied.is_failure());
    owner_a
        .call(shared.id(), "revoke_permission")
        .args_json(json!({"company_id":ids[0],"permission_id":"1"}))
        .transact()
        .await?
        .into_result()?;
    let mut next = request.clone();
    next["request_id"] = json!("b".repeat(64));
    assert!(employee
        .call(shared.id(), "execute")
        .args_json(json!({"company_id":ids[0],"request":next}))
        .max_gas()
        .transact()
        .await?
        .is_failure());
    employee
        .call(shared.id(), "execute")
        .args_json(json!({"company_id":ids[1],"request":next}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
