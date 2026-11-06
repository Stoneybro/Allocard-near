import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local", quiet: true });
const names = ["DATABASE_URL", "ALLOCARD_STORAGE_DATABASE_URL", "ALLOCARD_STORAGE_DATABASE_URL_UNPOOLED", "ALLOCARD_STORAGE_POSTGRES_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"];
const name = names.find(key => process.env[key]);
if (!name) {
  console.error("No database URL configured.");
  process.exit(1);
}
try {
  const sql = neon(process.env[name]);
  const rows = await sql`
    select distinct coalesce(u.near_account_id, u.embedded_wallet_address) as near_address,
      c.name as company
    from users u
    left join company_memberships m on m.user_id = u.id
    left join companies c on c.id = coalesce(m.company_id, u.company_id)
    where u.role = 'employee' or (m.can_employee = true and m.status = 'active')
  `;
  if (!rows.length) console.log("No employee wallets found.");
  else console.table(rows);
} catch {
  console.error("Could not read employee wallets. Check database connectivity. Connection details are hidden.");
  process.exitCode = 1;
}
