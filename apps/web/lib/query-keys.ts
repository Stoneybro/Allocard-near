import { NETWORK_ID } from "./chain";

// Every private query belongs to one verified provider identity and wallet.
export const accountQueryKey = (providerUserId: string | null, walletAddress: string | null) =>
  ["allocard", NETWORK_ID, providerUserId, walletAddress] as const;
