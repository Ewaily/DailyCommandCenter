// Workspaces / identities / connectors — read + write (Step 4b).
import { Router } from "express";
import {
  listWorkspaces,
  getWorkspace,
  listIdentities,
  listConnectorInstances,
  listSharedConnectors,
  getDefaultWorkspaceId,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  createIdentity,
  updateIdentity,
  deleteIdentity,
  createConnectorInstance,
  updateConnectorInstance,
  deleteConnectorInstance,
  getIdentity,
} from "../lib/workspace-config.js";

export const workspacesRouter = Router();

// Strip secrets — identities never leave the server with their access token.
function safeIdentity(i: ReturnType<typeof listIdentities>[number]) {
  return {
    id: i.id,
    type: i.type,
    label: i.label,
    account: i.account,
    scope: i.scope,
    expiresAt: i.expiresAt,
    displayColor: i.displayColor,
    hasToken: !!i.accessToken,
    updatedAt: i.updatedAt,
  };
}

workspacesRouter.get("/", (_req, res) => {
  res.json({
    data: {
      workspaces: listWorkspaces(),
      defaultWorkspaceId: getDefaultWorkspaceId(),
    },
  });
});

workspacesRouter.post("/", (req, res) => {
  const { name, icon, color, website, logoUrl, isDefault } = req.body || {};
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required" });
  const ws = createWorkspace({
    name: name.trim(), icon, color,
    website: website || null, logoUrl: logoUrl || null,
    isDefault: !!isDefault,
  });
  res.json({ data: ws });
});

workspacesRouter.get("/:id", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  const owned  = listConnectorInstances(ws.id);
  // Shared from other workspaces (or universal NULL-owner): always include them
  // in the response so non-owners can see + opt in/out. The frontend renders
  // them read-only with an enrollment checkbox.
  const sharedFromOthers = listSharedConnectors().filter(c =>
    c.workspaceId !== ws.id && !owned.some(o => o.id === c.id),
  );

  // Build a workspace lookup for owner metadata on shared rows.
  const allWs = listWorkspaces();
  const wsById = new Map(allWs.map(w => [w.id, w]));

  const connectors = [...owned, ...sharedFromOthers].map(c => {
    const id = c.identityId ? getIdentity(c.identityId) : null;
    const isOwned = c.workspaceId === ws.id;
    const enabledList = Array.isArray((c.config as any)?.enabledWorkspaces)
      ? ((c.config as any).enabledWorkspaces as string[])
      : null;
    const enabledForThisWorkspace = isOwned
      ? true
      : (c.shared ? (enabledList ? enabledList.includes(ws.id) : false) : false);
    const owner = c.workspaceId ? wsById.get(c.workspaceId) : null;
    return {
      ...c,
      source: isOwned ? "owned" : "shared" as "owned" | "shared",
      ownerWorkspace: owner ? { id: owner.id, name: owner.name, icon: owner.icon, color: owner.color, logoUrl: owner.logoUrl, website: owner.website } : null,
      enabledForThisWorkspace,
      identity: id ? {
        account: id.account,
        label: id.label,
        hasToken: !!id.accessToken,
        accessToken: id.accessToken || null,
        refreshToken: id.refreshToken || null,
        displayColor: id.displayColor,
      } : null,
    };
  });
  res.json({ data: { workspace: ws, connectors } });
});

workspacesRouter.patch("/:id", (req, res) => {
  const updated = updateWorkspace(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "workspace not found" });
  res.json({ data: updated });
});

workspacesRouter.delete("/:id", (req, res) => {
  const ok = deleteWorkspace(req.params.id);
  if (!ok) return res.status(404).json({ error: "workspace not found" });
  res.json({ data: { ok: true } });
});

// Connect / update / add-another API-key connector (github / jira / notion / clickup).
// Body:
//   { type, token, account?, label?, config?, connectorId?, addAnother? }
// Behavior:
//   - connectorId set → update that specific instance (lets a workspace hold multiple).
//   - addAnother=true → always create a new instance + identity.
//   - otherwise → upsert by type (legacy single-instance flow, unchanged).
workspacesRouter.post("/:id/connect", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });

  const { type, token, account, label, config: connConfig, connectorId, addAnother } = req.body || {};
  if (!type || !token) return res.status(400).json({ error: "type and token are required" });

  const COLORS: Record<string, string> = { github: "#24292e", jira: "#0052cc", notion: "#000000", clickup: "#7B68EE" };

  // Resolve which connector (if any) is being edited.
  let target: ReturnType<typeof listConnectorInstances>[number] | undefined;
  if (connectorId) {
    target = listConnectorInstances(ws.id).find(c => c.id === connectorId);
    if (!target) return res.status(404).json({ error: "connector not found in this workspace" });
  } else if (!addAnother) {
    target = listConnectorInstances(ws.id).find(c => c.type === type);
  }

  // Merge incoming config onto the existing one so per-connector settings
  // (e.g. Jira watchedUsers) survive a credentials update from the apikey form.
  const mergedConfig = (connConfig && target)
    ? { ...(target.config || {}), ...connConfig }
    : connConfig;

  let identityId: string;
  if (target?.identityId) {
    updateIdentity(target.identityId, {
      accessToken: token,
      ...(account ? { account } : {}),
      ...(label   ? { label }   : {}),
    });
    identityId = target.identityId;
    if (mergedConfig) updateConnectorInstance(target.id, { config: mergedConfig });
  } else {
    const id = createIdentity({
      type,
      label: label || (account ? `${type} · ${account}` : type),
      account: account || null,
      accessToken: token,
      displayColor: COLORS[type] || null,
    });
    identityId = id.id;
    if (target) {
      updateConnectorInstance(target.id, { identityId, ...(mergedConfig ? { config: mergedConfig } : {}) });
    } else {
      createConnectorInstance({ workspaceId: ws.id, type, identityId, config: mergedConfig || {}, enabled: true });
    }
  }
  res.json({ data: { ok: true } });
});

// Disconnect an OAuth connector by type — unlinks (and removes) the identity, keeps the connector slot.
workspacesRouter.delete("/:id/connectors/by-type/:type", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });

  const all = listConnectorInstances();
  const mine = listConnectorInstances(ws.id).filter(c => c.type === req.params.type);
  if (!mine.length) return res.status(404).json({ error: "connector not found" });

  for (const c of mine) {
    if (c.identityId) {
      const usedElsewhere = all.some(o => o.id !== c.id && o.identityId === c.identityId);
      if (!usedElsewhere) deleteIdentity(c.identityId);
    }
    // Outlook: each connected account IS its own connector row — delete the whole row.
    // Google/Slack: keep the connector slot, just clear the identity link.
    if (req.params.type === "outlook") {
      deleteConnectorInstance(c.id);
    } else {
      updateConnectorInstance(c.id, { identityId: null });
    }
  }
  res.json({ data: { ok: true } });
});

// Toggle whether a workspace is opted into a shared connector. Enrollment lives
// in the shared connector's config.enabledWorkspaces list — never destructive.
workspacesRouter.put("/:id/shared/:ciId/enrollment", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });

  const all = listConnectorInstances();
  const ci  = all.find(c => c.id === req.params.ciId && c.shared);
  if (!ci) return res.status(404).json({ error: "shared connector not found" });

  const enabled = !!(req.body || {}).enabled;
  const cfg     = { ...ci.config };
  const list    = Array.isArray((cfg as any).enabledWorkspaces) ? [...(cfg as any).enabledWorkspaces as string[]] : null;

  // Materialize legacy rows with the current set of workspaces so the toggle
  // reflects the real state instead of "everywhere".
  const wsIds = listWorkspaces().map(w => w.id);
  const next  = new Set<string>(list ?? []);
  if (enabled) next.add(ws.id);
  else next.delete(ws.id);
  (cfg as any).enabledWorkspaces = [...next];

  updateConnectorInstance(ci.id, { config: cfg });
  res.json({ data: { ok: true, enabled, enabledWorkspaces: (cfg as any).enabledWorkspaces } });
});

workspacesRouter.get("/:id/connectors", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  res.json({ data: listConnectorInstances(ws.id) });
});

workspacesRouter.post("/:id/connectors", (req, res) => {
  const ws = getWorkspace(req.params.id);
  if (!ws) return res.status(404).json({ error: "workspace not found" });
  const { type, identityId, config, enabled, shared, shareWithOverview } = req.body || {};
  if (typeof type !== "string" || !type) return res.status(400).json({ error: "type is required" });
  const ci = createConnectorInstance({ workspaceId: ws.id, type, identityId, config, enabled, shared: !!shared, shareWithOverview: !!shareWithOverview });
  res.json({ data: ci });
});

// ---------------- Identities ----------------
export const identitiesRouter = Router();

identitiesRouter.get("/", (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  res.json({ data: listIdentities(type).map(safeIdentity) });
});

identitiesRouter.post("/", (req, res) => {
  const { type, label, account, accessToken, refreshToken, expiresAt, scope, displayColor } = req.body || {};
  if (typeof type !== "string" || !type) return res.status(400).json({ error: "type is required" });
  if (typeof accessToken !== "string" || !accessToken) return res.status(400).json({ error: "accessToken is required" });
  const id = createIdentity({ type, label, account, accessToken, refreshToken, expiresAt, scope, displayColor });
  res.json({ data: safeIdentity(id) });
});

identitiesRouter.get("/:id", (req, res) => {
  const i = getIdentity(req.params.id);
  if (!i) return res.status(404).json({ error: "identity not found" });
  res.json({ data: safeIdentity(i) });
});

identitiesRouter.patch("/:id", (req, res) => {
  const updated = updateIdentity(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: "identity not found" });
  res.json({ data: safeIdentity(updated) });
});

identitiesRouter.delete("/:id", (req, res) => {
  const ok = deleteIdentity(req.params.id);
  if (!ok) return res.status(404).json({ error: "identity not found" });
  res.json({ data: { ok: true } });
});

// ---------------- Connectors (universal + by id) ----------------
export const connectorsRouter = Router();

connectorsRouter.get("/", (_req, res) => {
  const all = listConnectorInstances();
  const allWs = listWorkspaces();
  const wsById = new Map(allWs.map(w => [w.id, w]));
  const data = all.map(c => {
    const id = c.identityId ? getIdentity(c.identityId) : null;
    const owner = c.workspaceId ? wsById.get(c.workspaceId) : null;
    return {
      ...c,
      ownerWorkspace: owner ? { id: owner.id, name: owner.name, icon: owner.icon, color: owner.color, logoUrl: owner.logoUrl, website: owner.website } : null,
      identity: id ? {
        account: id.account,
        label: id.label,
        hasToken: !!id.accessToken,
        accessToken: id.accessToken || null,
        refreshToken: id.refreshToken || null,
        displayColor: id.displayColor,
      } : null,
    };
  });
  res.json({ data });
});

connectorsRouter.patch("/:id", (req, res) => {
  const body = req.body || {};
  const patch: Parameters<typeof updateConnectorInstance>[1] = {};
  if (body.identityId !== undefined) patch.identityId = body.identityId;
  if (body.config     !== undefined) patch.config     = body.config;
  if (body.enabled    !== undefined) patch.enabled    = !!body.enabled;
  if (body.shared     !== undefined) patch.shared     = !!body.shared;
  if (body.shareWithOverview !== undefined) patch.shareWithOverview = !!body.shareWithOverview;

  // Whenever `shared` is explicitly toggled (in either direction), wipe the
  // enabledWorkspaces enrollment list. This guarantees:
  //   - turning ON → other workspaces start out opted-OUT and must re-opt-in
  //   - turning OFF → no stale enrollments survive to silently re-grant access
  //                   the next time the owner re-enables sharing
  // Without this reset, the prior enrollment array is preserved and re-enabling
  // share silently restores access without the other workspaces' fresh consent.
  // Caller can opt out of the reset by sending an explicit `config` payload.
  if (body.shared !== undefined && body.config === undefined) {
    const all = listConnectorInstances();
    const cur = all.find(c => c.id === req.params.id);
    if (cur) {
      patch.config = { ...(cur.config as any), enabledWorkspaces: [] };
    }
  }

  const updated = updateConnectorInstance(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "connector not found" });
  res.json({ data: updated });
});

connectorsRouter.delete("/:id", (req, res) => {
  const ok = deleteConnectorInstance(req.params.id);
  if (!ok) return res.status(404).json({ error: "connector not found" });
  res.json({ data: { ok: true } });
});
