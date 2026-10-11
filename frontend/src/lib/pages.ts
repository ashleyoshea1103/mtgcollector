/**
 * The items of every page loaded so far, each once. The daily price import can move an
 * entry between pages after one page was fetched and before the next, so the same item can
 * come twice; the first copy is kept.
 */
export function uniqueItems<T>(pages: readonly (readonly T[])[], idOf: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  const out: T[] = [];
  for (const page of pages) {
    for (const item of page) {
      const id = idOf(item);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}
