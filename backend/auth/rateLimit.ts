type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const MAX_BUCKETS = 10_000;

/**
 * Drops expired buckets so a long-running process cannot grow the map without
 * bound. Called opportunistically rather than on a timer to keep the module
 * free of background handles in tests.
 */
function sweep(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still oversized (all buckets live): evict the oldest entries to stay bounded.
  if (buckets.size < MAX_BUCKETS) return;
  const excess = buckets.size - MAX_BUCKETS;
  let removed = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000)
      ),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}
