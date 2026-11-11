use near_workspaces::{
    operations::Function,
    types::{Gas, KeyType, NearToken, SecretKey},
};
use serde_json::{json, Value};

#[tokio::test]
async fn company_claims_and_spends_mock_usdc() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let testnet = worker
        .create_tla(
            "testnet".parse()?,
            SecretKey::from_seed(KeyType::ED25519, "mock-usdc-testnet"),
        )
        .await?
        .into_result()?;
    let relayer = testnet
        .create_subaccount("relay")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()?;
    let token_account = testnet
        .create_subaccount("mock-usdc")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let token = token_account
        .deploy(&std::fs::read(
            "../target/wasm32-unknown-unknown/release/allocard_mock_usdc.wasm",
        )?)
        .await?
        .into_result()?;
    token
        .call("new")
        .args_json(json!({ "minter": relayer.id() }))
        .transact()
        .await?
        .into_result()?;
    let shared = worker
        .dev_deploy(&std::fs::read("../res/allocard_shared.wasm")?)
        .await?;
    shared
        .call("new")
        .args_json(json!({ "network_domain": "near:testnet" }))
        .transact()
        .await?
        .into_result()?;
    let owner = worker.dev_create_account().await?;
    let employee = worker.dev_create_account().await?;
    let recipient = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let company_id: String = shared
        .view("get_company_id")
        .args_json(json!({ "owner": owner.id(), "company_key": "mock-usdc-demo" }))
        .await?
        .json()?;
    let asset = json!({ "type": "Nep141", "contract_id": token.id() });
    owner
        .batch(shared.id())
        .call(
            Function::new("create_company")
                .args_json(json!({ "company_key": "mock-usdc-demo" }))
                .gas(Gas::from_tgas(70))
                .deposit(NearToken::from_millinear(200)),
        )
        .call(
            Function::new("register_asset")
                .args_json(json!({ "company_id": company_id, "asset": asset }))
                .gas(Gas::from_tgas(25)),
        )
        .call(
            Function::new("set_asset_enabled")
                .args_json(json!({ "company_id": company_id, "asset": asset, "enabled": true }))
                .gas(Gas::from_tgas(25)),
        )
        .transact()
        .await?
        .into_result()?;
    relayer
        .batch(shared.id())
        .call(
            Function::new("top_up_storage")
                .args_json(json!({ "company_id": company_id }))
                .gas(Gas::from_tgas(30))
                .deposit(NearToken::from_millinear(200)),
        )
        .call(
            Function::new("top_up_operating")
                .args_json(json!({ "company_id": company_id }))
                .gas(Gas::from_tgas(30))
                .deposit(NearToken::from_millinear(20)),
        )
        .transact()
        .await?
        .into_result()?;
    let bounds: Value = token.view("storage_balance_bounds").await?.json()?;
    let deposit = NearToken::from_yoctonear(bounds["min"].as_str().unwrap().parse()?);
    for (index, amount) in ["2000000000", "1000000000", "1000000000"]
        .into_iter()
        .enumerate()
    {
        let mut transaction = relayer.batch(token.id());
        if index == 0 {
            for account in [relayer.id(), shared.id(), recipient.id()] {
                transaction = transaction.call(
                    Function::new("storage_deposit")
                        .args_json(json!({ "account_id": account, "registration_only": true }))
                        .gas(Gas::from_tgas(15))
                        .deposit(deposit),
                );
            }
        }
        let credited: String = transaction
            .call(
                Function::new("mint")
                    .args_json(json!({ "amount": amount }))
                    .gas(Gas::from_tgas(15)),
            )
            .call(
                Function::new("ft_transfer_call")
                    .args_json(json!({
                        "receiver_id": shared.id(), "amount": amount,
                        "msg": json!({ "company_id": company_id }).to_string(),
                    }))
                    .gas(Gas::from_tgas(110))
                    .deposit(NearToken::from_yoctonear(1)),
            )
            .transact()
            .await?
            .into_result()?
            .json()?;
        assert_eq!(credited, amount);
    }
    let ledger: Value = shared
        .view("get_asset_ledger")
        .args_json(json!({ "company_id": company_id, "asset": asset }))
        .await?
        .json()?;
    assert_eq!(ledger["available"], "4000000000");
    let permission_id: String = owner
        .call(shared.id(), "create_root_permission")
        .args_json(json!({
            "company_id": company_id,
            "spec": {
                "delegate": employee.id(), "valid_from_ms": "0", "max_executions": 10,
                "rules": [{
                    "asset": asset, "recipients": { "type": "Only", "accounts": [recipient.id()] },
                    "lifetime_limit": "5000000", "acknowledge_unbounded_budget": false
                }],
                "redelegation_depth": 1
            }
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?
        .json()?;
    let child_id: String = employee.call(shared.id(), "create_child_permission")
        .args_json(json!({"company_id": company_id,"parent_id": permission_id,"spec": {
            "delegate": agent.id(), "valid_from_ms": "0", "max_executions": 5,
            "rules": [{"asset": asset,"recipients": {"type":"Only","accounts":[recipient.id()]},"lifetime_limit":"3000000","acknowledge_unbounded_budget":false}],
            "redelegation_depth":0
        }})).max_gas().transact().await?.into_result()?.json()?;
    let reserved: String = shared.view("get_reserved_budget").args_json(json!({"company_id":company_id,"permission_id":permission_id,"asset":asset,"exclude_child":null})).await?.json()?;
    assert_eq!(reserved,"3000000");
    let rejected = employee.call(shared.id(),"execute").args_json(json!({"company_id":company_id,"request":{
        "api_version":1,"request_id":"b".repeat(64),"permission_id":permission_id,
        "action":{"type":"Transfer","asset":asset,"receiver":recipient.id(),"amount":"2000001"},"deadline_ms":"2000000000000"
    }})).max_gas().transact().await?;
    assert!(rejected.is_failure(),"Direct spending must leave the agent's 3 USDC allocation available");
    let execution_id: String = employee.call(shared.id(), "execute").args_json(json!({
        "company_id": company_id,
        "request": {
            "api_version": 1, "request_id": "a".repeat(64), "permission_id": permission_id,
            "action": { "type": "Transfer", "asset": asset, "receiver": recipient.id(), "amount": "1250000" },
            "deadline_ms": "2000000000000"
        }
    })).gas(Gas::from_tgas(150)).transact().await?.into_result()?.json()?;
    let execution: Value = shared
        .view("get_execution")
        .args_json(json!({ "company_id": company_id, "execution_id": execution_id }))
        .await?
        .json()?;
    assert_eq!(execution["status"], "Succeeded");
    let balance: String = token
        .view("ft_balance_of")
        .args_json(json!({ "account_id": recipient.id() }))
        .await?
        .json()?;
    assert_eq!(balance, "1250000");
    agent.call(shared.id(),"execute").args_json(json!({"company_id":company_id,"request":{
        "api_version":1,"request_id":"c".repeat(64),"permission_id":child_id,
        "action":{"type":"Transfer","asset":asset,"receiver":recipient.id(),"amount":"1000000"},"deadline_ms":"2000000000000"
    }})).max_gas().transact().await?.into_result()?;
    let reserved: String = shared.view("get_reserved_budget").args_json(json!({"company_id":company_id,"permission_id":permission_id,"asset":asset,"exclude_child":null})).await?.json()?;
    assert_eq!(reserved,"2000000");
    employee.call(shared.id(),"revoke_permission").args_json(json!({"company_id":company_id,"permission_id":child_id})).max_gas().transact().await?.into_result()?;
    let reserved: String = shared.view("get_reserved_budget").args_json(json!({"company_id":company_id,"permission_id":permission_id,"asset":asset,"exclude_child":null})).await?.json()?;
    assert_eq!(reserved,"0");
    Ok(())
}
