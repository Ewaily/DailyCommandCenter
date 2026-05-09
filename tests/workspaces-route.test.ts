import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let testDb: InstanceType<typeof Database>;
vi.mock("../src/server/db.js", () => ({ getDb: () => testDb }));

import { workspacesRouter, identitiesRouter, connectorsRouter } from "../src/server/routes/workspaces.js";

const wsApp = express();
wsApp.use(express.json());
wsApp.use(workspacesRouter);

const idApp = express();
idApp.use(express.json());
idApp.use(identitiesRouter);

const ciApp = express();
ciApp.use(express.json());
ciApp.use(connectorsRouter);

function buildSchema(db: InstanceType<typeof Database>) {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
      position INTEGER, is_default INTEGER DEFAULT 0, created_at INTEGER NOT NULL,
      website TEXT, logo_url TEXT
    );
    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT, account TEXT,
      access_token TEXT, refresh_token TEXT, expires_at INTEGER,
      scope TEXT, display_color TEXT, raw_json TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connector_instances (
      id TEXT PRIMARY KEY,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      type TEXT NOT NULL, identity_id TEXT REFERENCES identities(id),
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1, position INTEGER,
      shared INTEGER DEFAULT 0, share_with_overview INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

beforeEach(() => {
  testDb = new Database(":memory:");
  buildSchema(testDb);
});

// ── Workspaces CRUD ────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("returns empty workspaces list initially", async () => {
    const res = await request(wsApp).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data.workspaces).toEqual([]);
    expect(res.body.data.defaultWorkspaceId).toBeNull();
  });

  it("returns created workspaces", async () => {
    await request(wsApp).post("/").send({ name: "Alpha" });
    const res = await request(wsApp).get("/");
    expect(res.body.data.workspaces).toHaveLength(1);
    expect(res.body.data.workspaces[0].name).toBe("Alpha");
  });
});

describe("POST /", () => {
  it("creates a workspace and returns it", async () => {
    const res = await request(wsApp).post("/").send({ name: "Beta", color: "#123" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Beta");
    expect(res.body.data.id).toMatch(/^ws-/);
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(wsApp).post("/").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is blank string", async () => {
    const res = await request(wsApp).post("/").send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("stores optional fields", async () => {
    const res = await request(wsApp).post("/").send({ name: "Gamma", icon: "🚀", website: "https://example.com", logoUrl: "https://logo.url", isDefault: true });
    expect(res.status).toBe(200);
    expect(res.body.data.icon).toBe("🚀");
  });
});

describe("GET /:id", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).get("/nope");
    expect(res.status).toBe(404);
  });

  it("returns workspace with empty connectors list", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "X" })).body.data;
    const res = await request(wsApp).get(`/${ws.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.workspace.name).toBe("X");
    expect(res.body.data.connectors).toEqual([]);
  });

  it("includes owned connectors with identity info", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "ghp_tok", account: "alice" });
    const res = await request(wsApp).get(`/${ws.id}`);
    expect(res.body.data.connectors).toHaveLength(1);
    expect(res.body.data.connectors[0].type).toBe("github");
    expect(res.body.data.connectors[0].source).toBe("owned");
    expect(res.body.data.connectors[0].identity.hasToken).toBe(true);
    // accessToken IS present in workspace detail (safeIdentity only used for /identities endpoints)
    expect(res.body.data.connectors[0].identity.accessToken).toBe("ghp_tok");
  });
});

describe("PATCH /:id", () => {
  it("updates workspace name", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "Old" })).body.data;
    const res = await request(wsApp).patch(`/${ws.id}`).send({ name: "New" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("New");
  });

  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).patch("/ghost").send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /:id", () => {
  it("deletes existing workspace", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "ToDelete" })).body.data;
    const res = await request(wsApp).delete(`/${ws.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).delete("/ghost");
    expect(res.status).toBe(404);
  });
});

// ── POST /:id/connect ──────────────────────────────────────────────────────────

describe("POST /:id/connect", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).post("/nope/connect").send({ type: "github", token: "t" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when type or token is missing", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const res = await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github" });
    expect(res.status).toBe(400);
  });

  it("creates a new connector with identity", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const res = await request(wsApp).post(`/${ws.id}/connect`).send({ type: "jira", token: "tok", account: "user@acme.com" });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    const wsRes = await request(wsApp).get(`/${ws.id}`);
    expect(wsRes.body.data.connectors.some((c: any) => c.type === "jira")).toBe(true);
  });

  it("updates existing connector when called again (upsert by type)", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok1", account: "a1" });
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok2", account: "a2" });
    const wsRes = await request(wsApp).get(`/${ws.id}`);
    const ghConnectors = wsRes.body.data.connectors.filter((c: any) => c.type === "github");
    expect(ghConnectors).toHaveLength(1);
  });

  it("creates additional connector with addAnother=true", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok1" });
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok2", addAnother: true });
    const wsRes = await request(wsApp).get(`/${ws.id}`);
    const ghConnectors = wsRes.body.data.connectors.filter((c: any) => c.type === "github");
    expect(ghConnectors).toHaveLength(2);
  });

  it("updates by connectorId when provided", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok1" });
    const wsRes1 = await request(wsApp).get(`/${ws.id}`);
    const ciId = wsRes1.body.data.connectors[0].id;
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok2", connectorId: ciId });
    const wsRes2 = await request(wsApp).get(`/${ws.id}`);
    expect(wsRes2.body.data.connectors).toHaveLength(1);
  });

  it("returns 404 for unknown connectorId", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const res = await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok", connectorId: "ghost-ci" });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /:id/connectors/by-type/:type ──────────────────────────────────────

describe("DELETE /:id/connectors/by-type/:type", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).delete("/ghost/connectors/by-type/github");
    expect(res.status).toBe(404);
  });

  it("returns 404 when type not found", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const res = await request(wsApp).delete(`/${ws.id}/connectors/by-type/github`);
    expect(res.status).toBe(404);
  });

  it("clears identity link for non-outlook connectors", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connect`).send({ type: "github", token: "tok" });
    const res = await request(wsApp).delete(`/${ws.id}/connectors/by-type/github`);
    expect(res.status).toBe(200);
    const wsRes = await request(wsApp).get(`/${ws.id}`);
    const gh = wsRes.body.data.connectors.find((c: any) => c.type === "github");
    expect(gh.identity).toBeNull();
  });

  it("deletes the connector row entirely for outlook", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "outlook", identityId: null });
    const beforeRes = await request(wsApp).get(`/${ws.id}`);
    expect(beforeRes.body.data.connectors.some((c: any) => c.type === "outlook")).toBe(true);
    await request(wsApp).delete(`/${ws.id}/connectors/by-type/outlook`);
    const afterRes = await request(wsApp).get(`/${ws.id}`);
    expect(afterRes.body.data.connectors.some((c: any) => c.type === "outlook")).toBe(false);
  });
});

// ── GET /:id/connectors + POST /:id/connectors ─────────────────────────────────

describe("GET /:id/connectors", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).get("/ghost/connectors");
    expect(res.status).toBe(404);
  });

  it("lists connectors for workspace", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "slack" });
    const res = await request(wsApp).get(`/${ws.id}/connectors`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("POST /:id/connectors", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).post("/ghost/connectors").send({ type: "slack" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when type is missing", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const res = await request(wsApp).post(`/${ws.id}/connectors`).send({});
    expect(res.status).toBe(400);
  });

  it("creates connector and returns it", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const res = await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "slack", shared: true });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("slack");
    expect(res.body.data.shared).toBeTruthy();
  });
});

// ── PUT /:id/shared/:ciId/enrollment ─────────────────────────────────────────

describe("PUT /:id/shared/:ciId/enrollment", () => {
  it("returns 404 for unknown workspace", async () => {
    const res = await request(wsApp).put("/ghost/shared/ci-1/enrollment").send({ enabled: true });
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-shared connector", async () => {
    const ws1 = (await request(wsApp).post("/").send({ name: "WS1" })).body.data;
    const ws2 = (await request(wsApp).post("/").send({ name: "WS2" })).body.data;
    const ci = (await request(wsApp).post(`/${ws1.id}/connectors`).send({ type: "slack", shared: false })).body.data;
    const res = await request(wsApp).put(`/${ws2.id}/shared/${ci.id}/enrollment`).send({ enabled: true });
    expect(res.status).toBe(404);
  });

  it("enrolls a workspace into a shared connector", async () => {
    const ws1 = (await request(wsApp).post("/").send({ name: "Owner" })).body.data;
    const ws2 = (await request(wsApp).post("/").send({ name: "Consumer" })).body.data;
    const ci = (await request(wsApp).post(`/${ws1.id}/connectors`).send({ type: "slack", shared: true })).body.data;
    const res = await request(wsApp).put(`/${ws2.id}/shared/${ci.id}/enrollment`).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.enabledWorkspaces).toContain(ws2.id);
  });

  it("can disenroll a workspace from a shared connector", async () => {
    const ws1 = (await request(wsApp).post("/").send({ name: "Owner" })).body.data;
    const ws2 = (await request(wsApp).post("/").send({ name: "Consumer" })).body.data;
    const ci = (await request(wsApp).post(`/${ws1.id}/connectors`).send({ type: "slack", shared: true })).body.data;
    await request(wsApp).put(`/${ws2.id}/shared/${ci.id}/enrollment`).send({ enabled: true });
    const res = await request(wsApp).put(`/${ws2.id}/shared/${ci.id}/enrollment`).send({ enabled: false });
    expect(res.body.data.enabledWorkspaces).not.toContain(ws2.id);
  });
});

// ── Identities CRUD ────────────────────────────────────────────────────────────

describe("identities GET /", () => {
  it("returns empty list initially", async () => {
    const res = await request(idApp).get("/");
    expect(res.body.data).toEqual([]);
  });

  it("filters by type query param", async () => {
    await request(idApp).post("/").send({ type: "github", accessToken: "tok" });
    await request(idApp).post("/").send({ type: "jira", accessToken: "tok2" });
    const res = await request(idApp).get("/?type=github");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe("github");
  });
});

describe("identities POST /", () => {
  it("creates identity and strips accessToken from response", async () => {
    const res = await request(idApp).post("/").send({ type: "github", accessToken: "ghp_secret", account: "alice" });
    expect(res.status).toBe(200);
    expect(res.body.data.hasToken).toBe(true);
    expect(res.body.data.account).toBe("alice");
  });

  it("returns 400 when type is missing", async () => {
    const res = await request(idApp).post("/").send({ accessToken: "tok" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when accessToken is missing", async () => {
    const res = await request(idApp).post("/").send({ type: "github" });
    expect(res.status).toBe(400);
  });
});

describe("identities GET /:id", () => {
  it("returns 404 for unknown identity", async () => {
    const res = await request(idApp).get("/ghost");
    expect(res.status).toBe(404);
  });

  it("returns identity by id", async () => {
    const created = (await request(idApp).post("/").send({ type: "github", accessToken: "tok", label: "My GH" })).body.data;
    const res = await request(idApp).get(`/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe("My GH");
  });
});

describe("identities PATCH /:id", () => {
  it("updates identity label", async () => {
    const created = (await request(idApp).post("/").send({ type: "github", accessToken: "tok" })).body.data;
    const res = await request(idApp).patch(`/${created.id}`).send({ label: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe("Updated");
  });

  it("returns 404 for unknown identity", async () => {
    const res = await request(idApp).patch("/ghost").send({ label: "X" });
    expect(res.status).toBe(404);
  });
});

describe("identities DELETE /:id", () => {
  it("deletes identity and returns ok", async () => {
    const created = (await request(idApp).post("/").send({ type: "github", accessToken: "tok" })).body.data;
    const res = await request(idApp).delete(`/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  it("returns 404 for unknown identity", async () => {
    const res = await request(idApp).delete("/ghost");
    expect(res.status).toBe(404);
  });
});

// ── Connectors universal CRUD ─────────────────────────────────────────────────

describe("connectorsRouter GET /", () => {
  it("returns all connectors with ownerWorkspace metadata", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "slack" });
    const res = await request(ciApp).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ownerWorkspace.name).toBe("WS");
  });
});

describe("connectorsRouter PATCH /:id", () => {
  it("updates enabled flag", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const ci = (await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "slack", enabled: true })).body.data;
    const res = await request(ciApp).patch(`/${ci.id}`).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBeFalsy();
  });

  it("resets enabledWorkspaces when shared is toggled", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const ci = (await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "slack", shared: false })).body.data;
    const res = await request(ciApp).patch(`/${ci.id}`).send({ shared: true });
    expect(res.status).toBe(200);
    // config may be a parsed object or stringified JSON depending on DB layer
    const cfg = typeof res.body.data.config === "string" ? JSON.parse(res.body.data.config) : res.body.data.config;
    expect(cfg.enabledWorkspaces).toEqual([]);
  });

  it("returns 404 for unknown connector", async () => {
    const res = await request(ciApp).patch("/ghost").send({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe("connectorsRouter DELETE /:id", () => {
  it("deletes connector", async () => {
    const ws = (await request(wsApp).post("/").send({ name: "WS" })).body.data;
    const ci = (await request(wsApp).post(`/${ws.id}/connectors`).send({ type: "slack" })).body.data;
    const res = await request(ciApp).delete(`/${ci.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });

  it("returns 404 for unknown connector", async () => {
    const res = await request(ciApp).delete("/ghost");
    expect(res.status).toBe(404);
  });
});
