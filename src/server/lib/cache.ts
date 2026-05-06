// Tiny in-memory TTL cache. The DB cache table exists for future use
// (cross-restart caching) but isn't wired in yet — single-process is fine for v1.

type Entry = { value: unknown; freshUntil: number };
const store = new Map<string, Entry>();

export async function memo<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.freshUntil > now) return hit.value as T;
  try {
    const value = await loader();
    store.set(key, { value, freshUntil: now + ttlMs });
    return value;
  } catch (err) {
    // Serve stale data rather than blowing up — prevents "disappear" on transient errors.
    if (hit) return hit.value as T;
    throw err;
  }
}

export function invalidate(prefix?: string) {
  if (!prefix) { store.clear(); return; }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
