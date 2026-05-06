import { getDb } from "../db.js";

const PREFIX = "app.";

export function getAppSetting(key: string, envFallback = ""): string {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(`${PREFIX}${key}`) as any;
  if (row?.value) {
    try { return JSON.parse(row.value); } catch { return row.value; }
  }
  return envFallback;
}

export function setAppSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(`${PREFIX}${key}`, JSON.stringify(value));
}

export function getAppSettings(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = getAppSetting(k);
  return out;
}

export function setAppSettings(patch: Record<string, unknown>): void {
  const stmt = getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  getDb().transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null) stmt.run(`${PREFIX}${k}`, JSON.stringify(v));
    }
  })();
}

export function getAppSettingJSON<T>(key: string, fallback: T): T {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(`${PREFIX}${key}`) as any;
  if (!row?.value) return fallback;
  try {
    const parsed = JSON.parse(row.value);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}
