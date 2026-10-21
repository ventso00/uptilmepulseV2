/**
 * Runs `worker` over `items` with a bounded number of in-flight tasks.
 * `Promise.all` over the whole batch would open one socket per check
 * simultaneously; a serial `for` loop stalled the tick far past the cron
 * interval. A fixed pool keeps both bounds.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.min(Math.floor(limit), items.length));
  // Pre-sized so the result keeps input order regardless of completion order.
  const results = Array.from<R | undefined>({ length: items.length });
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: size }, () => run()));
  return results as R[];
}
