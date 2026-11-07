import { HttpError } from "@/platform/http";
import { sleep } from "@/lib/util";

/** Retries retryable failures (network, 429, 5xx) with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e instanceof HttpError ? e.retryable : false;
      if (!retryable || i === attempts - 1) throw e;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

/** Parses a GitHub/RFC5988 Link header and returns the rel="next" URL. */
export function nextLink(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}
