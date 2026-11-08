export type WalletAddress = string;

// NEAR account IDs are lowercase, 2–64 characters, with single separators.
const nearAccountPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export function isNativeNearAccount(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && !value.startsWith("0x") && nearAccountPattern.test(value);
}
export function isValidWalletAddress(address: string): boolean {
  return typeof address === "string" && isNativeNearAccount(address.trim());
}

export function normalizeWalletAddress(address: string): WalletAddress {
  if (!address || typeof address !== "string") {
    throw new Error("Invalid wallet address: input is required");
  }
  const normalized = address.trim();
  if (!isValidWalletAddress(normalized)) {
    throw new Error(`Invalid NEAR account ID: "${address}"`);
  }
  return normalized as WalletAddress;
}

export function formatWalletAddress(address: string): string {
  if (address?.includes("#")) {
    const [contract, company] = address.split("#");
    if (isNativeNearAccount(contract) && /^[0-9a-f]{64}$/.test(company)) return `${contract} · ${company.slice(0, 8)}…`;
  }
  try {
    const normalized = normalizeWalletAddress(address);
    if (normalized.includes(".")) {
      return normalized;
    }
    return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
  } catch {
    return address;
  }
}

export function generateEmployeeReferenceId(address: string) {
  const normalized = normalizeWalletAddress(address);
  const clean = normalized.replace(/[^a-zA-Z0-9]/g, "");
  return `EMP-${clean.slice(-5).toUpperCase()}`;
}

export function formatCompanyName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export function validateCompanyName(name: string) {
  const formatted = formatCompanyName(name);

  if (formatted.length < 2) {
    throw new Error("Company name must be at least 2 characters");
  }

  if (formatted.length > 80) {
    throw new Error("Company name must be 80 characters or fewer");
  }

  return formatted;
}
