// Read-through layer for the multi-workspace model.
//
// Goal: integrations call getConnector(workspaceId, type) and receive the joined
// (identity + config) view. If the DB row is missing or has no identity, callers
// fall back to the legacy `.env`-backed config (see config.ts). This keeps
// existing flows working untouched while new flows (Settings UI edits, multiple
// identities, multiple workspaces) become possible.

import { getDb } from "../db.js";

export type Workspace = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  website: string | null;
  logoUrl: string | null;
  position: number | null;
  isDefault: boolean;
  createdAt: number;
};

export type Identity = {
  id: string;
  type: string;
  label: string | null;
  account: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
  displayColor: string | null;
  updatedAt: number;
};

export type ConnectorInstance = {
  id: string;
  workspaceId: string | null;
  type: string;
  identityId: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  position: number | null;
  shared: boolean;
  shareWithOverview: boolean;
};

export type ConnectorView = {
  instance: ConnectorInstance;
  identity: Identity | null;
};

function rowToWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    website: r.website ?? null,
    logoUrl: r.logo_url ?? null,
    position: r.position,
    isDefault: !!r.is_default,
    createdAt: r.created_at,
  };
}

function rowToIdentity(r: any): Identity {
  return {
    id: r.id,
    type: r.type,
    label: r.label,
    account: r.account,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at,
    scope: r.scope,
    displayColor: r.display_color,
    updatedAt: r.updated_at,
  };
}

function rowToInstance(r: any): ConnectorInstance {
  let cfg: Record<string, unknown> = {};
  try { cfg = r.config ? JSON.parse(r.config) : {}; } catch { cfg = {}; }
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type,
    identityId: r.identity_id,
    config: cfg,
    enabled: !!r.enabled,
    position: r.position,
    shared: !!r.shared,
    shareWithOverview: !!r.share_with_overview,
  };
}

export function listWorkspaces(): Workspace[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM workspaces ORDER BY position ASC, created_at ASC")
    .all() as any[];
  return rows.map(rowToWorkspace);
}

export function getDefaultWorkspaceId(): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM workspaces WHERE is_default = 1 ORDER BY position ASC LIMIT 1")
    .get() as any;
  if (row) return row.id;
  // No explicit default → first workspace if any exist.
  const fallback = db
    .prepare("SELECT id FROM workspaces ORDER BY position ASC, created_at ASC LIMIT 1")
    .get() as any;
  return fallback?.id ?? null;
}

export function getWorkspace(id: string): Workspace | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as any;
  return row ? rowToWorkspace(row) : null;
}

export function listIdentities(type?: string): Identity[] {
  const db = getDb();
  const rows = (
    type
      ? db.prepare("SELECT * FROM identities WHERE type = ? ORDER BY updated_at DESC").all(type)
      : db.prepare("SELECT * FROM identities ORDER BY type, updated_at DESC").all()
  ) as any[];
  return rows.map(rowToIdentity);
}

export function getIdentity(id: string): Identity | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM identities WHERE id = ?").get(id) as any;
  return row ? rowToIdentity(row) : null;
}

export function listConnectorInstances(workspaceId?: string): ConnectorInstance[] {
  const db = getDb();
  const rows = (
    workspaceId
      ? db
          .prepare("SELECT * FROM connector_instances WHERE workspace_id = ? ORDER BY position ASC")
          .all(workspaceId)
      : db.prepare("SELECT * FROM connector_instances ORDER BY position ASC").all()
  ) as any[];
  return rows.map(rowToInstance);
}

export function listSharedConnectors(): ConnectorInstance[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM connector_instances WHERE shared = 1 ORDER BY position ASC")
    .all() as any[];
  return rows.map(rowToInstance);
}

/** Connectors the owning workspace has explicitly chosen to surface in the
 *  cross-workspace Overview view. Independent of "Share with other workspaces"
 *  — a connector can appear in Overview without being visible to any other
 *  workspace, and vice versa. */
export function listConnectorsForOverview(): ConnectorInstance[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM connector_instances WHERE share_with_overview = 1 AND enabled = 1 ORDER BY position ASC")
    .all() as any[];
  return rows.map(rowToInstance);
}

/** Returns true when the given workspace is enrolled in this shared connector.
 *  Legacy rows (no enabledWorkspaces field) default to enrolled-everywhere. */
export function isWorkspaceEnrolledInShared(connector: ConnectorInstance, wsId: string): boolean {
  if (!connector.shared) return false;
  const list = (connector.config as { enabledWorkspaces?: unknown }).enabledWorkspaces;
  if (!Array.isArray(list)) return false;
  return list.includes(wsId);
}

/** Effective connector list visible to a workspace:
 *  - everything it owns (workspace_id = wsId)
 *  - everything shared by any other workspace (or universal NULL-owner) where wsId
 *    has opted in via config.enabledWorkspaces
 *  Used by all dashboard data routes so sharing works for any connector type. */
export function listConnectorsForWorkspace(wsId: string): ConnectorInstance[] {
  const owned  = listConnectorInstances(wsId);
  const shared = listSharedConnectors().filter(c =>
    c.workspaceId !== wsId && isWorkspaceEnrolledInShared(c, wsId),
  );
  // De-dupe in case an owned row is also flagged shared (which is fine — we already have it).
  return [...owned, ...shared.filter(s => !owned.some(o => o.id === s.id))];
}

export function getConnector(workspaceId: string, type: string): ConnectorView | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM connector_instances
       WHERE workspace_id = ? AND type = ? AND enabled = 1
       ORDER BY position ASC LIMIT 1`,
    )
    .get(workspaceId, type) as any;
  if (!row) return null;
  const instance = rowToInstance(row);
  const identity = instance.identityId ? getIdentity(instance.identityId) : null;
  return { instance, identity };
}

export function getUniversalConnector(type: string): ConnectorView | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM connector_instances
       WHERE workspace_id IS NULL AND type = ? AND enabled = 1
       ORDER BY position ASC LIMIT 1`,
    )
    .get(type) as any;
  if (!row) return null;
  const instance = rowToInstance(row);
  const identity = instance.identityId ? getIdentity(instance.identityId) : null;
  return { instance, identity };
}

// --------------------------------------------------------------------------
// Per-connector typed views — used by integrations.
// Each returns the *effective* config (DB row if present, else null so the
// caller can fall back to its `.env`-backed defaults from config.ts).
// --------------------------------------------------------------------------

/** Returns the first enabled connector of `type` visible to this workspace —
 *  owned first, then any shared instance the workspace has opted into. */
function firstConnectorForWorkspace(wsId: string, type: string): ConnectorView | null {
  const candidates = listConnectorsForWorkspace(wsId).filter(c => c.type === type && c.enabled);
  for (const c of candidates) {
    const identity = c.identityId ? getIdentity(c.identityId) : null;
    if (identity?.accessToken) return { instance: c, identity };
  }
  return null;
}

export function getGithubConfig(workspaceId?: string): { token: string; username: string; repo: string } | null {
  const wsId = workspaceId ?? getDefaultWorkspaceId();
  if (!wsId) return null;
  const view = firstConnectorForWorkspace(wsId, "github");
  if (!view?.identity?.accessToken) return null;
  const cfg = view.instance.config as { repo?: string; username?: string };
  return {
    token: view.identity.accessToken,
    username: cfg.username || view.identity.account || "",
    repo: cfg.repo || "",
  };
}

export type WatchedUser = {
  id: string;          // stable slug; tabs reference this
  label: string;       // shown in the tab
  query: string;       // display name, email, or accountId
  status?: string;     // Jira-only: exact status filter
  hideClosed?: boolean; // when true, closed/done tickets are excluded (default: true)
};

export function getJiraConfig(workspaceId?: string): { token: string; email: string; baseUrl: string; watchedUsers: WatchedUser[] } | null {
  const wsId = workspaceId ?? getDefaultWorkspaceId();
  if (!wsId) return null;
  const view = firstConnectorForWorkspace(wsId, "jira");
  if (!view?.identity?.accessToken) return null;
  const cfg = view.instance.config as { baseUrl?: string; email?: string; watchedUsers?: WatchedUser[] };
  return {
    token: view.identity.accessToken,
    email: cfg.email || view.identity.account || "",
    baseUrl: cfg.baseUrl || "",
    watchedUsers: Array.isArray(cfg.watchedUsers) ? cfg.watchedUsers : [],
  };
}

// --------------------------------------------------------------------------
// Writes — used by Settings CRUD endpoints (Step 4b).
// --------------------------------------------------------------------------

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function createWorkspace(input: { name: string; icon?: string | null; color?: string | null; website?: string | null; logoUrl?: string | null; isDefault?: boolean }): Workspace {
  const db = getDb();
  const id = genId("ws");
  const now = Date.now();
  const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM workspaces").get() as { n: number }).n;
  if (input.isDefault) db.prepare("UPDATE workspaces SET is_default = 0").run();
  db.prepare(
    `INSERT INTO workspaces (id, name, icon, color, website, logo_url, position, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.name, input.icon ?? null, input.color ?? null,
    input.website ?? null, input.logoUrl ?? null,
    pos, input.isDefault ? 1 : 0, now,
  );
  return getWorkspace(id)!;
}

export function updateWorkspace(id: string, patch: Partial<{ name: string; icon: string | null; color: string | null; website: string | null; logoUrl: string | null; isDefault: boolean; position: number }>): Workspace | null {
  const db = getDb();
  const cur = getWorkspace(id);
  if (!cur) return null;
  if (patch.isDefault === true) db.prepare("UPDATE workspaces SET is_default = 0").run();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined)    { sets.push("name = ?");     vals.push(patch.name); }
  if (patch.icon !== undefined)    { sets.push("icon = ?");     vals.push(patch.icon); }
  if (patch.color !== undefined)   { sets.push("color = ?");    vals.push(patch.color); }
  if (patch.website !== undefined) { sets.push("website = ?");  vals.push(patch.website); }
  if (patch.logoUrl !== undefined) { sets.push("logo_url = ?"); vals.push(patch.logoUrl); }
  if (patch.isDefault !== undefined) { sets.push("is_default = ?"); vals.push(patch.isDefault ? 1 : 0); }
  if (patch.position !== undefined)  { sets.push("position = ?");   vals.push(patch.position); }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
  return getWorkspace(id);
}

export function deleteWorkspace(id: string): boolean {
  const db = getDb();
  const r = db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  return r.changes > 0;
}

export function createIdentity(input: { type: string; label?: string | null; account?: string | null; accessToken: string; refreshToken?: string | null; expiresAt?: number | null; scope?: string | null; displayColor?: string | null }): Identity {
  const db = getDb();
  const id = genId(`id-${input.type}`);
  const now = Date.now();
  db.prepare(
    `INSERT INTO identities (id, type, label, account, access_token, refresh_token, expires_at, scope, display_color, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type,
    input.label ?? null,
    input.account ?? null,
    input.accessToken,
    input.refreshToken ?? null,
    input.expiresAt ?? null,
    input.scope ?? null,
    input.displayColor ?? null,
    now,
  );
  return getIdentity(id)!;
}

export function updateIdentity(id: string, patch: Partial<{ label: string | null; account: string | null; accessToken: string; refreshToken: string | null; expiresAt: number | null; displayColor: string | null }>): Identity | null {
  const db = getDb();
  const cur = getIdentity(id);
  if (!cur) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.label        !== undefined) { sets.push("label = ?");         vals.push(patch.label); }
  if (patch.account      !== undefined) { sets.push("account = ?");       vals.push(patch.account); }
  if (patch.accessToken  !== undefined) { sets.push("access_token = ?");  vals.push(patch.accessToken); }
  if (patch.refreshToken !== undefined) { sets.push("refresh_token = ?"); vals.push(patch.refreshToken); }
  if (patch.expiresAt    !== undefined) { sets.push("expires_at = ?");    vals.push(patch.expiresAt); }
  if (patch.displayColor !== undefined) { sets.push("display_color = ?"); vals.push(patch.displayColor); }
  sets.push("updated_at = ?"); vals.push(Date.now());
  vals.push(id);
  db.prepare(`UPDATE identities SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getIdentity(id);
}

export function deleteIdentity(id: string): boolean {
  const db = getDb();
  // Detach connectors that reference this identity instead of cascading their deletion.
  db.prepare("UPDATE connector_instances SET identity_id = NULL WHERE identity_id = ?").run(id);
  const r = db.prepare("DELETE FROM identities WHERE id = ?").run(id);
  return r.changes > 0;
}

export function createConnectorInstance(input: { workspaceId: string | null; type: string; identityId?: string | null; config?: Record<string, unknown>; enabled?: boolean; shared?: boolean; shareWithOverview?: boolean }): ConnectorInstance {
  const db = getDb();
  const id = genId(`ci-${input.type}`);
  const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM connector_instances").get() as { n: number }).n;
  db.prepare(
    `INSERT INTO connector_instances (id, workspace_id, type, identity_id, config, enabled, position, shared, share_with_overview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    input.type,
    input.identityId ?? null,
    JSON.stringify(input.config ?? {}),
    input.enabled === false ? 0 : 1,
    pos,
    input.shared ? 1 : 0,
    input.shareWithOverview ? 1 : 0,
  );
  const row = db.prepare("SELECT * FROM connector_instances WHERE id = ?").get(id) as any;
  return rowToInstance(row);
}

export function updateConnectorInstance(id: string, patch: Partial<{ identityId: string | null; config: Record<string, unknown>; enabled: boolean; shared: boolean; shareWithOverview: boolean }>): ConnectorInstance | null {
  const db = getDb();
  const cur = db.prepare("SELECT * FROM connector_instances WHERE id = ?").get(id) as any;
  if (!cur) return null;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.identityId !== undefined) { sets.push("identity_id = ?"); vals.push(patch.identityId); }
  if (patch.config !== undefined) { sets.push("config = ?"); vals.push(JSON.stringify(patch.config)); }
  if (patch.enabled !== undefined) { sets.push("enabled = ?"); vals.push(patch.enabled ? 1 : 0); }
  if (patch.shared !== undefined) { sets.push("shared = ?"); vals.push(patch.shared ? 1 : 0); }
  if (patch.shareWithOverview !== undefined) { sets.push("share_with_overview = ?"); vals.push(patch.shareWithOverview ? 1 : 0); }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE connector_instances SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }
  const row = db.prepare("SELECT * FROM connector_instances WHERE id = ?").get(id) as any;
  return rowToInstance(row);
}

export function deleteConnectorInstance(id: string): boolean {
  const db = getDb();
  const r = db.prepare("DELETE FROM connector_instances WHERE id = ?").run(id);
  return r.changes > 0;
}

export function getNotionConfig(workspaceId?: string): { token: string; databaseIds: string[] } | null {
  const wsId = workspaceId ?? getDefaultWorkspaceId();
  if (!wsId) return null;
  const view = firstConnectorForWorkspace(wsId, "notion");
  if (!view?.identity?.accessToken) return null;
  const cfg = view.instance.config as { databaseIds?: string[] };
  return {
    token: view.identity.accessToken,
    databaseIds: Array.isArray(cfg.databaseIds) ? cfg.databaseIds : [],
  };
}

export function getClickUpConfig(workspaceId?: string): { token: string; teamId: string; spaceIds: string[]; watchedUsers: WatchedUser[] } | null {
  const wsId = workspaceId ?? getDefaultWorkspaceId();
  if (!wsId) return null;
  const view = firstConnectorForWorkspace(wsId, "clickup");
  if (!view?.identity?.accessToken) return null;
  const cfg = view.instance.config as { teamId?: string; spaceIds?: string | string[]; watchedUsers?: WatchedUser[] };
  const spaceIds = Array.isArray(cfg.spaceIds)
    ? cfg.spaceIds
    : (cfg.spaceIds || "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    token: view.identity.accessToken,
    teamId: cfg.teamId || "",
    spaceIds,
    watchedUsers: Array.isArray(cfg.watchedUsers) ? cfg.watchedUsers : [],
  };
}
