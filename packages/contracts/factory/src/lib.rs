use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const RECORD_FUNDING: u128 = 20_000_000_000_000_000_000_000; // 0.02 NEAR; retained registry storage funding

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Pending,
    Ready,
    RefundAvailable,
    Refunding,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Creation {
    pub owner: AccountId,
    pub treasury_id: AccountId,
    pub status: Status,
    pub account_funding: U128,
}

#[near(serializers = [json])]
pub struct Config {
    pub schema_version: u32,
    pub treasury_code_hash: Base58CryptoHash,
    pub network_domain: String,
    pub account_funding: U128,
    pub record_funding: U128,
    pub creation_deposit: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    code_hash: [u8; 32],
    network_domain: String,
    account_funding: u128,
    records: LookupMap<String, Creation>,
}

#[near]
impl Factory {
    #[init]
    pub fn new(
        treasury_code_hash: Base58CryptoHash,
        network_domain: String,
        account_funding: U128,
    ) -> Self {
        require!(
            env::current_account_id().as_str().len() <= 29,
            "Factory account ID is too long"
        );
        require!(
            network_domain == "near:testnet" || network_domain == "near:mainnet",
            "Invalid domain"
        );
        require!(
            account_funding.0 >= NearToken::from_millinear(150).as_yoctonear()
                && account_funding.0 <= NearToken::from_near(1).as_yoctonear(),
            "Account funding must be 0.15 to 1 NEAR"
        );
        Self {
            code_hash: treasury_code_hash.into(),
            network_domain,
            account_funding: account_funding.0,
            records: LookupMap::new(b"r"),
        }
    }

    pub fn get_config(&self) -> Config {
        Config {
            schema_version: 1,
            treasury_code_hash: self.code_hash.into(),
            network_domain: self.network_domain.clone(),
            account_funding: U128(self.account_funding),
            record_funding: U128(RECORD_FUNDING),
            creation_deposit: U128(self.account_funding + RECORD_FUNDING),
        }
    }

    pub fn get_creation(&self, owner: AccountId, company_key: String) -> Option<Creation> {
        self.records.get(&self.label(&owner, &company_key)).cloned()
    }

    pub fn get_treasury_id(&self, owner: AccountId, company_key: String) -> AccountId {
        self.account(&self.label(&owner, &company_key))
    }

    /// One atomic child receipt creates, funds, references immutable code and initializes.
    /// No access keys, upgrade method, or withdrawal authority are retained by the factory.
    #[payable]
    pub fn create_company(&mut self, company_key: String) -> Promise {
        let owner = env::predecessor_account_id();
        let label = self.label(&owner, &company_key);
        require!(
            self.records
                .get(&label)
                .is_none_or(|record| record.status == Status::Refunded),
            "Creation already exists; inspect get_creation before retrying"
        );
        require!(
            env::attached_deposit().as_yoctonear() == self.account_funding + RECORD_FUNDING,
            "Attach exactly creation_deposit"
        );
        require!(
            env::prepaid_gas() >= Gas::from_tgas(100),
            "Attach at least 100 Tgas"
        );
        let treasury_id = self.account(&label);
        let before = env::storage_usage();
        self.records.insert(
            label.clone(),
            Creation {
                owner: owner.clone(),
                treasury_id: treasury_id.clone(),
                status: Status::Pending,
                account_funding: U128(self.account_funding),
            },
        );
        self.records.flush();
        let cost = u128::from(env::storage_usage().saturating_sub(before))
            * env::storage_byte_cost().as_yoctonear();
        require!(
            cost <= RECORD_FUNDING,
            "Registry storage funding insufficient"
        );
        Promise::new(treasury_id)
            .create_account()
            .transfer(NearToken::from_yoctonear(self.account_funding))
            .use_global_contract(self.code_hash)
            .function_call("new", serde_json::to_vec(&serde_json::json!({"config":{"owner":owner,"network_domain":self.network_domain}})).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(40))
            .then(Promise::new(env::current_account_id()).function_call("on_created", serde_json::to_vec(&serde_json::json!({"label":label})).unwrap(), NearToken::from_yoctonear(0), Gas::from_tgas(15)))
    }

    #[private]
    pub fn on_created(&mut self, label: String) -> Creation {
        let mut record = self.records.get(&label).expect("Unknown creation").clone();
        require!(record.status == Status::Pending, "Invalid creation state");
        record.status = if env::promise_result_checked(0, 4096).is_ok() {
            Status::Ready
        } else {
            Status::RefundAvailable
        };
        self.records.insert(label, record.clone());
        record
    }

    /// Refund only the failed child's account funding. Registry funding remains for the audit record.
    /// Explicit claims tolerate the protocol's asynchronous return of failed-receipt deposits.
    pub fn claim_refund(&mut self, company_key: String) -> Promise {
        let owner = env::predecessor_account_id();
        let label = self.label(&owner, &company_key);
        let mut record = self.records.get(&label).expect("Unknown creation").clone();
        require!(
            record.owner == owner && record.status == Status::RefundAvailable,
            "Refund unavailable"
        );
        let storage = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
        require!(
            env::account_balance()
                .as_yoctonear()
                .saturating_sub(storage + NearToken::from_millinear(10).as_yoctonear())
                >= record.account_funding.0,
            "Refund not yet liquid; retry after finality"
        );
        record.status = Status::Refunding;
        self.records.insert(label.clone(), record.clone());
        Promise::new(owner)
            .transfer(NearToken::from_yoctonear(record.account_funding.0))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_refunded",
                serde_json::to_vec(&serde_json::json!({"label":label})).unwrap(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            ))
    }

    #[private]
    pub fn on_refunded(&mut self, label: String) -> Creation {
        let mut record = self.records.get(&label).expect("Unknown creation").clone();
        require!(record.status == Status::Refunding, "Invalid refund state");
        record.status = if env::promise_result_checked(0, 4096).is_ok() {
            Status::Refunded
        } else {
            Status::RefundAvailable
        };
        self.records.insert(label, record.clone());
        record
    }
}

impl Factory {
    fn label(&self, owner: &AccountId, company_key: &str) -> String {
        require!(
            !company_key.is_empty()
                && company_key.len() <= 64
                && company_key
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'),
            "Invalid company key"
        );
        let digest = env::sha256(format!("{}\0{}", owner, company_key).as_bytes());
        format!("c-{}", &hex::encode(digest)[..32])
    }
    fn account(&self, label: &str) -> AccountId {
        format!("{}.{}", label, env::current_account_id())
            .parse()
            .expect("Invalid child account")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::{
        test_utils::{get_created_receipts, VMContextBuilder},
        testing_env,
    };
    fn setup(deposit: u128) -> Factory {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id("factory.testnet".parse().unwrap())
            .predecessor_account_id("owner.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(200));
        testing_env!(context.build());
        Factory::new(
            [7; 32].into(),
            "near:testnet".into(),
            U128(NearToken::from_millinear(200).as_yoctonear()),
        )
    }
    #[test]
    fn namespaces_accounts_by_owner_and_company() {
        let f = setup(0);
        let a = f.get_treasury_id("owner.testnet".parse().unwrap(), "company-1".into());
        assert_eq!(
            a,
            f.get_treasury_id("owner.testnet".parse().unwrap(), "company-1".into())
        );
        assert_ne!(
            a,
            f.get_treasury_id("other.testnet".parse().unwrap(), "company-1".into())
        );
        assert_ne!(
            a,
            f.get_treasury_id("owner.testnet".parse().unwrap(), "company-2".into())
        );
    }
    #[test]
    fn creates_keyless_hash_pinned_treasury_owned_by_caller() {
        let mut f = setup(NearToken::from_millinear(220).as_yoctonear());
        drop(f.create_company("company-1".into()));
        let record = f
            .get_creation("owner.testnet".parse().unwrap(), "company-1".into())
            .unwrap();
        assert_eq!(record.status, Status::Pending);
        let receipts = get_created_receipts();
        let child = receipts
            .iter()
            .find(|r| r.receiver_id == record.treasury_id)
            .unwrap();
        assert!(child
            .actions
            .iter()
            .any(|a| matches!(a, MockAction::UseGlobalContract { .. })));
        assert_eq!(child.actions.len(), 4);
        let init = child
            .actions
            .iter()
            .find_map(|a| {
                if let MockAction::FunctionCallWeight { args, .. } = a {
                    Some(args)
                } else {
                    None
                }
            })
            .unwrap();
        let args: serde_json::Value = serde_json::from_slice(init).unwrap();
        assert_eq!(args["config"]["owner"], "owner.testnet");
    }
    #[test]
    #[should_panic(expected = "Attach exactly")]
    fn rejects_underfunding() {
        let mut f = setup(0);
        drop(f.create_company("company-1".into()));
    }
    #[test]
    #[should_panic(expected = "Creation already exists")]
    fn rejects_duplicate_creation_without_new_receipts() {
        let mut f = setup(NearToken::from_millinear(220).as_yoctonear());
        drop(f.create_company("company-1".into()));
        drop(f.create_company("company-1".into()));
    }
    #[test]
    #[allow(deprecated)]
    fn settles_creation_and_failed_refunds_without_repaying_twice() {
        use near_sdk::test_utils::testing_env_with_promise_results;
        use near_sdk::PromiseResult;
        let mut f = setup(NearToken::from_millinear(220).as_yoctonear());
        drop(f.create_company("company-1".into()));
        let label = f.label(&"owner.testnet".parse().unwrap(), "company-1");
        let mut context = VMContextBuilder::new();
        context
            .current_account_id("factory.testnet".parse().unwrap())
            .predecessor_account_id("factory.testnet".parse().unwrap());
        testing_env_with_promise_results(context.build(), PromiseResult::Failed);
        assert_eq!(f.on_created(label.clone()).status, Status::RefundAvailable);
        context.predecessor_account_id("owner.testnet".parse().unwrap());
        testing_env!(context.build());
        drop(f.claim_refund("company-1".into()));
        assert_eq!(f.records.get(&label).unwrap().status, Status::Refunding);
        context.predecessor_account_id("factory.testnet".parse().unwrap());
        testing_env_with_promise_results(context.build(), PromiseResult::Failed);
        assert_eq!(f.on_refunded(label.clone()).status, Status::RefundAvailable);
        context.predecessor_account_id("owner.testnet".parse().unwrap());
        testing_env!(context.build());
        drop(f.claim_refund("company-1".into()));
        context.predecessor_account_id("factory.testnet".parse().unwrap());
        testing_env_with_promise_results(context.build(), PromiseResult::Successful(vec![]));
        assert_eq!(f.on_refunded(label).status, Status::Refunded);
    }
    #[test]
    #[allow(deprecated)]
    fn marks_ready_only_after_successful_initialization() {
        use near_sdk::{test_utils::testing_env_with_promise_results, PromiseResult};
        let mut f = setup(NearToken::from_millinear(220).as_yoctonear());
        drop(f.create_company("company-1".into()));
        let label = f.label(&"owner.testnet".parse().unwrap(), "company-1");
        let mut context = VMContextBuilder::new();
        context
            .current_account_id("factory.testnet".parse().unwrap())
            .predecessor_account_id("factory.testnet".parse().unwrap());
        testing_env_with_promise_results(context.build(), PromiseResult::Successful(vec![]));
        assert_eq!(f.on_created(label).status, Status::Ready);
    }
    #[test]
    #[should_panic(expected = "Refund unavailable")]
    fn cannot_claim_a_pending_refund_twice() {
        let mut f = setup(NearToken::from_millinear(220).as_yoctonear());
        drop(f.create_company("company-1".into()));
        let label = f.label(&"owner.testnet".parse().unwrap(), "company-1");
        let mut record = f.records.get(&label).unwrap().clone();
        record.status = Status::RefundAvailable;
        f.records.insert(label, record);
        drop(f.claim_refund("company-1".into()));
        drop(f.claim_refund("company-1".into()));
    }

    #[test]
    fn refunded_creation_can_retry_with_the_same_treasury_identity() {
        let mut f = setup(NearToken::from_millinear(220).as_yoctonear());
        drop(f.create_company("company-1".into()));
        let label = f.label(&"owner.testnet".parse().unwrap(), "company-1");
        let mut record = f.records.get(&label).unwrap().clone();
        let original = record.treasury_id.clone();
        record.status = Status::Refunded;
        f.records.insert(label.clone(), record);
        drop(f.create_company("company-1".into()));
        assert_eq!(f.records.get(&label).unwrap().treasury_id, original);
        assert_eq!(f.records.get(&label).unwrap().status, Status::Pending);
    }
}
