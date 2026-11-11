use allocard_treasury::{types::*, TreasuryContract};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, PanicOnDefault};

const CREATE_DEPOSIT: u128 = 200_000_000_000_000_000_000_000;
const OPERATING_FLOOR: u128 = 100_000_000_000_000_000_000_000;

#[near(serializers = [json])]
pub struct PlatformConfig {
    pub schema_version: u32,
    pub network_domain: String,
    pub creation_deposit: U128,
    pub company_count: U64,
    pub total_accounted: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SharedTreasury {
    network_domain: String,
    companies: LookupMap<String, Vec<u8>>,
    total_accounted: u128,
    company_count: u64,
}

#[near]
impl SharedTreasury {
    #[init]
    pub fn new(network_domain: String) -> Self {
        require!(
            network_domain == "near:testnet" || network_domain == "near:mainnet",
            "Invalid network domain"
        );
        Self {
            network_domain,
            companies: LookupMap::new(b"companies".as_slice()),
            total_accounted: 0,
            company_count: 0,
        }
    }

    pub fn get_platform_config(&self) -> PlatformConfig {
        PlatformConfig {
            schema_version: 5,
            network_domain: self.network_domain.clone(),
            creation_deposit: U128(CREATE_DEPOSIT),
            company_count: U64(self.company_count),
            total_accounted: U128(self.total_accounted),
        }
    }

    pub fn get_company_id(&self, owner: AccountId, company_key: String) -> String {
        company_id(&owner, &company_key)
    }
    pub fn company_exists(&self, company_id: String) -> bool {
        self.companies.contains_key(&company_id)
    }

    #[payable]
    pub fn create_company(&mut self, company_key: String) -> String {
        let owner = env::predecessor_account_id();
        let id = company_id(&owner, &company_key);
        require!(!self.companies.contains_key(&id), "Company already exists");
        require!(
            env::attached_deposit().as_yoctonear() == CREATE_DEPOSIT,
            "Attach exactly creation_deposit"
        );
        let before = env::storage_usage();
        let mut engine = TreasuryContract::new_shared(
            InitConfig {
                owner,
                network_domain: self.network_domain.clone(),
                max_total_permissions: None,
                max_pending_executions: None,
                min_operating_reserve: Some(U128(OPERATING_FLOOR)),
                callback_gas: Some(Gas::from_tgas(40)),
                transfer_gas: None,
            },
            id.clone(),
        );
        engine.config.operating_budget_remaining = U128(OPERATING_FLOOR);
        engine.config.storage_funding_remaining = U128(CREATE_DEPOSIT - OPERATING_FLOOR);
        engine.flush_collections();
        self.companies
            .insert(id.clone(), borsh::to_vec(&engine).unwrap());
        self.companies.flush();
        let storage_cost = u128::from(env::storage_usage().saturating_sub(before))
            * env::storage_byte_cost().as_yoctonear();
        engine.config.storage_funding_remaining.0 = engine
            .config
            .storage_funding_remaining
            .0
            .checked_sub(storage_cost)
            .expect("Company storage deposit insufficient");
        self.total_accounted = self
            .total_accounted
            .checked_add(obligation(&engine))
            .expect("Accounting overflow");
        self.company_count = self
            .company_count
            .checked_add(1)
            .expect("Company count overflow");
        self.companies
            .insert(id.clone(), borsh::to_vec(&engine).unwrap());
        self.companies.flush();
        self.assert_solvent(0);
        env::log_str(&serde_json::json!({"event":"company_created","company_id":id,"owner":engine.config.owner}).to_string());
        id
    }

    pub fn get_config(&self, company_id: String) -> TreasuryConfig {
        self.load(&company_id).get_config()
    }
    pub fn get_treasury_budget(&self, company_id: String, asset: AssetId) -> TreasuryBudget {
        self.load(&company_id).get_treasury_budget(asset)
    }
    pub fn get_spending_snapshot(
        &self,
        company_id: String,
        permission_id: U64,
        actor: AccountId,
        asset: AssetId,
    ) -> SpendingSnapshot {
        self.load(&company_id)
            .get_spending_snapshot(permission_id, actor, asset)
    }
    pub fn get_spending_snapshots(
        &self,
        company_id: String,
        queries: Vec<SpendingQuery>,
        asset: AssetId,
    ) -> Vec<SpendingSnapshot> {
        self.load(&company_id)
            .get_spending_snapshots(queries, asset)
    }
    pub fn get_reserved_budget(
        &self,
        company_id: String,
        permission_id: U64,
        asset: AssetId,
        exclude_child: Option<U64>,
    ) -> U128 {
        self.load(&company_id)
            .get_reserved_budget(permission_id, asset, exclude_child)
    }

    pub fn get_permission(&self, company_id: String, permission_id: U64) -> Option<Permission> {
        self.load(&company_id).get_permission(permission_id)
    }
    pub fn get_permission_path(&self, company_id: String, permission_id: U64) -> Vec<Permission> {
        self.load(&company_id).get_permission_path(permission_id)
    }
    pub fn is_principal_blocked(&self, company_id: String, account: AccountId) -> bool {
        self.load(&company_id).is_principal_blocked(account)
    }
    pub fn get_permission_usage(&self, company_id: String, permission_id: U64) -> PermissionUsage {
        self.load(&company_id).get_permission_usage(permission_id)
    }
    pub fn get_asset_ledger(&self, company_id: String, asset: AssetId) -> Option<AssetLedger> {
        self.load(&company_id).get_asset_ledger(asset)
    }
    pub fn get_registered_assets(&self, company_id: String) -> Vec<AssetId> {
        self.load(&company_id).get_registered_assets()
    }
    pub fn get_usage(
        &self,
        company_id: String,
        permission_id: U64,
        asset: AssetId,
        scope: BudgetScope,
    ) -> Usage {
        self.load(&company_id)
            .get_usage(permission_id, asset, scope)
    }
    pub fn get_execution(&self, company_id: String, execution_id: U64) -> Option<Execution> {
        self.load(&company_id).get_execution(execution_id)
    }
    pub fn get_execution_by_request(
        &self,
        company_id: String,
        actor: AccountId,
        request_id: String,
    ) -> Option<Execution> {
        self.load(&company_id)
            .get_execution_by_request(actor, request_id)
    }
    pub fn get_approval(
        &self,
        company_id: String,
        request_hash: String,
        permission_id: U64,
        asset: AssetId,
    ) -> Option<ApprovalRecord> {
        self.load(&company_id)
            .get_approval(request_hash, permission_id, asset)
    }
    pub fn preview_execute(
        &self,
        company_id: String,
        actor: AccountId,
        request: ExecuteRequest,
    ) -> PreviewResult {
        self.load(&company_id).preview_execute(actor, request)
    }

    pub fn create_root_permission(&mut self, company_id: String, spec: PermissionSpec) -> U64 {
        self.update(company_id, false, |e| e.create_root_permission(spec))
    }
    pub fn create_child_permission(
        &mut self,
        company_id: String,
        parent_id: U64,
        spec: PermissionSpec,
    ) -> U64 {
        self.update(company_id, false, |e| {
            e.create_child_permission(parent_id, spec)
        })
    }
    pub fn revoke_permission(&mut self, company_id: String, permission_id: U64) {
        self.update(company_id, false, |e| e.revoke_permission(permission_id))
    }
    pub fn set_principal_blocked(&mut self, company_id: String, account: AccountId, blocked: bool) {
        self.update(company_id, false, |e| {
            e.set_principal_blocked(account, blocked)
        })
    }
    pub fn set_paused(&mut self, company_id: String, paused: bool) {
        self.update(company_id, false, |e| e.set_paused(paused))
    }
    pub fn invalidate_all_permissions(&mut self, company_id: String) {
        self.update(company_id, false, |e| e.invalidate_all_permissions())
    }
    pub fn nominate_owner(&mut self, company_id: String, nominee: AccountId) {
        self.update(company_id, false, |e| e.nominate_owner(nominee))
    }
    pub fn cancel_owner_nomination(&mut self, company_id: String) {
        self.update(company_id, false, |e| e.cancel_owner_nomination())
    }
    pub fn accept_ownership(&mut self, company_id: String) {
        self.update(company_id, false, |e| e.accept_ownership())
    }
    pub fn register_asset(&mut self, company_id: String, asset: AssetId) {
        self.update(company_id, false, |e| e.register_asset(asset))
    }
    pub fn set_asset_enabled(&mut self, company_id: String, asset: AssetId, enabled: bool) {
        self.update(company_id, false, |e| e.set_asset_enabled(asset, enabled))
    }
    #[payable]
    pub fn deposit_native(&mut self, company_id: String) {
        self.update(company_id, false, |e| e.deposit_native())
    }
    #[payable]
    pub fn top_up_operating(&mut self, company_id: String) {
        self.update(company_id, false, |e| e.top_up_operating())
    }
    #[payable]
    pub fn top_up_storage(&mut self, company_id: String) {
        self.update(company_id, false, |e| e.top_up_storage())
    }
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let message: FtDeposit =
            serde_json::from_str(&msg).expect("Expected company_id in token deposit message");
        self.update(message.company_id, false, |e| {
            e.ft_on_transfer(sender_id, amount, String::new())
        })
    }
    pub fn approve_request(
        &mut self,
        company_id: String,
        actor: AccountId,
        request: ExecuteRequest,
    ) {
        self.update(company_id, false, |e| e.approve_request(actor, request))
    }
    pub fn revoke_approval(
        &mut self,
        company_id: String,
        actor: AccountId,
        request: ExecuteRequest,
    ) {
        self.update(company_id, false, |e| e.revoke_approval(actor, request))
    }
    pub fn execute(&mut self, company_id: String, request: ExecuteRequest) -> U64 {
        self.update(company_id, false, |e| e.execute(request))
    }
    pub fn owner_withdraw(&mut self, company_id: String, request: OwnerWithdrawRequest) -> U64 {
        self.update(company_id, false, |e| e.owner_withdraw(request))
    }
    #[private]
    pub fn on_transfer_result(&mut self, company_id: String, execution_id: U64) -> Execution {
        self.update(company_id, true, |e| e.on_transfer_result(execution_id))
    }
    pub fn flag_unresolved(&mut self, company_id: String, execution_id: U64) {
        self.update(company_id, false, |e| e.flag_unresolved(execution_id))
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct FtDeposit {
    company_id: String,
}

pub fn company_id(owner: &AccountId, key: &str) -> String {
    require!(
        !key.is_empty()
            && key.len() <= 64
            && key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'),
        "Invalid company key"
    );
    hex::encode(env::sha256(format!("{}\0{}", owner, key).as_bytes()))
}
fn obligation(engine: &TreasuryContract) -> u128 {
    [
        engine
            .get_asset_ledger(AssetId::NativeNear)
            .map_or(0, |l| l.available.0),
        engine.config.storage_funding_remaining.0,
        engine.config.callback_storage_reserved.0,
        engine
            .config
            .operating_budget_remaining
            .0
            .max(engine.config.min_operating_reserve.0),
    ]
    .into_iter()
    .try_fold(0u128, |a, b| a.checked_add(b))
    .expect("Company accounting overflow")
}
impl SharedTreasury {
    fn load(&self, id: &str) -> TreasuryContract {
        require!(
            id.len() == 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "Invalid company ID"
        );
        let mut engine: TreasuryContract =
            borsh::from_slice(self.companies.get(id).expect("Company not found"))
                .expect("Invalid company state");
        engine.company_context = Some(id.into());
        engine
    }
    fn update<R>(
        &mut self,
        id: String,
        settlement: bool,
        call: impl FnOnce(&mut TreasuryContract) -> R,
    ) -> R {
        let mut engine = self.load(&id);
        let before = obligation(&engine);
        let next_execution = engine.config.next_execution_id;
        let result = call(&mut engine);
        engine.flush_collections();
        require!(
            engine.config.operating_budget_remaining.0 >= engine.config.min_operating_reserve.0,
            "Company operating reserve below minimum"
        );
        let outgoing = if engine.config.next_execution_id != next_execution {
            let record = engine
                .get_execution(next_execution)
                .expect("Missing new execution");
            match record.action.asset() {
                AssetId::NativeNear => record.action.amount(),
                AssetId::Nep141(_) => 1,
            }
        } else {
            0
        };
        self.total_accounted = self
            .total_accounted
            .checked_sub(before)
            .and_then(|v| v.checked_add(obligation(&engine)))
            .expect("Global accounting overflow");
        self.companies
            .insert(id.clone(), borsh::to_vec(&engine).unwrap());
        self.companies.flush();
        // Failed-transfer refunds arrive asynchronously. Settlement must release reservations;
        // subsequent mutations remain gated by the full physical solvency check.
        if !settlement {
            self.assert_solvent(outgoing);
        }
        env::log_str(&serde_json::json!({"event":"company_updated","company_id":id,"authority_epoch":engine.config.authority_epoch}).to_string());
        result
    }
    fn assert_solvent(&self, outgoing: u128) {
        let old_state_len = env::storage_read(b"STATE").map_or(0, |v| v.len() as u64);
        let projected = env::storage_usage()
            .checked_sub(old_state_len)
            .and_then(|v| v.checked_add(borsh::to_vec(self).unwrap().len() as u64))
            .and_then(|v| v.checked_add(if old_state_len == 0 { 5 } else { 0 }))
            .expect("Storage overflow");
        let required = u128::from(projected)
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .and_then(|v| v.checked_add(self.total_accounted))
            .and_then(|v| v.checked_add(outgoing))
            .expect("Global accounting overflow");
        require!(
            env::account_balance().as_yoctonear() >= required,
            "Shared treasury is not physically solvent"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, get_created_receipts, VMContextBuilder};
    use near_sdk::{testing_env, NearToken, PromiseResult};
    fn context(actor: usize, deposit: u128) -> VMContextBuilder {
        let mut c = VMContextBuilder::new();
        c.current_account_id(accounts(0))
            .predecessor_account_id(accounts(actor))
            .signer_account_id(accounts(actor))
            .account_balance(NearToken::from_near(1000))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(300))
            .block_timestamp(1_000_000_000);
        c
    }
    fn setup() -> (SharedTreasury, String, String) {
        testing_env!(context(1, CREATE_DEPOSIT).build());
        let mut s = SharedTreasury::new("near:testnet".into());
        let a = s.create_company("company".into());
        testing_env!(context(2, CREATE_DEPOSIT).build());
        let b = s.create_company("company".into());
        (s, a, b)
    }
    fn spec() -> PermissionSpec {
        PermissionSpec {
            delegate: accounts(3),
            valid_from_ms: U64(0),
            expires_at_ms: None,
            max_executions: Some(10),
            rules: vec![AssetRule {
                asset: AssetId::NativeNear,
                recipients: Recipients::Only(vec![accounts(4)]),
                min_per_action: None,
                max_per_action: Some(U128(1000)),
                lifetime_limit: Some(U128(1000)),
                fixed_window: None,
                streaming: None,
                approval: None,
                acknowledge_unbounded_budget: false,
            }],
            redelegation_depth: 1,
            metadata_hash: None,
        }
    }
    fn request() -> ExecuteRequest {
        ExecuteRequest {
            api_version: 1,
            request_id: "a".repeat(64),
            permission_id: U64(1),
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver: accounts(4),
                amount: U128(100),
            },
            deadline_ms: U64(10_000),
        }
    }
    fn funded() -> (SharedTreasury, String, String) {
        let (mut s, a, b) = setup();
        for (owner, id) in [(1, &a), (2, &b)] {
            testing_env!(context(owner, NearToken::from_near(1).as_yoctonear()).build());
            s.top_up_storage(id.clone());
            testing_env!(context(owner, 1000).build());
            s.deposit_native(id.clone());
            testing_env!(context(owner, 0).build());
            assert_eq!(s.create_root_permission(id.clone(), spec()), U64(1));
        }
        (s, a, b)
    }
    #[test]
    fn owners_funds_permissions_and_pause_are_isolated() {
        let (mut s, a, b) = funded();
        assert_ne!(a, b);
        assert_eq!(s.get_config(a.clone()).owner, accounts(1));
        assert_eq!(s.get_config(b.clone()).owner, accounts(2));
        assert_eq!(
            s.get_asset_ledger(a.clone(), AssetId::NativeNear)
                .unwrap()
                .available,
            U128(1000)
        );
        testing_env!(context(1, 0).build());
        s.set_paused(a.clone(), true);
        s.invalidate_all_permissions(a.clone());
        assert!(!s.get_config(b.clone()).paused);
        assert_eq!(s.get_config(b.clone()).authority_epoch, U64(1));
        assert_eq!(s.get_permission(a, U64(1)).unwrap().issuer, accounts(1));
        assert_eq!(s.get_permission(b, U64(1)).unwrap().issuer, accounts(2));
    }
    #[test]
    #[should_panic(expected = "ALLOCARD_UNAUTHORIZED")]
    fn cannot_revoke_another_company_permission() {
        let (mut s, _, b) = funded();
        testing_env!(context(1, 0).build());
        s.revoke_permission(b, U64(1));
    }
    #[test]
    fn identical_request_ids_and_execution_ids_settle_in_their_own_company() {
        let (mut s, a, b) = funded();
        testing_env!(context(3, 0).build());
        let a_id = s.execute(a.clone(), request());
        testing_env!(context(3, 0).build());
        let b_id = s.execute(b.clone(), request());
        assert_eq!(a_id, b_id);
        assert_ne!(
            s.get_execution(a.clone(), a_id).unwrap().request_hash,
            s.get_execution(b.clone(), b_id).unwrap().request_hash
        );
        let receipts = get_created_receipts();
        let callbacks: Vec<_> = receipts
            .iter()
            .filter(|r| r.receiver_id == accounts(0))
            .collect();
        assert_eq!(callbacks.len(), 1);
        use near_sdk::mock::MockAction;
        let args = callbacks[0]
            .actions
            .iter()
            .find_map(|action| {
                if let MockAction::FunctionCallWeight { args, .. } = action {
                    Some(args)
                } else {
                    None
                }
            })
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(args).unwrap()["company_id"],
            b
        );
        #[allow(deprecated)]
        near_sdk::test_utils::testing_env_with_promise_results(
            context(0, 0).build(),
            PromiseResult::Successful(vec![]),
        );
        s.on_transfer_result(a.clone(), a_id);
        assert_eq!(
            s.get_execution(a.clone(), a_id).unwrap().status,
            ExecutionStatus::Succeeded
        );
        assert_eq!(
            s.get_execution(b.clone(), b_id).unwrap().status,
            ExecutionStatus::Pending
        );
        #[allow(deprecated)]
        near_sdk::test_utils::testing_env_with_promise_results(
            context(0, 0).build(),
            PromiseResult::Failed,
        );
        s.on_transfer_result(b.clone(), b_id);
        assert_eq!(
            s.get_execution(b.clone(), b_id).unwrap().status,
            ExecutionStatus::Failed
        );
        assert_eq!(
            s.get_asset_ledger(a.clone(), AssetId::NativeNear)
                .unwrap()
                .available,
            U128(900)
        );
        assert_eq!(
            s.get_asset_ledger(b.clone(), AssetId::NativeNear)
                .unwrap()
                .available,
            U128(1000)
        );
        assert_eq!(
            s.get_usage(
                a.clone(),
                U64(1),
                AssetId::NativeNear,
                BudgetScope::Lifetime
            )
            .settled,
            U128(100)
        );
        assert_eq!(
            s.get_usage(
                b.clone(),
                U64(1),
                AssetId::NativeNear,
                BudgetScope::Lifetime
            )
            .settled,
            U128(0)
        );
        testing_env!(context(3, 0).build());
        assert_eq!(s.execute(a.clone(), request()), a_id);
        assert_eq!(s.get_permission_usage(a, U64(1)).executions_count, 1);
    }
    #[test]
    #[should_panic(expected = "Shared treasury is not physically solvent")]
    fn cannot_use_another_company_reserves_to_cover_missing_funds() {
        let (mut s, a, _) = funded();
        let mut c = context(1, 0);
        c.account_balance(NearToken::from_yoctonear(s.total_accounted));
        testing_env!(c.build());
        s.set_paused(a, true);
    }
    #[test]
    fn company_creation_never_credits_spendable_principal() {
        let (s, a, b) = setup();
        assert_eq!(
            s.get_asset_ledger(a.clone(), AssetId::NativeNear)
                .unwrap()
                .available,
            U128(0)
        );
        assert!(s.get_config(a).storage_funding_remaining.0 > 0);
        assert_eq!(s.get_config(b).schema_version, 5);
        assert_eq!(s.company_count, 2);
    }
    #[test]
    #[should_panic(expected = "Company already exists")]
    fn duplicate_creation_does_not_register_again() {
        let (mut s, _, _) = setup();
        testing_env!(context(1, CREATE_DEPOSIT).build());
        s.create_company("company".into());
    }
    #[test]
    fn token_deposits_and_registered_assets_are_company_scoped() {
        let (mut s, a, b) = funded();
        let token = accounts(5);
        for (owner, id) in [(1, &a), (2, &b)] {
            testing_env!(context(owner, 0).build());
            s.register_asset(id.clone(), AssetId::Nep141(token.clone()));
            s.set_asset_enabled(id.clone(), AssetId::Nep141(token.clone()), true);
        }
        testing_env!(context(5, 0).build());
        assert_eq!(
            s.ft_on_transfer(
                accounts(1),
                U128(500),
                serde_json::json!({"company_id":a}).to_string()
            ),
            U128(0)
        );
        assert_eq!(
            s.get_asset_ledger(a.clone(), AssetId::Nep141(token.clone()))
                .unwrap()
                .available,
            U128(500)
        );
        assert_eq!(
            s.get_asset_ledger(b.clone(), AssetId::Nep141(token))
                .unwrap()
                .available,
            U128(0)
        );
        assert_eq!(
            s.get_asset_ledger(a, AssetId::NativeNear)
                .unwrap()
                .available,
            U128(1000)
        );
    }
}
