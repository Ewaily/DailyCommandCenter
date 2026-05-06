import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(config.dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  seedFromEnv(_db);
  migrateTokensToIdentities(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      provider TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER,
      account TEXT,
      scope TEXT,
      raw_json TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL,    -- YYYY-MM-DD
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      priority TEXT,
      due_date TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
    CREATE INDEX IF NOT EXISTS idx_todos_created_date ON todos(created_date);

    CREATE TABLE IF NOT EXISTS scratchpad (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      text TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO scratchpad (id, text, updated_at) VALUES (1, '', strftime('%s','now')*1000);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      fresh_until INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_state (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT,
      created_at INTEGER NOT NULL
    );

    -- Multi-workspace model (see docs/architecture/MULTI_PROJECT_VISION.md §9).
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT,
      color       TEXT,
      position    INTEGER,
      is_default  INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identities (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      label         TEXT,
      account       TEXT,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    INTEGER,
      scope         TEXT,
      display_color TEXT,
      raw_json      TEXT,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connector_instances (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      type          TEXT NOT NULL,
      identity_id   TEXT REFERENCES identities(id),
      config        TEXT NOT NULL,
      enabled       INTEGER DEFAULT 1,
      position      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ci_workspace ON connector_instances(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_ci_type ON connector_instances(type);
  `);

  // Additive column migrations — safe to run on existing DBs.
  const wsCols = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
  if (!wsCols.some(c => c.name === "website"))  db.exec("ALTER TABLE workspaces ADD COLUMN website TEXT");
  if (!wsCols.some(c => c.name === "logo_url")) db.exec("ALTER TABLE workspaces ADD COLUMN logo_url TEXT");

  const ciCols = db.prepare("PRAGMA table_info(connector_instances)").all() as { name: string }[];
  if (!ciCols.some(c => c.name === "shared")) {
    db.exec("ALTER TABLE connector_instances ADD COLUMN shared INTEGER DEFAULT 0");
  }
  if (!ciCols.some(c => c.name === "share_with_overview")) {
    db.exec("ALTER TABLE connector_instances ADD COLUMN share_with_overview INTEGER DEFAULT 0");
    // Preserve historical "Overview merges everything" behavior — every
    // existing shared connector becomes Overview-visible by default.
    db.exec("UPDATE connector_instances SET share_with_overview = 1 WHERE shared = 1");
  }

  const osCols = db.prepare("PRAGMA table_info(oauth_state)").all() as { name: string }[];
  if (!osCols.some(c => c.name === "context")) {
    db.exec("ALTER TABLE oauth_state ADD COLUMN context TEXT");
  }

  // Adopt any legacy "no-owner" shared connector (workspace_id IS NULL) under
  // the default workspace. The NULL-owner case made sharing confusing in the UI
  // ("Shared from global (no owner)") and prevented the standard owner-driven
  // sharing controls from applying. Every shared connector now has an owner.
  const ownerRow = db
    .prepare("SELECT id FROM workspaces WHERE is_default = 1 ORDER BY position ASC LIMIT 1")
    .get() as { id: string } | undefined;
  const fallbackOwnerRow = ownerRow
    ?? (db.prepare("SELECT id FROM workspaces ORDER BY position ASC, created_at ASC LIMIT 1").get() as { id: string } | undefined);
  if (fallbackOwnerRow) {
    db.prepare(
      "UPDATE connector_instances SET workspace_id = ? WHERE workspace_id IS NULL AND shared = 1",
    ).run(fallbackOwnerRow.id);
  }

  // Materialize per-workspace enrollment for existing shared connectors so their
  // historical "available everywhere" behavior is preserved as explicit opt-ins.
  // After this, new workspaces are NOT auto-added — they default to opt-out and
  // can opt in via a checkbox in Settings.
  const sharedRows = db
    .prepare("SELECT id, config FROM connector_instances WHERE shared = 1")
    .all() as { id: string; config: string }[];
  if (sharedRows.length) {
    const wsIds = (db.prepare("SELECT id FROM workspaces").all() as { id: string }[]).map(r => r.id);
    const update = db.prepare("UPDATE connector_instances SET config = ? WHERE id = ?");
    for (const row of sharedRows) {
      let cfg: Record<string, unknown> = {};
      try { cfg = row.config ? JSON.parse(row.config) : {}; } catch { cfg = {}; }
      if (!Array.isArray(cfg.enabledWorkspaces)) {
        cfg.enabledWorkspaces = wsIds;
        update.run(JSON.stringify(cfg), row.id);
      }
    }
  }
}

// Idempotent: lifts legacy single-row tokens (google, slack) into the identities
// table so every OAuth account is per-identity rather than global.  Runs on every
// boot but only does work when un-migrated rows exist.
function migrateTokensToIdentities(db: Database.Database) {
  const now = Date.now();

  function genId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  }

  // ── Google ────────────────────────────────────────────────────────────────
  const googleToken = db.prepare(`SELECT * FROM tokens WHERE provider='google'`).get() as any;
  if (googleToken) {
    // Find gcal connectors with no identity_id yet — these need to be linked.
    const unlinkedGcal = db
      .prepare(`SELECT id FROM connector_instances WHERE type='gcal' AND identity_id IS NULL`)
      .all() as { id: string }[];

    if (unlinkedGcal.length) {
      // Check if a google identity already exists to reuse.
      let googleIdentityId = (
        db.prepare(`SELECT id FROM identities WHERE type='google' LIMIT 1`).get() as any
      )?.id as string | undefined;

      if (!googleIdentityId) {
        googleIdentityId = genId("id-google");
        db.prepare(
          `INSERT INTO identities (id, type, label, account, access_token, refresh_token, expires_at, scope, display_color, updated_at)
           VALUES (?, 'google', ?, ?, ?, ?, ?, ?, '#4285F4', ?)`,
        ).run(
          googleIdentityId,
          googleToken.account ? `Google · ${googleToken.account}` : "Google Calendar",
          googleToken.account || null,
          googleToken.access_token,
          googleToken.refresh_token || null,
          googleToken.expires_at || null,
          googleToken.scope || null,
          now,
        );
      }

      const link = db.prepare(`UPDATE connector_instances SET identity_id=? WHERE id=?`);
      db.transaction(() => {
        for (const { id } of unlinkedGcal) link.run(googleIdentityId, id);
      })();
    }
  }

  // ── Slack ─────────────────────────────────────────────────────────────────
  // Accept token from DB row OR from env var so env-only setups get migrated too.
  const slackDbRow = db.prepare(`SELECT * FROM tokens WHERE provider='slack'`).get() as any;
  const slackRawToken = slackDbRow?.access_token || config.slack.userToken;
  const slackToken = slackDbRow ?? (slackRawToken ? { access_token: slackRawToken, account: config.slack.userId, scope: null } : null);
  if (slackToken) {
    const unlinkedSlack = db
      .prepare(`SELECT id FROM connector_instances WHERE type='slack' AND identity_id IS NULL`)
      .all() as { id: string }[];

    if (unlinkedSlack.length) {
      let slackIdentityId = (
        db.prepare(`SELECT id FROM identities WHERE type='slack' LIMIT 1`).get() as any
      )?.id as string | undefined;

      if (!slackIdentityId) {
        slackIdentityId = genId("id-slack");
        db.prepare(
          `INSERT INTO identities (id, type, label, account, access_token, refresh_token, expires_at, scope, display_color, updated_at)
           VALUES (?, 'slack', ?, ?, ?, NULL, NULL, ?, '#4A154B', ?)`,
        ).run(
          slackIdentityId,
          slackToken.account ? `Slack · ${slackToken.account}` : "Slack",
          slackToken.account || null,
          slackToken.access_token,
          slackToken.scope || null,
          now,
        );
      }

      const link = db.prepare(`UPDATE connector_instances SET identity_id=? WHERE id=?`);
      db.transaction(() => {
        for (const { id } of unlinkedSlack) link.run(slackIdentityId, id);
      })();
    }
  }
}

// Idempotent: only seeds when workspaces table is empty.
// Bootstraps the multi-workspace model from existing .env so existing users see
// no behavior change after upgrading.
function seedFromEnv(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) as n FROM workspaces").get() as { n: number };
  if (count.n > 0) return;

  const now = Date.now();
  const insertWs = db.prepare(
    `INSERT INTO workspaces (id, name, icon, color, position, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertId = db.prepare(
    `INSERT INTO identities (id, type, label, account, access_token, scope, display_color, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCi = db.prepare(
    `INSERT INTO connector_instances (id, workspace_id, type, identity_id, config, enabled, position)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  );

  db.transaction(() => {
    insertWs.run("default", "My Workspace", "🏠", "#2A9D8F", 0, 1, now);

    let pos = 0;
    const seedConnector = (
      type: string,
      identityRow: { label: string; account: string; token: string; scope?: string; color?: string } | null,
      configObj: Record<string, unknown>,
    ) => {
      let identityId: string | null = null;
      if (identityRow && identityRow.token) {
        identityId = `${type}-default`;
        insertId.run(
          identityId,
          type,
          identityRow.label,
          identityRow.account,
          identityRow.token,
          identityRow.scope ?? null,
          identityRow.color ?? null,
          now,
        );
      }
      insertCi.run(
        `${type}-default`,
        "default",
        type,
        identityId,
        JSON.stringify(configObj),
        pos++,
      );
    };

    seedConnector(
      "github",
      config.github.token
        ? { label: "GitHub", account: config.github.username, token: config.github.token }
        : null,
      { repo: config.github.repo, username: config.github.username },
    );

    seedConnector(
      "jira",
      config.jira.apiToken
        ? { label: "Jira", account: config.jira.email, token: config.jira.apiToken }
        : null,
      { baseUrl: config.jira.baseUrl, email: config.jira.email },
    );

    seedConnector(
      "notion",
      config.notion.token
        ? { label: "Notion", account: "", token: config.notion.token }
        : null,
      { databaseIds: config.notion.databaseIds },
    );

    seedConnector(
      "gcal",
      null,
      { calendarId: "primary", color: "#2A9D8F" },
    );

    // Slack starts owned by the default workspace and shared (other workspaces
    // can opt in via Settings). Owner-based sharing keeps the "Shared from <ws>"
    // labels consistent with every other connector type.
    db.prepare(
      `INSERT INTO connector_instances (id, workspace_id, type, identity_id, config, enabled, position, shared, share_with_overview)
       VALUES (?, 'default', 'slack', NULL, ?, 1, ?, 1, 1)`,
    ).run("slack-universal", JSON.stringify({
      digestChannels: [],
      enabledWorkspaces: ["default"],
      ...(config.slack.userToken ? { userId: config.slack.userId } : {}),
    }), pos++);
  })();
}
