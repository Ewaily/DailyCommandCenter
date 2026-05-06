import { Router } from "express";
import { getDb } from "../db.js";

export const settingsRouter = Router();

const DEFAULTS = {
  scheduleFilter: "all",
  todoTab: "today",
  pinnedProject: null as string | null,
  autoRefreshMs: 5 * 60 * 1000,
};

function readAll(): Record<string, unknown> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

settingsRouter.get("/", (_req, res) => {
  res.json({ data: readAll() });
});

settingsRouter.put("/", (req, res) => {
  const body = req.body || {};
  const stmt = getDb().prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  const tx = getDb().transaction(() => {
    for (const [k, v] of Object.entries(body)) stmt.run(k, JSON.stringify(v));
  });
  tx();
  res.json({ data: readAll() });
});
