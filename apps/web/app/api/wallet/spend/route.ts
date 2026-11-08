import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireEmployeeCompany, requireSessionUser } from "@/lib/auth-guard";
import { companies, delegations, manualTransactions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { parseTokenAmount } from "@allocard/delegation-sdk";
import { isNativeNearAccount } from "@/lib/wallet";
import { treasuryReader, assertSettledPayment, verifyPaymentTransaction } from "@/lib/near-server";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { companyId, employeeId, delegationId, toAddress, amountNear, purpose, txHash, executionId } = await req.json();
    if (typeof companyId !== "string" || typeof delegationId !== "string" || !isNativeNearAccount(toAddress) || typeof amountNear !== "string" || typeof txHash !== "string" || typeof executionId !== "string" || !/^[0-9]+$/.test(executionId)) {
      return NextResponse.json({ error: "A settled NEAR execution and valid payment fields are required" }, { status: 400 });
    }
    if (employeeId !== user.id) return NextResponse.json({ error: "You can only record your own payments" }, { status: 403 });
    await requireEmployeeCompany(user.id, companyId);
    const [delegation] = await db.select().from(delegations).where(and(
      eq(delegations.id, delegationId), eq(delegations.delegatorType, "company"), eq(delegations.delegatorId, companyId),
      eq(delegations.delegateeType, "user"), eq(delegations.delegateeId, user.id),
    )).limit(1);
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!delegation?.delegationHash || !company?.smartAccountAddress) return NextResponse.json({ error: "Treasury permission mapping not found" }, { status: 409 });
    // Revocation after dispatch does not erase a successful payment. Verify the
    // execution itself rather than requiring that permission to still be active.
    const record = await treasuryReader(company.smartAccountAddress).getExecution(executionId);
    assertSettledPayment(record, { actor: user.embeddedWalletAddress, permissionId: delegation.delegationHash, receiver: toAddress, amount: parseTokenAmount(amountNear, 24) });
    await verifyPaymentTransaction(txHash, record.actor, company.smartAccountAddress, record.request_id);
    const values = { assetNetwork: "near:testnet", companyId, employeeId: user.id, delegationId, toAddress, amountNear, purpose: typeof purpose === "string" ? purpose.trim().slice(0, 2000) : "Company payment", isFlagged: false,
      txHash, executionId, treasuryContractId: company.smartAccountAddress };
    const [inserted] = await db.insert(manualTransactions).values(values).onConflictDoNothing({ target: [manualTransactions.treasuryContractId, manualTransactions.executionId] }).returning();
    if (inserted) return NextResponse.json({ success: true, transaction: inserted });
    const [existing] = await db.select().from(manualTransactions).where(and(eq(manualTransactions.treasuryContractId, company.smartAccountAddress), eq(manualTransactions.executionId, executionId))).limit(1);
    if (existing?.employeeId !== user.id || existing?.companyId !== companyId || existing?.delegationId !== delegationId) return NextResponse.json({ error: "Execution is already recorded elsewhere" }, { status: 409 });
    return NextResponse.json({ success: true, transaction: existing });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment verification failed";
    const status = message.startsWith("Unauthorized:") ? 401 : message.startsWith("Forbidden:") ? 403 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
