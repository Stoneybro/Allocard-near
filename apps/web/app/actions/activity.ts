"use server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { companyMemberships } from "@/lib/db/schema";
import { requireSessionUser } from "@/lib/auth-guard";
import { formatShortenedEmail } from "@/lib/wallet";
export type ActivityLogItem = { id: string; date: string; actor: string; actorEmail?: string | null; type: string; amountNear: string; purpose: string; status: string; txHash: string | null; assetNetwork: string };
export type ActivityCursor = { date: string; id: string };
export async function getActivityLog(companyId: string, options: { cursor?: ActivityCursor | null; limit?: number; type?: string; status?: string } = {}) {
  z.string().uuid().parse(companyId);
  const input = z.object({ cursor: z.object({ date: z.string().datetime(), id: z.string().max(100) }).nullish(), limit: z.number().int().min(1).max(100).default(25), type: z.enum(["all", "Direct Spend", "Procurement", "Reimbursement"]).default("all"), status: z.string().max(50).default("all") }).parse(options);
  const user = await requireSessionUser();
  const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.userId, user.id), eq(companyMemberships.companyId, companyId), eq(companyMemberships.canEmployer, true), eq(companyMemberships.status, "active"))).limit(1);
  if (!membership) throw new Error("Employer access is required to view company activity");
  const source = sql`
    select 'manual_' || m.id as id, m.created_at as date, 'Employee ' || coalesce(u.near_account_id, u.embedded_wallet_address, '') as actor,
      u.verified_email as "actorEmail",
      'Direct Spend' as type, m.amount_eth::text as "amountNear", m.purpose,
      case when m.is_flagged then 'Flagged' else 'Compliant' end as status, m.tx_hash as "txHash", m.asset_network as "assetNetwork"
    from manual_transactions m left join users u on u.id = m.employee_id where m.company_id = ${companyId}
    union all
    select 'booking_' || b.id, b.created_at, coalesce(a.name, 'Legacy agent'), null::text as "actorEmail", 'Procurement', b.amount_eth::text,
      coalesce(b.booking_details->>'description', b.booking_details->>'prompt', 'Legacy booking'), 'Historical', b.tx_hash, b.asset_network
    from agent_bookings b left join agents a on a.id = b.agent_id where b.company_id = ${companyId}
    union all
    select 'claim_' || c.id, c.created_at, 'Employee reimbursement', cu.verified_email as "actorEmail", 'Reimbursement', c.amount_eth,
      c.claim_description, c.status::text, c.tx_hash, c.asset_network from claim_redemptions c left join users cu on cu.id = c.employee_id where c.company_id = ${companyId}`;
  const cursorFilter = input.cursor ? sql`(date < ${input.cursor.date}::timestamptz or (date = ${input.cursor.date}::timestamptz and id < ${input.cursor.id}))` : sql`true`;
  const typeFilter = input.type === "all" ? sql`true` : sql`type = ${input.type}`;
  const statusFilter = input.status === "all" ? sql`true` : sql`status = ${input.status}`;
  const result = await db.execute(sql`select * from (${source}) activity where ${cursorFilter} and ${typeFilter} and ${statusFilter} order by date desc, id desc limit ${input.limit + 1}`);
  const rows = (result.rows as unknown as ActivityLogItem[]).map((row) => {
    const actorEmail = row.actorEmail?.trim() || null;
    return {
      ...row,
      actorEmail,
      actor: actorEmail ? formatShortenedEmail(actorEmail) : row.actor,
      date: new Date(row.date).toISOString(),
    };
  });
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > input.limit && last ? { date: last.date, id: last.id } : null };
}
