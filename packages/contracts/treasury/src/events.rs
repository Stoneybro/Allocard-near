use near_sdk::json_types::U64;
use near_sdk::serde::Serialize;
use near_sdk::{env, AccountId};

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde", tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum EventLogData<'a> {
    TreasuryInitialized {
        network_domain: &'a str,
        owner: &'a AccountId,
    },
    PermissionCreated {
        permission_id: U64,
        parent_id: Option<U64>,
        issuer: &'a AccountId,
        delegate: &'a AccountId,
        depth: u8,
        epoch: U64,
    },
    PermissionRevoked {
        permission_id: U64,
        revoker: &'a AccountId,
    },
    PrincipalBlockChanged {
        principal: &'a AccountId,
        blocked: bool,
    },
    PauseChanged {
        paused: bool,
    },
    AuthorityEpochChanged {
        new_epoch: U64,
    },
    OwnerNominated {
        nominee: &'a AccountId,
    },
    OwnerChanged {
        old_owner: &'a AccountId,
        new_owner: &'a AccountId,
    },
    AssetRegistered {
        asset: String,
    },
    AssetStatusChanged {
        asset: String,
        enabled: bool,
    },
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Nep297Event<'a> {
    standard: &'static str,
    version: &'static str,
    #[serde(flatten)]
    event_data: EventLogData<'a>,
}

pub fn emit_event(event: EventLogData) {
    let nep297 = Nep297Event {
        standard: "allocard",
        version: "1.0.0",
        event_data: event,
    };
    if let Ok(json) = near_sdk::serde_json::to_string(&nep297) {
        env::log_str(&format!("EVENT_JSON:{}", json));
    }
}
