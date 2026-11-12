import { spendingAssetSchema } from "./spending-asset-schema";
import { z } from "zod";
const amount = z.string().regex(/^(0|[1-9][0-9]*)$/).max(39);
const u64 = amount.refine(value => BigInt(value) < 2n ** 64n, "Expected u64");
const optionalAmount = amount.nullish();
const account = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
export const sponsoredAdapterSchema = z.object({
 treasury:z.string().min(2).max(130), delegationId:z.string().uuid(), parentId:u64,
 spec:z.object({delegate:account,valid_from_ms:u64,expires_at_ms:u64.nullish(),max_executions:z.number().int().min(1).max(4294967295).nullish(),
 rules:z.array(z.object({asset:spendingAssetSchema,recipients:z.discriminatedUnion("type",[z.object({type:z.literal("Any")}).strict(),z.object({type:z.literal("Only"),accounts:z.array(account).min(1).max(64)}).strict()]),
 min_per_action:optionalAmount,max_per_action:optionalAmount,lifetime_limit:optionalAmount,
 fixed_window:z.object({limit:amount,duration_ms:u64,anchor_ms:u64}).strict().nullish(),
 streaming:z.object({rate_per_second:amount,start_ms:u64,max_cap:optionalAmount}).strict().nullish(),
 approval:z.object({approver:account,above_amount:amount}).strict().nullish(),acknowledge_unbounded_budget:z.boolean()}).strict()).length(1),
 redelegation_depth:z.literal(0),metadata_hash:z.null().optional()}).strict()
}).strict();
export const sponsoredAdapterProofSchema=sponsoredAdapterSchema.extend({nonce:u64,maxBlockHeight:u64,signature:z.string().regex(/^0x[0-9a-fA-F]{128}$/)});

// Root grants have the same bounded rule grammar, with one level of agent access.
export const sponsoredRootSchema = z.object({
 treasury:z.string().min(2).max(130), delegationId:z.string().uuid(),
 spec:sponsoredAdapterSchema.shape.spec.extend({redelegation_depth:z.union([z.literal(0),z.literal(1)])}),
}).strict();
export const sponsoredRootProofSchema=sponsoredRootSchema.extend({nonce:u64,maxBlockHeight:u64,signature:z.string().regex(/^0x[0-9a-fA-F]{128}$/)});

export const sponsoredRevokeSchema=z.object({treasury:z.string().min(2).max(130),permissionId:u64}).strict();
export const sponsoredRevokeProofSchema=sponsoredRevokeSchema.extend({nonce:u64,maxBlockHeight:u64,signature:z.string().regex(/^0x[0-9a-fA-F]{128}$/)});
