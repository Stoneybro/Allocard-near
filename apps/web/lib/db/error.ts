/** Public error messages must not expose SQL or identity query parameters. */
export function databaseFailure(error: unknown): string | null {
  let current = error;
  let databaseError = false;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const item = current as { code?: string; name?: string; message?: string; cause?: unknown };
    if (item.code === "42703" || item.code === "42P01") return "The database schema needs updating. Run the database migrations, then try signing in again.";
    if (item.name === "DrizzleQueryError" || item.name === "NeonDbError" || item.message?.startsWith("Failed query:")) databaseError = true;
    current = item.cause;
  }
  return databaseError ? "The database query failed. Check the database connection and run the database migrations before trying again." : null;
}
