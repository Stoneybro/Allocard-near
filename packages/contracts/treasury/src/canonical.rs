use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::AccountId;
use sha2::{Digest, Sha256};

use crate::errors::*;
use crate::types::{Action, ExecuteRequest, GrantId, OwnerWithdrawRequest};

pub const EXECUTE_DOMAIN: &str = "ALLOCARD_EXECUTE_V1";
pub const OWNER_WITHDRAW_DOMAIN: &str = "ALLOCARD_OWNER_WITHDRAW_V1";

/// Versioned Borsh-serializable envelope for delegated execution requests.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct ExecuteEnvelope {
    pub domain: String,
    pub network_domain: String,
    pub contract_id: AccountId,
    pub actor: AccountId,
    pub api_version: u16,
    pub request_id: [u8; 32],
    pub grant_id: GrantId,
    pub action: Action,
    pub deadline_ms: u64,
}

/// Versioned Borsh-serializable envelope for owner direct liquidity withdrawal requests.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct OwnerWithdrawEnvelope {
    pub domain: String,
    pub network_domain: String,
    pub contract_id: AccountId,
    pub actor: AccountId,
    pub api_version: u16,
    pub request_id: [u8; 32],
    pub authority_epoch: u64,
    pub action: Action,
    pub deadline_ms: u64,
}

/// Parses a 64-character lowercase hex string into a 32-byte array.
pub fn parse_request_id(hex_str: &str) -> Result<[u8; 32], &'static str> {
    if hex_str.len() != 64 {
        return Err(ERR_INVALID_INPUT);
    }
    // Must be lowercase hex
    for b in hex_str.bytes() {
        if !b.is_ascii_digit() && !(b'a'..=b'f').contains(&b) {
            return Err(ERR_INVALID_INPUT);
        }
    }
    let mut bytes = [0u8; 32];
    hex::decode_to_slice(hex_str, &mut bytes).map_err(|_| ERR_INVALID_INPUT)?;
    Ok(bytes)
}

/// Computes the canonical SHA-256 request hash for a delegated execute request.
pub fn compute_execute_hash(
    network_domain: &str,
    contract_id: &AccountId,
    actor: &AccountId,
    request: &ExecuteRequest,
) -> Result<([u8; 32], [u8; 32]), &'static str> {
    let request_id_bytes = parse_request_id(&request.request_id)?;
    let envelope = ExecuteEnvelope {
        domain: EXECUTE_DOMAIN.to_string(),
        network_domain: network_domain.to_string(),
        contract_id: contract_id.clone(),
        actor: actor.clone(),
        api_version: request.api_version,
        request_id: request_id_bytes,
        grant_id: request.grant_id.0,
        action: request.action.clone(),
        deadline_ms: request.deadline_ms.0,
    };

    let serialized = near_sdk::borsh::to_vec(&envelope).map_err(|_| ERR_INVALID_INPUT)?;
    let hash: [u8; 32] = Sha256::digest(&serialized).into();
    Ok((request_id_bytes, hash))
}

/// Computes the canonical SHA-256 request hash for an owner withdrawal request.
pub fn compute_owner_withdraw_hash(
    network_domain: &str,
    contract_id: &AccountId,
    actor: &AccountId,
    request: &OwnerWithdrawRequest,
) -> Result<([u8; 32], [u8; 32]), &'static str> {
    let request_id_bytes = parse_request_id(&request.request_id)?;
    let envelope = OwnerWithdrawEnvelope {
        domain: OWNER_WITHDRAW_DOMAIN.to_string(),
        network_domain: network_domain.to_string(),
        contract_id: contract_id.clone(),
        actor: actor.clone(),
        api_version: request.api_version,
        request_id: request_id_bytes,
        authority_epoch: request.authority_epoch.0,
        action: request.action.clone(),
        deadline_ms: request.deadline_ms.0,
    };

    let serialized = near_sdk::borsh::to_vec(&envelope).map_err(|_| ERR_INVALID_INPUT)?;
    let hash: [u8; 32] = Sha256::digest(&serialized).into();
    Ok((request_id_bytes, hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AssetId;
    use near_sdk::json_types::{U128, U64};

    #[test]
    fn test_parse_request_id_valid() {
        let hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let parsed = parse_request_id(hex).expect("should parse valid 64-char lowercase hex");
        assert_eq!(hex::encode(parsed), hex);
    }

    #[test]
    fn test_parse_request_id_invalid_length() {
        assert!(parse_request_id("0123456789abcdef").is_err());
    }

    #[test]
    fn test_parse_request_id_invalid_uppercase() {
        let hex_upper = "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef";
        assert!(parse_request_id(hex_upper).is_err());
    }

    #[test]
    fn test_compute_execute_hash_deterministic() {
        let network_domain = "near:mainnet";
        let contract_id: AccountId = "treasury.allocard.near".parse().unwrap();
        let actor: AccountId = "employee.near".parse().unwrap();
        let receiver: AccountId = "vendor.near".parse().unwrap();

        let request = ExecuteRequest {
            api_version: 1,
            request_id: "a000000000000000000000000000000000000000000000000000000000000001".to_string(),
            grant_id: U64(42),
            action: Action::Transfer {
                asset: AssetId::NativeNear,
                receiver,
                amount: U128(1_000_000_000_000_000_000_000_000), // 1 NEAR
            },
            deadline_ms: U64(1_700_000_000_000),
        };

        let (req_id, hash1) = compute_execute_hash(network_domain, &contract_id, &actor, &request).unwrap();
        let (_, hash2) = compute_execute_hash(network_domain, &contract_id, &actor, &request).unwrap();

        assert_eq!(hash1, hash2);
        assert_eq!(req_id[0], 0xa0);
        assert_eq!(req_id[31], 0x01);
    }
}
