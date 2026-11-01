import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Action, AssetId, ExecuteRequest, OwnerWithdrawRequest } from "./types.js";

export const EXECUTE_DOMAIN = "ALLOCARD_EXECUTE_V1";
export const OWNER_WITHDRAW_DOMAIN = "ALLOCARD_OWNER_WITHDRAW_V1";

export class BorshWriter {
  private buffer: Uint8Array;
  private offset: number;

  constructor(initialCapacity = 1024) {
    this.buffer = new Uint8Array(initialCapacity);
    this.offset = 0;
  }

  private ensureCapacity(additionalBytes: number) {
    if (this.offset + additionalBytes > this.buffer.length) {
      const newCapacity = Math.max(this.buffer.length * 2, this.offset + additionalBytes);
      const newBuffer = new Uint8Array(newCapacity);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
  }

  writeUint8(val: number) {
    this.ensureCapacity(1);
    this.buffer[this.offset] = val;
    this.offset += 1;
  }

  writeUint16LE(val: number) {
    if (!Number.isInteger(val) || val < 0 || val > 65535) throw new Error("Invalid u16");
    this.ensureCapacity(2);
    this.buffer[this.offset] = val & 0xff;
    this.buffer[this.offset + 1] = (val >> 8) & 0xff;
    this.offset += 2;
  }

  writeUint32LE(val: number) {
    this.ensureCapacity(4);
    this.buffer[this.offset] = val & 0xff;
    this.buffer[this.offset + 1] = (val >> 8) & 0xff;
    this.buffer[this.offset + 2] = (val >> 16) & 0xff;
    this.buffer[this.offset + 3] = (val >> 24) & 0xff;
    this.offset += 4;
  }

  writeUint64LE(val: bigint | number | string) {
    this.ensureCapacity(8);
    const bi = BigInt(val);
    if (typeof val === "number" && !Number.isSafeInteger(val)) throw new Error("Unsafe integer");
    if (bi < 0n || bi > (1n << 64n) - 1n) throw new Error("Invalid u64");
    const view = new DataView(this.buffer.buffer, this.offset, 8);
    view.setBigUint64(0, bi, true);
    this.offset += 8;
  }

  writeUint128LE(val: bigint | string) {
    this.ensureCapacity(16);
    const bi = BigInt(val);
    if (bi < 0n || bi > (1n << 128n) - 1n) throw new Error("Invalid u128");
    const low = bi & 0xffffffffffffffffn;
    const high = bi >> 64n;
    const view = new DataView(this.buffer.buffer, this.offset, 16);
    view.setBigUint64(0, low, true);
    view.setBigUint64(8, high, true);
    this.offset += 16;
  }

  writeBytes(bytes: Uint8Array) {
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeString(str: string) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeUint32LE(bytes.length);
    this.writeBytes(bytes);
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }
}

export function parseRequestId(hexStr: string): Uint8Array {
  if (hexStr.length !== 64) {
    throw new Error("ALLOCARD_INVALID_INPUT: Request ID must be 64 characters");
  }
  if (!/^[0-9a-f]{64}$/.test(hexStr)) {
    throw new Error("ALLOCARD_INVALID_INPUT: Request ID must be lowercase hex");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hexStr.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function generateRequestId(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("crypto");
    const nodeBytes = nodeCrypto.randomBytes(32);
    return nodeBytes.toString("hex").toLowerCase();
  }
  return bytesToHex(bytes).toLowerCase();
}

export function serializeAssetId(writer: BorshWriter, asset: AssetId) {
  if (asset.type === "NativeNear") {
    writer.writeUint8(0);
  } else if (asset.type === "Nep141") {
    writer.writeUint8(1);
    writer.writeString(asset.contract_id);
  } else {
    throw new Error(`Unsupported asset type: ${(asset as any).type}`);
  }
}

export function serializeAction(writer: BorshWriter, action: Action) {
  if (action.type === "Transfer") {
    writer.writeUint8(0); // enum variant Action::Transfer = 0
    serializeAssetId(writer, action.asset);
    writer.writeString(action.receiver);
    writer.writeUint128LE(action.amount);
  } else {
    throw new Error(`Unsupported action type: ${(action as any).type}`);
  }
}

export function serializeExecuteEnvelope(
  networkDomain: string,
  contractId: string,
  actor: string,
  request: ExecuteRequest
): Uint8Array {
  const writer = new BorshWriter();
  writer.writeString(EXECUTE_DOMAIN);
  writer.writeString(networkDomain);
  writer.writeString(contractId);
  writer.writeString(actor);
  writer.writeUint16LE(request.api_version);
  writer.writeBytes(parseRequestId(request.request_id));
  writer.writeUint64LE(request.permission_id);
  serializeAction(writer, request.action);
  writer.writeUint64LE(request.deadline_ms);
  return writer.toBytes();
}

export function computeExecuteHash(
  networkDomain: string,
  contractId: string,
  actor: string,
  request: ExecuteRequest
): string {
  const bytes = serializeExecuteEnvelope(networkDomain, contractId, actor, request);
  const hashBytes = sha256(bytes);
  return bytesToHex(hashBytes).toLowerCase();
}

export function serializeOwnerWithdrawEnvelope(
  networkDomain: string,
  contractId: string,
  actor: string,
  request: OwnerWithdrawRequest
): Uint8Array {
  const writer = new BorshWriter();
  writer.writeString(OWNER_WITHDRAW_DOMAIN);
  writer.writeString(networkDomain);
  writer.writeString(contractId);
  writer.writeString(actor);
  writer.writeUint16LE(request.api_version);
  writer.writeBytes(parseRequestId(request.request_id));
  writer.writeUint64LE(request.authority_epoch);
  serializeAction(writer, request.action);
  writer.writeUint64LE(request.deadline_ms);
  return writer.toBytes();
}

export function computeOwnerWithdrawHash(
  networkDomain: string,
  contractId: string,
  actor: string,
  request: OwnerWithdrawRequest
): string {
  const bytes = serializeOwnerWithdrawEnvelope(networkDomain, contractId, actor, request);
  const hashBytes = sha256(bytes);
  return bytesToHex(hashBytes).toLowerCase();
}
