/** Exact human decimal -> base units. Rejects exponent notation and excess precision. */
export function parseTokenAmount(value: string, decimals = 24): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) throw new Error("Invalid decimals");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new Error("Enter a non-negative decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Too many decimal places");
  const amount = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (amount > (BigInt(1) << BigInt(128)) - BigInt(1)) throw new Error("Amount exceeds u128");
  return amount.toString();
}

export function formatTokenAmount(value: string, decimals = 24): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38 || !/^[0-9]+$/.test(value)) throw new Error("Invalid base-unit amount");
  if (decimals === 0) return BigInt(value).toString();
  const padded = value.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return BigInt(padded.slice(0, -decimals)).toString() + (fraction ? `.${fraction}` : "");
}
