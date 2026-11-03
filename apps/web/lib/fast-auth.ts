"use client";

import {
  FAST_AUTH_AUTH0_DEFAULTS,
  JavascriptProvider,
} from "@fast-auth-near/javascript-provider";
import { FastAuthClient } from "@fast-auth-near/browser-sdk";
import {
  connect,
  keyStores,
  Connection,
  utils,
} from "near-api-js";
import type { NearCaller } from "@allocard/delegation-sdk";
import { NEAR_RPC_URL } from "./chain";

export const FAST_AUTH_TESTNET_CONFIG = {
  network: "testnet" as const,
  clientId: "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
  domain: "login.testnet.fast-auth.com",
  signingAudience: "auth0.jwt.fast-auth.testnet",
  fastAuthContractId: "fast-auth.testnet",
  mpcContractId: "v1.signer-prod.testnet",
};

let providerInstance: JavascriptProvider | null = null;
let clientInstance: FastAuthClient | null = null;
let connectionInstance: Connection | null = null;

export function getFastAuthProvider(): JavascriptProvider | null {
  if (typeof window === "undefined") return null;
  if (!providerInstance) {
    providerInstance = new JavascriptProvider({
      network: FAST_AUTH_TESTNET_CONFIG.network,
      clientId: FAST_AUTH_TESTNET_CONFIG.clientId,
      domain: FAST_AUTH_TESTNET_CONFIG.domain,
      signingAudience: FAST_AUTH_TESTNET_CONFIG.signingAudience,
    });
  }
  return providerInstance;
}

export async function getNearConnection(): Promise<Connection> {
  if (!connectionInstance) {
    const near = await connect({
      networkId: FAST_AUTH_TESTNET_CONFIG.network,
      nodeUrl: NEAR_RPC_URL,
      keyStore: typeof window !== "undefined"
        ? new keyStores.BrowserLocalStorageKeyStore()
        : new keyStores.InMemoryKeyStore(),
    });
    connectionInstance = near.connection;
  }
  return connectionInstance;
}

export async function getFastAuthClient(): Promise<FastAuthClient | null> {
  if (typeof window === "undefined") return null;
  if (!clientInstance) {
    const provider = getFastAuthProvider();
    if (!provider) return null;
    const connection = await getNearConnection();
    clientInstance = new FastAuthClient(provider, connection, {
      fastAuthContractId: FAST_AUTH_TESTNET_CONFIG.fastAuthContractId,
      mpcContractId: FAST_AUTH_TESTNET_CONFIG.mpcContractId,
    });
  }
  return clientInstance;
}

export type FastAuthIdentity = {
  userId: string;
  publicKey: string;
  implicitAccountId: string;
  email: string | null;
};

/**
 * Checks if a FastAuth session is currently active.
 */
export async function isFastAuthAuthenticated(): Promise<boolean> {
  const provider = getFastAuthProvider();
  if (!provider) return false;
  try {
    return await provider.isLoggedIn();
  } catch {
    return false;
  }
}

/**
 * Initiates the FastAuth login flow.
 * Default is a popup flow; passing redirectUri triggers a full-page redirect.
 */
export async function loginWithFastAuth(options?: { redirectUri?: string }): Promise<FastAuthIdentity> {
  const provider = getFastAuthProvider();
  if (!provider) throw new Error("FastAuth provider unavailable in current environment");

  if (options?.redirectUri) {
    await provider.login({ redirectUri: options.redirectUri });
  } else {
    await provider.login();
  }

  return await getFastAuthIdentity();
}

/**
 * Logs out of FastAuth.
 */
export async function logoutFastAuth(): Promise<void> {
  const provider = getFastAuthProvider();
  if (!provider) return;
  try {
    await provider.logout();
  } catch (err) {
    console.warn("FastAuth logout error:", err);
  }
}

/**
 * Derives the implicit 64-character hex NEAR account ID from a public key.
 */
export function deriveImplicitAccountId(publicKeyObj: any): string {
  if (publicKeyObj?.data) {
    return Buffer.from(publicKeyObj.data).toString("hex");
  }
  const pk = utils.PublicKey.fromString(publicKeyObj.toString());
  return Buffer.from(pk.data).toString("hex");
}

/**
 * Retrieves the authenticated FastAuth user and derives their MPC public key
 * and implicit NEAR account ID.
 */
export async function getFastAuthIdentity(): Promise<FastAuthIdentity> {
  const client = await getFastAuthClient();
  if (!client) throw new Error("FastAuth client not initialized");

  const signer = await client.getSigner();
  const publicKeyObj = await signer.getPublicKey("ed25519");
  const publicKeyStr = publicKeyObj.toString();
  const implicitAccountId = deriveImplicitAccountId(publicKeyObj);

  const provider = getFastAuthProvider();
  let email: string | null = null;
  let userId = implicitAccountId;

  if (provider) {
    try {
      const path = await provider.getPath();
      // Format: jwt#https://login.testnet.fast-auth.com/#auth0|12345
      const parts = path.split("#");
      userId = parts[parts.length - 1] || implicitAccountId;
      if (userId.includes("@")) {
        email = userId;
      } else {
        email = `${implicitAccountId.slice(0, 8)}@near.fastauth`;
      }
    } catch {
      // Fallback
    }
  }

  return {
    userId,
    publicKey: publicKeyStr,
    implicitAccountId,
    email,
  };
}

/**
 * Creates a NearCaller adapter backed by the FastAuth Signer or RPC caller.
 */
export function createFastAuthCaller(
  accountId: string,
  signer: any,
): NearCaller {
  return {
    accountId,
    async viewFunction({ contractId, methodName, args }) {
      const response = await fetch(NEAR_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `fastauth-view-${Date.now()}`,
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contractId,
            method_name: methodName,
            args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
          },
        }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || "View function error");
      }
      const bytes = data.result?.result;
      if (!bytes) return null;
      const str = new TextDecoder().decode(Uint8Array.from(bytes));
      return str ? JSON.parse(str) : null;
    },
    async functionCall() {
      throw new Error("FastAuth transaction submission is not configured; use a NEAR wallet.");
    },
  };
}
