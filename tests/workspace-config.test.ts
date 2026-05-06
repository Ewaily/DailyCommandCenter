import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The module-level `testDb` variable is assigned in beforeEach.
// vi.mock hoists the factory so the arrow function reads `testDb` at call time.
let testDb: InstanceType<typeof Database>;

vi.mock("../src/server/db.js", () => ({
  getDb: () => testDb,
}));

import {
  listWorkspaces,
  getWorkspace,
  getDefaultWorkspaceId,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  listIdentities,
  getIdentity,
  createIdentity,
  updateIdentity,
  deleteIdentity,
  listConnectorInstances,
  listSharedConnectors,
  listConnectorsForOverview,
  isWorkspaceEnrolledInShared,
  listConnectorsForWorkspace,
  createConnectorInstance,
  updateConnectorInstance,
  deleteConnectorInstance,
  getConnector,
  getUniversalConnector,
  getGithubConfig,
  getJiraConfig,
  getNotionConfig,
  getClickUpConfig,
} from "../src/server/lib/workspace-config.js";

function buildSchema(db: InstanceType<typeof Database>) {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT,
      color       TEXT,
      position    INTEGER,
      is_default  INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL,
      website     TEXT,
      logo_url    TEXT
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
      id                  TEXT PRIMARY KEY,
      workspace_id        TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      type                TEXT NOT NULL,
      identity_id         TEXT REFERENCES identities(id),
      config              TEXT NOT NULL DEFAULT '{}',
      enabled             INTEGER DEFAULT 1,
      position            INTEGER,
      shared              INTEGER DEFAULT 0,
      share_with_overview INTEGER DEFAULT 0
    );
  `);
}

beforeEach(() => {
  testDb = new Database(":memory:");
  buildSchema(testDb);
});

// ---------------------------------------------------------------------------
// Workspace CRUD
// ---------------------------------------------------------------------------

describe("workspace CRUD", () => {
  it("creates a workspace and retrieves it by id", () => {
    const ws = createWorkspace({ name: "Acme", icon: "🏢", color: "#fff" });
    expect(ws.name).toBe("Acme");
    expect(ws.icon).toBe("🏢");
    expect(ws.color).toBe("#fff");
    expect(ws.id).toMatch(/^ws-/);

    const fetched = getWorkspace(ws.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Acme");
  });

  it("getWorkspace returns null for an unknown id", () => {
    expect(getWorkspace("nope")).toBeNull();
  });

  it("listWorkspaces returns all workspaces ordered by position", () => {
    createWorkspace({ name: "B" });
    createWorkspace({ name: "C" });
    createWorkspace({ name: "A" });
    const list = listWorkspaces();
    expect(list).toHaveLength(3);
    // positions are auto-assigned 0, 1, 2
    expect(list[0].name).toBe("B");
    expect(list[1].name).toBe("C");
    expect(list[2].name).toBe("A");
  });

  it("getDefaultWorkspaceId returns the workspace flagged is_default", () => {
    createWorkspace({ name: "X" });
    const def = createWorkspace({ name: "Y", isDefault: true });
    expect(getDefaultWorkspaceId()).toBe(def.id);
  });

  it("getDefaultWorkspaceId falls back to the first workspace when none is default", () => {
    const first = createWorkspace({ name: "First" });
    createWorkspace({ name: "Second" });
    expect(getDefaultWorkspaceId()).toBe(first.id);
  });

  it("getDefaultWorkspaceId returns null when no workspaces exist", () => {
    expect(getDefaultWorkspaceId()).toBeNull();
  });

  it("createWorkspace with isDefault=true demotes the previous default", () => {
    const old = createWorkspace({ name: "Old", isDefault: true });
    const fresh = createWorkspace({ name: "New", isDefault: true });
    expect(getDefaultWorkspaceId()).toBe(fresh.id);
    // old workspace still exists but is no longer default
    const oldRefetched = getWorkspace(old.id);
    expect(oldRefetched!.isDefault).toBe(false);
  });

  it("updateWorkspace patches name, icon, color", () => {
    const ws = createWorkspace({ name: "Before" });
    const updated = updateWorkspace(ws.id, { name: "After", color: "#000" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("After");
    expect(updated!.color).toBe("#000");
  });

  it("updateWorkspace returns null for unknown id", () => {
    expect(updateWorkspace("ghost", { name: "x" })).toBeNull();
  });

  it("updateWorkspace with isDefault=true promotes that workspace", () => {
    const a = createWorkspace({ name: "A", isDefault: true });
    const b = createWorkspace({ name: "B" });
    updateWorkspace(b.id, { isDefault: true });
    expect(getDefaultWorkspaceId()).toBe(b.id);
    expect(getWorkspace(a.id)!.isDefault).toBe(false);
  });

  it("deleteWorkspace removes the workspace and returns true", () => {
    const ws = createWorkspace({ name: "Temp" });
    expect(deleteWorkspace(ws.id)).toBe(true);
    expect(getWorkspace(ws.id)).toBeNull();
  });

  it("deleteWorkspace returns false for unknown id", () => {
    expect(deleteWorkspace("nobody")).toBe(false);
  });

  it("stores website and logoUrl fields", () => {
    const ws = createWorkspace({ name: "W", website: "https://acme.com", logoUrl: "https://acme.com/logo.png" });
    expect(ws.website).toBe("https://acme.com");
    expect(ws.logoUrl).toBe("https://acme.com/logo.png");
  });
});

// ---------------------------------------------------------------------------
// Identity CRUD
// ---------------------------------------------------------------------------

describe("identity CRUD", () => {
  it("creates an identity and retrieves it", () => {
    const id = createIdentity({ type: "github", accessToken: "ghp_abc", account: "octocat" });
    expect(id.type).toBe("github");
    expect(id.accessToken).toBe("ghp_abc");
    expect(id.account).toBe("octocat");
    expect(id.id).toMatch(/^id-github-/);

    const fetched = getIdentity(id.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.accessToken).toBe("ghp_abc");
  });

  it("getIdentity returns null for unknown id", () => {
    expect(getIdentity("nope")).toBeNull();
  });

  it("listIdentities returns all identities", () => {
    createIdentity({ type: "github", accessToken: "t1" });
    createIdentity({ type: "jira", accessToken: "t2" });
    expect(listIdentities()).toHaveLength(2);
  });

  it("listIdentities filters by type", () => {
    createIdentity({ type: "github", accessToken: "t1" });
    createIdentity({ type: "jira", accessToken: "t2" });
    const github = listIdentities("github");
    expect(github).toHaveLength(1);
    expect(github[0].type).toBe("github");
  });

  it("updateIdentity patches fields", () => {
    const id = createIdentity({ type: "notion", accessToken: "old" });
    const updated = updateIdentity(id.id, { accessToken: "new", account: "me" });
    expect(updated).not.toBeNull();
    expect(updated!.accessToken).toBe("new");
    expect(updated!.account).toBe("me");
  });

  it("updateIdentity returns null for unknown id", () => {
    expect(updateIdentity("ghost", { accessToken: "x" })).toBeNull();
  });

  it("deleteIdentity removes the identity and detaches connectors", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "github", accessToken: "tok" });
    const ci = createConnectorInstance({ workspaceId: ws.id, type: "github", identityId: id.id });

    expect(deleteIdentity(id.id)).toBe(true);
    expect(getIdentity(id.id)).toBeNull();

    // connector instance should still exist but with null identity_id
    const row = testDb.prepare("SELECT identity_id FROM connector_instances WHERE id = ?").get(ci.id) as any;
    expect(row.identity_id).toBeNull();
  });

  it("deleteIdentity returns false for unknown id", () => {
    expect(deleteIdentity("nobody")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConnectorInstance CRUD
// ---------------------------------------------------------------------------

describe("connector instance CRUD", () => {
  let wsId: string;

  beforeEach(() => {
    wsId = createWorkspace({ name: "WS" }).id;
  });

  it("creates a connector instance and lists it", () => {
    const ci = createConnectorInstance({ workspaceId: wsId, type: "github", config: { repo: "me/repo" } });
    expect(ci.type).toBe("github");
    expect(ci.config).toEqual({ repo: "me/repo" });
    expect(ci.enabled).toBe(true);

    const list = listConnectorInstances(wsId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(ci.id);
  });

  it("listConnectorInstances without workspaceId returns all", () => {
    const ws2 = createWorkspace({ name: "WS2" });
    createConnectorInstance({ workspaceId: wsId, type: "jira" });
    createConnectorInstance({ workspaceId: ws2.id, type: "notion" });
    expect(listConnectorInstances()).toHaveLength(2);
  });

  it("listSharedConnectors returns only shared connectors", () => {
    createConnectorInstance({ workspaceId: wsId, type: "github" });
    createConnectorInstance({ workspaceId: wsId, type: "slack", shared: true });
    const shared = listSharedConnectors();
    expect(shared).toHaveLength(1);
    expect(shared[0].type).toBe("slack");
  });

  it("listConnectorsForOverview returns enabled connectors with share_with_overview=1", () => {
    createConnectorInstance({ workspaceId: wsId, type: "jira", shareWithOverview: true });
    createConnectorInstance({ workspaceId: wsId, type: "github", shareWithOverview: false });
    const ov = listConnectorsForOverview();
    expect(ov).toHaveLength(1);
    expect(ov[0].type).toBe("jira");
  });

  it("listConnectorsForOverview excludes disabled connectors", () => {
    createConnectorInstance({ workspaceId: wsId, type: "jira", shareWithOverview: true, enabled: false });
    expect(listConnectorsForOverview()).toHaveLength(0);
  });

  it("updateConnectorInstance patches enabled and config", () => {
    const ci = createConnectorInstance({ workspaceId: wsId, type: "github", enabled: true });
    const updated = updateConnectorInstance(ci.id, { enabled: false, config: { repo: "x/y" } });
    expect(updated).not.toBeNull();
    expect(updated!.enabled).toBe(false);
    expect(updated!.config).toEqual({ repo: "x/y" });
  });

  it("updateConnectorInstance returns null for unknown id", () => {
    expect(updateConnectorInstance("ghost", { enabled: false })).toBeNull();
  });

  it("deleteConnectorInstance removes the instance and returns true", () => {
    const ci = createConnectorInstance({ workspaceId: wsId, type: "jira" });
    expect(deleteConnectorInstance(ci.id)).toBe(true);
    expect(listConnectorInstances(wsId)).toHaveLength(0);
  });

  it("deleteConnectorInstance returns false for unknown id", () => {
    expect(deleteConnectorInstance("nope")).toBe(false);
  });

  it("creates a disabled connector when enabled=false is passed", () => {
    const ci = createConnectorInstance({ workspaceId: wsId, type: "notion", enabled: false });
    expect(ci.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sharing model
// ---------------------------------------------------------------------------

describe("isWorkspaceEnrolledInShared", () => {
  it("returns false when connector is not shared", () => {
    const ws = createWorkspace({ name: "W" });
    const ci = createConnectorInstance({ workspaceId: ws.id, type: "github", shared: false });
    expect(isWorkspaceEnrolledInShared(ci, ws.id)).toBe(false);
  });

  it("returns false when enabledWorkspaces is not an array", () => {
    const ws = createWorkspace({ name: "W" });
    const ci = createConnectorInstance({ workspaceId: ws.id, type: "slack", shared: true, config: {} });
    expect(isWorkspaceEnrolledInShared(ci, ws.id)).toBe(false);
  });

  it("returns true when wsId is in enabledWorkspaces", () => {
    const ws = createWorkspace({ name: "W" });
    const ci = createConnectorInstance({
      workspaceId: ws.id,
      type: "slack",
      shared: true,
      config: { enabledWorkspaces: [ws.id] },
    });
    expect(isWorkspaceEnrolledInShared(ci, ws.id)).toBe(true);
  });

  it("returns false when wsId is not in enabledWorkspaces", () => {
    const ws = createWorkspace({ name: "W" });
    const ci = createConnectorInstance({
      workspaceId: ws.id,
      type: "slack",
      shared: true,
      config: { enabledWorkspaces: ["other-ws"] },
    });
    expect(isWorkspaceEnrolledInShared(ci, ws.id)).toBe(false);
  });
});

describe("listConnectorsForWorkspace", () => {
  it("includes owned connectors and opted-in shared connectors", () => {
    const owner = createWorkspace({ name: "Owner" });
    const consumer = createWorkspace({ name: "Consumer" });

    createConnectorInstance({ workspaceId: consumer.id, type: "github" });
    createConnectorInstance({
      workspaceId: owner.id,
      type: "slack",
      shared: true,
      config: { enabledWorkspaces: [consumer.id] },
    });

    const list = listConnectorsForWorkspace(consumer.id);
    const types = list.map(c => c.type).sort();
    expect(types).toEqual(["github", "slack"]);
  });

  it("excludes shared connectors the workspace has not opted into", () => {
    const owner = createWorkspace({ name: "Owner" });
    const consumer = createWorkspace({ name: "Consumer" });

    createConnectorInstance({
      workspaceId: owner.id,
      type: "slack",
      shared: true,
      config: { enabledWorkspaces: [] },
    });

    expect(listConnectorsForWorkspace(consumer.id)).toHaveLength(0);
  });

  it("does not double-count a connector the workspace both owns and has flagged shared", () => {
    const ws = createWorkspace({ name: "W" });
    createConnectorInstance({
      workspaceId: ws.id,
      type: "jira",
      shared: true,
      config: { enabledWorkspaces: [ws.id] },
    });
    expect(listConnectorsForWorkspace(ws.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getConnector / getUniversalConnector
// ---------------------------------------------------------------------------

describe("getConnector", () => {
  it("returns null when no enabled connector of that type exists", () => {
    const ws = createWorkspace({ name: "W" });
    expect(getConnector(ws.id, "github")).toBeNull();
  });

  it("returns the connector view with identity when found", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "github", accessToken: "tok" });
    createConnectorInstance({ workspaceId: ws.id, type: "github", identityId: id.id });
    const view = getConnector(ws.id, "github");
    expect(view).not.toBeNull();
    expect(view!.instance.type).toBe("github");
    expect(view!.identity!.accessToken).toBe("tok");
  });

  it("returns null identity when connector has no identity_id", () => {
    const ws = createWorkspace({ name: "W" });
    createConnectorInstance({ workspaceId: ws.id, type: "jira" });
    const view = getConnector(ws.id, "jira");
    expect(view).not.toBeNull();
    expect(view!.identity).toBeNull();
  });

  it("ignores disabled connectors", () => {
    const ws = createWorkspace({ name: "W" });
    createConnectorInstance({ workspaceId: ws.id, type: "notion", enabled: false });
    expect(getConnector(ws.id, "notion")).toBeNull();
  });
});

describe("getUniversalConnector", () => {
  it("returns null when no universal (workspace_id IS NULL) connector exists", () => {
    expect(getUniversalConnector("slack")).toBeNull();
  });

  it("returns the universal connector when one exists", () => {
    testDb.prepare(
      `INSERT INTO connector_instances (id, workspace_id, type, identity_id, config, enabled, position, shared, share_with_overview)
       VALUES ('univ-slack', NULL, 'slack', NULL, '{}', 1, 0, 1, 0)`,
    ).run();
    const view = getUniversalConnector("slack");
    expect(view).not.toBeNull();
    expect(view!.instance.type).toBe("slack");
  });
});

// ---------------------------------------------------------------------------
// Typed config getters
// ---------------------------------------------------------------------------

describe("getGithubConfig", () => {
  it("returns null when there are no workspaces", () => {
    expect(getGithubConfig()).toBeNull();
  });

  it("returns null when the connector has no identity with a token", () => {
    const ws = createWorkspace({ name: "W" });
    createConnectorInstance({ workspaceId: ws.id, type: "github" });
    expect(getGithubConfig(ws.id)).toBeNull();
  });

  it("returns config when a github identity with a token exists", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "github", accessToken: "ghp_xyz", account: "me" });
    createConnectorInstance({
      workspaceId: ws.id,
      type: "github",
      identityId: id.id,
      config: { repo: "me/repo", username: "me" },
    });
    const cfg = getGithubConfig(ws.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.token).toBe("ghp_xyz");
    expect(cfg!.repo).toBe("me/repo");
    expect(cfg!.username).toBe("me");
  });

  it("uses identity.account as fallback when connector config has no username", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "github", accessToken: "tok", account: "fallback-user" });
    createConnectorInstance({ workspaceId: ws.id, type: "github", identityId: id.id, config: {} });
    const cfg = getGithubConfig(ws.id);
    expect(cfg!.username).toBe("fallback-user");
  });
});

describe("getJiraConfig", () => {
  it("returns null when there are no workspaces", () => {
    expect(getJiraConfig()).toBeNull();
  });

  it("returns jira config with watchedUsers defaulting to empty array", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "jira", accessToken: "jira-tok", account: "me@acme.com" });
    createConnectorInstance({
      workspaceId: ws.id,
      type: "jira",
      identityId: id.id,
      config: { baseUrl: "acme.atlassian.net", email: "me@acme.com" },
    });
    const cfg = getJiraConfig(ws.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.token).toBe("jira-tok");
    expect(cfg!.baseUrl).toBe("acme.atlassian.net");
    expect(cfg!.watchedUsers).toEqual([]);
  });

  it("returns watchedUsers from config when present", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "jira", accessToken: "tok" });
    const watched = [{ id: "u1", label: "Alice", query: "alice" }];
    createConnectorInstance({
      workspaceId: ws.id,
      type: "jira",
      identityId: id.id,
      config: { baseUrl: "x.atlassian.net", watchedUsers: watched },
    });
    expect(getJiraConfig(ws.id)!.watchedUsers).toEqual(watched);
  });
});

describe("getNotionConfig", () => {
  it("returns null when no workspace exists", () => {
    expect(getNotionConfig()).toBeNull();
  });

  it("returns notion config with databaseIds", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "notion", accessToken: "secret_abc" });
    createConnectorInstance({
      workspaceId: ws.id,
      type: "notion",
      identityId: id.id,
      config: { databaseIds: ["db1", "db2"] },
    });
    const cfg = getNotionConfig(ws.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.token).toBe("secret_abc");
    expect(cfg!.databaseIds).toEqual(["db1", "db2"]);
  });

  it("defaults databaseIds to empty array when missing from config", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "notion", accessToken: "tok" });
    createConnectorInstance({ workspaceId: ws.id, type: "notion", identityId: id.id, config: {} });
    expect(getNotionConfig(ws.id)!.databaseIds).toEqual([]);
  });
});

describe("getClickUpConfig", () => {
  it("returns null when no workspace exists", () => {
    expect(getClickUpConfig()).toBeNull();
  });

  it("parses spaceIds from a comma-separated string", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "clickup", accessToken: "cu_tok" });
    createConnectorInstance({
      workspaceId: ws.id,
      type: "clickup",
      identityId: id.id,
      config: { teamId: "t1", spaceIds: "s1,s2, s3" },
    });
    const cfg = getClickUpConfig(ws.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.spaceIds).toEqual(["s1", "s2", "s3"]);
    expect(cfg!.teamId).toBe("t1");
  });

  it("accepts spaceIds as an array directly", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "clickup", accessToken: "cu_tok" });
    createConnectorInstance({
      workspaceId: ws.id,
      type: "clickup",
      identityId: id.id,
      config: { teamId: "t1", spaceIds: ["a", "b"] },
    });
    expect(getClickUpConfig(ws.id)!.spaceIds).toEqual(["a", "b"]);
  });

  it("defaults watchedUsers to empty array", () => {
    const ws = createWorkspace({ name: "W" });
    const id = createIdentity({ type: "clickup", accessToken: "tok" });
    createConnectorInstance({ workspaceId: ws.id, type: "clickup", identityId: id.id, config: { teamId: "t1" } });
    expect(getClickUpConfig(ws.id)!.watchedUsers).toEqual([]);
  });
});
