export type WalletAddress = string;

// NEAR account IDs: 2 to 64 characters, lowercase alphanumeric + '-' + '_' + '.'
// Also permits 64-char implicit hex accounts, and legacy 0x addresses.
const nearAccountPattern = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const hex64Pattern = /^[0-9a-f]{64}$/;
const legacyEthPattern = /^0x[a-fA-F0-9]{40}$/;

export function isValidWalletAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  const normalized = address.trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 64) return false;
  return (
    nearAccountPattern.test(normalized) ||
    hex64Pattern.test(normalized) ||
    legacyEthPattern.test(normalized)
  );
}

export function normalizeWalletAddress(address: string): WalletAddress {
  if (!address || typeof address !== "string") {
    throw new Error("Invalid wallet address: input is required");
  }
  const normalized = address.trim().toLowerCase();
  if (!isValidWalletAddress(normalized)) {
    throw new Error(`Invalid NEAR account ID or address: "${address}"`);
  }
  return normalized as WalletAddress;
}

export function formatWalletAddress(address: string): string {
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

export function isNativeNearAccount(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 && !value.startsWith("0x") && nearAccountPattern.test(value);
}
