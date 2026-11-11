import { z } from "zod";
import { sameAsset, SPENDING_ASSET } from "./chain";

export const spendingAssetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NativeNear") }).strict(),
  z.object({ type: z.literal("Nep141"), contract_id: z.string().min(2).max(64) }).strict(),
]).refine(asset => sameAsset(asset, SPENDING_ASSET), "Unexpected spending asset");
