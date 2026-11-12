import { parseTreasuryReference, companyNetworkDomain } from "./company.js";
import { computeExecuteHash, computeOwnerWithdrawHash } from "./canonical.js";
import {
  Action,
  AssetId,
  AssetLedger,
  BudgetScope,
  ExecuteRequest,
  Execution,
  OwnerWithdrawRequest,
  Permission,
  PermissionSpec,
  PreviewResult,
  TreasuryConfig,
  TreasuryBudget,
  SpendingSnapshot,
  Usage,
} from "./types.js";

/** Accept decoded IDs or a NEAR FinalExecutionOutcome (e.g. Account.functionCall).
 * Wallet bindings must wait for a final outcome; signing-only results are rejected.
 */
export function decodeMutationId(result: unknown): string {
  let decoded: unknown = result;
  if (typeof result === "object" && result !== null) {
    const status = (result as { status?: { SuccessValue?: string; Failure?: unknown } }).status;
    if (status?.Failure !== undefined) throw new Error(`NEAR transaction failed: ${JSON.stringify(status.Failure)}`);
    if (typeof status?.SuccessValue !== "string") throw new Error("Expected final NEAR execution outcome");
    if (status.SuccessValue === "") throw new Error("NEAR transaction confirmed without a contract return value. Reconcile the transaction before retrying.");
    try {
      const bytes = Uint8Array.from(atob(status.SuccessValue), (char) => char.charCodeAt(0));
      decoded = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("NEAR contract returned an invalid encoded JSON result");
    }
  }
  if (typeof decoded !== "string" || !/^(0|[1-9][0-9]*)$/.test(decoded) || BigInt(decoded) > (1n << 64n) - 1n) {
    throw new Error("Expected a decimal u64 contract result");
  }
  return decoded;
}

export interface NearCaller {
  accountId?: string;
  viewFunction(params: {
    contractId: string;
    methodName: string;
    args?: Record<string, unknown>;
  }): Promise<any>;
  functionCall?(params: {
    contractId: string;
    methodName: string;
    args?: Record<string, unknown>;
    gas?: bigint | string;
    attachedDeposit?: bigint | string;
  }): Promise<any>;
}

export interface TreasuryClientOptions {
  contractId: string;
  networkDomain: string;
  caller: NearCaller;
  defaultGas?: string;
  companyId?: string;
}

const DEFAULT_EXECUTE_GAS = "80000000000000"; // 80 TGas
const DEFAULT_MUTATION_GAS = "40000000000000"; // 40 TGas

export class AllocardTreasuryClient {
  readonly contractId: string;
  readonly companyId?: string;
  readonly networkDomain: string;
  readonly caller: NearCaller;
  readonly defaultGas: string;
  private readonly mutationGas: string;

  constructor(options: TreasuryClientOptions) {
    const reference = parseTreasuryReference(options.contractId);
    if (options.companyId && !/^[0-9a-f]{64}$/.test(options.companyId)) throw new Error("Invalid company ID");
    if (options.companyId && reference.companyId && options.companyId !== reference.companyId) throw new Error("Conflicting company identity");
    this.contractId = reference.contractId;
    this.companyId = options.companyId || reference.companyId;
    this.networkDomain = options.networkDomain;
    const scopedArgs = (args?: Record<string, unknown>) => this.companyId ? { ...args, company_id: this.companyId } : args;
    this.caller = this.companyId ? {
      accountId: options.caller.accountId,
      viewFunction: params => options.caller.viewFunction({ ...params, args: scopedArgs(params.args) }),
      ...(options.caller.functionCall ? { functionCall: (params: Parameters<NonNullable<NearCaller["functionCall"]>>[0]) => options.caller.functionCall!({ ...params, args: scopedArgs(params.args) }) } : {}),
    } : options.caller;
    this.defaultGas = options.defaultGas || (this.companyId ? "150000000000000" : DEFAULT_EXECUTE_GAS);
    this.mutationGas = this.companyId ? "80000000000000" : DEFAULT_MUTATION_GAS;
  }

  private assertSigner() {
    if (!this.caller.functionCall) {
      throw new Error("Signer account with functionCall is required for transaction mutations");
    }
  }

  // --- Views ---

  async getConfig(): Promise<TreasuryConfig> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_config",
      args: {},
    });
  }

  async getPermission(permissionId: string): Promise<Permission | null> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_permission",
      args: { permission_id: permissionId },
    });
  }

  async getPermissionPath(permissionId: string): Promise<Permission[]> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_permission_path",
      args: { permission_id: permissionId },
    });
  }

  async getReservedBudget(permissionId: string, asset: AssetId, excludeChild: string | null = null): Promise<string> {
    return this.caller.viewFunction({ contractId: this.contractId, methodName: "get_reserved_budget", args: { permission_id: permissionId, asset, exclude_child: excludeChild } });
  }

  async getTreasuryBudget(asset: AssetId): Promise<TreasuryBudget> {
    return this.caller.viewFunction({ contractId: this.contractId, methodName: "get_treasury_budget", args: { asset } });
  }

  async getSpendingSnapshot(permissionId: string, actor: string, asset: AssetId): Promise<SpendingSnapshot> {
    return this.caller.viewFunction({ contractId: this.contractId, methodName: "get_spending_snapshot", args: { permission_id: permissionId, actor, asset } });
  }
  async getSpendingSnapshots(queries: { permission_id: string; actor: string }[], asset: AssetId): Promise<SpendingSnapshot[]> {
    if (queries.length > 8) throw new Error("At most 8 spending snapshots per read");
    return this.caller.viewFunction({ contractId: this.contractId, methodName: "get_spending_snapshots", args: { queries, asset } });
  }

  async getAssetLedger(asset: AssetId): Promise<AssetLedger | null> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_asset_ledger",
      args: { asset },
    });
  }

  async getUsage(permissionId: string, asset: AssetId, scope: BudgetScope): Promise<Usage> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_usage",
      args: {
        permission_id: permissionId,
        asset,
        scope,
      },
    });
  }

  async getExecution(executionId: string): Promise<Execution | null> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_execution",
      args: { execution_id: executionId },
    });
  }

  async getExecutionByRequest(actor: string, requestId: string): Promise<Execution | null> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "get_execution_by_request",
      args: { actor, request_id: requestId },
    });
  }

  async previewExecute(actor: string, request: ExecuteRequest): Promise<PreviewResult> {
    return this.caller.viewFunction({
      contractId: this.contractId,
      methodName: "preview_execute",
      args: { actor, request },
    });
  }

  // --- Helper Hashes ---

  getExecuteHash(actor: string, request: ExecuteRequest): string {
    return computeExecuteHash(companyNetworkDomain(this.networkDomain, this.companyId), this.contractId, actor, request);
  }

  getOwnerWithdrawHash(actor: string, request: OwnerWithdrawRequest): string {
    return computeOwnerWithdrawHash(companyNetworkDomain(this.networkDomain, this.companyId), this.contractId, actor, request);
  }

  // --- Mutations ---

  async createRootPermission(spec: PermissionSpec): Promise<string> {
    this.assertSigner();
    const res = await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "create_root_permission",
      args: { spec },
      gas: this.mutationGas,
      attachedDeposit: "0",
    });
    return decodeMutationId(res);
  }

  async createChildPermission(parentId: string, spec: PermissionSpec): Promise<string> {
    this.assertSigner();
    const res = await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "create_child_permission",
      args: { parent_id: parentId, spec },
      gas: this.mutationGas,
      attachedDeposit: "0",
    });
    return decodeMutationId(res);
  }

  async revokePermission(permissionId: string): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "revoke_permission",
      args: { permission_id: permissionId },
      gas: this.mutationGas,
      attachedDeposit: "0",
    });
  }

  async approveRequest(actor: string, request: ExecuteRequest): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "approve_request",
      args: { actor, request },
      gas: this.mutationGas,
      attachedDeposit: "0",
    });
  }

  async revokeApproval(actor: string, request: ExecuteRequest): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "revoke_approval",
      args: { actor, request },
      gas: this.mutationGas,
      attachedDeposit: "0",
    });
  }

  async depositNative(amountYocto: string): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "deposit_native",
      args: {},
      gas: this.mutationGas,
      attachedDeposit: amountYocto,
    });
  }

  async topUpStorage(amountYocto: string): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "top_up_storage",
      args: {},
      gas: this.mutationGas,
      attachedDeposit: amountYocto,
    });
  }

  async topUpOperating(amountYocto: string): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "top_up_operating",
      args: {},
      gas: this.mutationGas,
      attachedDeposit: amountYocto,
    });
  }

  /**
   * Dispatches execution. Returns executionId and a `waitForOutcome` function
   * that polls until terminal status (Succeeded or Failed) is reached.
   */
  async execute(request: ExecuteRequest): Promise<{
    executionId: string;
    transactionHash?: string;
    waitForOutcome: (timeoutMs?: number, intervalMs?: number) => Promise<Execution>;
  }> {
    this.assertSigner();
    const res = await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "execute",
      args: { request },
      gas: this.defaultGas,
      attachedDeposit: "0",
    });

    let executionId: string;
    let confirmedRecord: Execution | null = null;
    if (res?.status?.SuccessValue === "" && res.status.Failure === undefined) {
      // A NEP-366 outer receipt can confirm with an empty return value.
      // Resolve the inner execution through its replay record, never by coercing
      // an empty result to zero or by issuing a replacement payment.
      const actor = this.caller.accountId;
      const record = actor ? await this.getExecutionByRequest(actor, request.request_id) : null;
      const expectedAsset = request.action.asset;
      const actualAsset = record?.action?.asset;
      if (!actor || !record || record.actor !== actor || record.request_id !== request.request_id ||
          record.request_hash !== this.getExecuteHash(actor, request) || record.authority_mode !== "Delegated" ||
          record.permission_id !== request.permission_id || record.action?.type !== request.action.type ||
          record.action.receiver !== request.action.receiver || record.action.amount !== request.action.amount ||
          actualAsset?.type !== expectedAsset.type || (expectedAsset.type === "Nep141" &&
            (actualAsset.type !== "Nep141" || actualAsset.contract_id !== expectedAsset.contract_id))) {
        const hash = res?.transaction?.hash || res?.transaction_outcome?.id;
        throw new Error(`Transaction${hash ? ` ${hash}` : ""} confirmed without a return value, but its matching treasury execution could not be verified. Keep this payment request and retry it to reconcile the original transaction.`);
      }
      executionId = decodeMutationId(record.id);
      if (record.status !== "Pending") confirmedRecord = record;
    } else {
      executionId = decodeMutationId(res);
    }

    const waitForOutcome = async (timeoutMs = 30000, intervalMs = 1000): Promise<Execution> => {
      if (confirmedRecord) return confirmedRecord;
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const record = await this.getExecution(executionId);
        if (record && record.status !== "Pending") {
          return record;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(`Timeout waiting for execution ${executionId} outcome`);
    };

    return {
      executionId,
      transactionHash: res?.transaction?.hash || res?.transaction_outcome?.id,
      waitForOutcome,
    };
  }

  async ownerWithdraw(request: OwnerWithdrawRequest): Promise<{
    executionId: string;
    transactionHash?: string;
    waitForOutcome: (timeoutMs?: number, intervalMs?: number) => Promise<Execution>;
  }> {
    this.assertSigner();
    const res = await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "owner_withdraw",
      args: { request },
      gas: this.defaultGas,
      attachedDeposit: "0",
    });

    const executionId = decodeMutationId(res);

    const waitForOutcome = async (timeoutMs = 30000, intervalMs = 1000): Promise<Execution> => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const record = await this.getExecution(executionId);
        if (record && record.status !== "Pending") {
          return record;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(`Timeout waiting for owner withdrawal ${executionId} outcome`);
    };

    return {
      executionId,
      transactionHash: res?.transaction?.hash || res?.transaction_outcome?.id,
      waitForOutcome,
    };
  }

  async flagUnresolved(executionId: string): Promise<void> {
    this.assertSigner();
    await this.caller.functionCall!({
      contractId: this.contractId,
      methodName: "flag_unresolved",
      args: { execution_id: executionId },
      gas: this.mutationGas,
      attachedDeposit: "0",
    });
  }
}
