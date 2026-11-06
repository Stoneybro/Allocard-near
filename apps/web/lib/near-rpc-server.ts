import { NEAR_RPC_URL } from "./chain";
export function nearRpcServerUrl() {
  return process.env.NEAR_RPC_URL || NEAR_RPC_URL;
}
