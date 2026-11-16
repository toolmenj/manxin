/**
 * 限制同時進行的數量（review M4）。
 * 一個請求不要一次丟出幾百個查詢把連線池（預設 10 條）佔滿；交易裡則一律用 1（同一條連線不能同時跑兩個查詢）。
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return out;
}

/** 列表頁同時最多幾個查詢 */
export const LIST_CONCURRENCY = 3;
