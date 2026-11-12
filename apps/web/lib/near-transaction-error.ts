/** Only authoritative failures may release a saved signing intent. */
export class RetryableNearTransactionError extends Error {
  readonly safeToRetry = true;
  constructor(message: string) { super(message); this.name = "RetryableNearTransactionError"; }
}
