use near_sdk::near;

#[near(contract_state)]
#[derive(Default)]
pub struct TreasuryContract {}

#[near]
impl TreasuryContract {
    #[init]
    pub fn new() -> Self {
        Self {}
    }

    pub fn get_version(&self) -> String {
        "0.1.0".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        let contract = TreasuryContract::new();
        assert_eq!(contract.get_version(), "0.1.0");
    }
}

