import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memo, invalidate } from "../src/server/lib/cache.js";

beforeEach(() => {
  invalidate(); // clear module-level store before every test
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memo", () => {
  it("calls the loader on a cold cache and returns its value", async () => {
    const loader = vi.fn().mockResolvedValue(42);
    const result = await memo("k1", 5000, loader);
    expect(result).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns the cached value without calling the loader again within TTL", async () => {
    const loader = vi.fn().mockResolvedValue("hello");
    await memo("k2", 5000, loader);
    const second = await memo("k2", 5000, loader);
    expect(second).toBe("hello");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL has expired", async () => {
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    await memo("k3", 1000, loader);
    vi.advanceTimersByTime(1001);
    const result = await memo("k3", 1000, loader);
    expect(result).toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("serves stale data when the loader throws and a cached value exists", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("stale-value")
      .mockRejectedValueOnce(new Error("network error"));
    await memo("k4", 500, loader);
    vi.advanceTimersByTime(600);
    const result = await memo("k4", 500, loader);
    expect(result).toBe("stale-value");
  });

  it("propagates the loader error when there is no cached value to fall back to", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(memo("k5", 5000, loader)).rejects.toThrow("boom");
  });

  it("caches null and undefined values without re-fetching", async () => {
    const loader = vi.fn().mockResolvedValue(null);
    await memo("k6", 5000, loader);
    const second = await memo("k6", 5000, loader);
    expect(second).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("isolates different keys independently", async () => {
    const loaderA = vi.fn().mockResolvedValue("A");
    const loaderB = vi.fn().mockResolvedValue("B");
    const a = await memo("keyA", 5000, loaderA);
    const b = await memo("keyB", 5000, loaderB);
    expect(a).toBe("A");
    expect(b).toBe("B");
    // Re-request A — should be a cache hit.
    await memo("keyA", 5000, loaderA);
    expect(loaderA).toHaveBeenCalledTimes(1);
  });
});

describe("invalidate", () => {
  it("clears the entire cache when called with no argument", async () => {
    const loader = vi.fn().mockResolvedValue(1);
    await memo("x:1", 9999, loader);
    await memo("y:2", 9999, loader);
    invalidate();
    await memo("x:1", 9999, loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("removes only keys that start with the given prefix", async () => {
    const loaderA = vi.fn().mockResolvedValue("a");
    const loaderB = vi.fn().mockResolvedValue("b");
    await memo("ns:foo", 9999, loaderA);
    await memo("ns:bar", 9999, loaderA);
    await memo("other:baz", 9999, loaderB);

    invalidate("ns:");

    // ns:foo and ns:bar should be evicted — loader called again
    await memo("ns:foo", 9999, loaderA);
    await memo("ns:bar", 9999, loaderA);
    // other:baz should still be cached
    await memo("other:baz", 9999, loaderB);

    expect(loaderA).toHaveBeenCalledTimes(4); // 2 initial + 2 after eviction
    expect(loaderB).toHaveBeenCalledTimes(1); // only the initial load
  });

  it("is a no-op when the store is empty", () => {
    expect(() => invalidate()).not.toThrow();
    expect(() => invalidate("any:")).not.toThrow();
  });

  it("leaves non-matching keys intact when a prefix is given", async () => {
    const loader = vi.fn().mockResolvedValue(99);
    await memo("keep:this", 9999, loader);
    invalidate("evict:");
    await memo("keep:this", 9999, loader);
    // Loader should only have been called once — the key survived eviction.
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
