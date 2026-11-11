import type { AssetId } from "@allocard/delegation-sdk";

// Active Network: NEAR Testnet
export const NETWORK_ID = "testnet";
export const CHAIN_NAME = "NEAR Testnet";
export const MOCK_USDC_ACCOUNT_ID = process.env.NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID?.trim() || null;
export const SPENDING_ASSET: AssetId = MOCK_USDC_ACCOUNT_ID
  ? { type: "Nep141", contract_id: MOCK_USDC_ACCOUNT_ID }
  : { type: "NativeNear" };
export const SPENDING_DECIMALS = MOCK_USDC_ACCOUNT_ID ? 6 : 24;
export const TOKEN_SYMBOL = MOCK_USDC_ACCOUNT_ID ? "USDC" : "NEAR";

export function sameAsset(left: AssetId, right: AssetId): boolean {
  return left.type === "NativeNear"
    ? right.type === "NativeNear"
    : right.type === "Nep141" && left.contract_id === right.contract_id;
}

export const ACTIVATION_USDC = "2000";
export const FAUCET_USDC = "1000";
export const NATIVE_SYMBOL = "NEAR";
export const EXPLORER_URL = "https://testnet.nearblocks.io";
export const NEAR_RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://rpc.testnet.near.org";
export const DEFAULT_TREASURY_CONTRACT = process.env.NEXT_PUBLIC_TREASURY_CONTRACT || "allocard-treasury-1793568689802.testnet";

export function getTxExplorerUrl(txHash?: string | null): string {
  if (!txHash) return EXPLORER_URL;
  return `${EXPLORER_URL}/txns/${txHash}`;
}

export function getAddressExplorerUrl(address?: string | null): string {
  if (!address) return EXPLORER_URL;
  return `${EXPLORER_URL}/address/${address.split("#")[0]}`;
}

export const NEAR_DECIMALS = 24;
export const NETWORK_DOMAIN = `near:${NETWORK_ID}`;
