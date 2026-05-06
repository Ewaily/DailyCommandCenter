import { Router } from "express";
import * as jira from "../integrations/jira.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import { listConnectorsForWorkspace, listConnectorsForOverview, getIdentity } from "../lib/workspace-config.js";
import { extractCloneCredentials } from "./tickets.js";

export const cloneRouter = Router();

// GET /projects: lists Jira projects from the workspace's primary Jira connector
// (used by the settings UI to populate the target-project dropdown).
function resolveFirstJira(scopeId?: string): { creds: jira.JiraCreds } | null {
  const wsId = getActiveWorkspaceId();
  const all  = wsId ? listConnectorsForWorkspace(wsId) : listConnectorsForOverview();
  for (const c of all) {
    if (c.type !== "jira" || !c.enabled) continue;
    if (scopeId && c.id !== scopeId) continue;
    const identity = c.identityId ? getIdentity(c.identityId) : null;
    const cfg      = c.config as { baseUrl?: string; email?: string };
    const apiToken = identity?.accessToken || "";
    const email    = cfg.email || identity?.account || "";
    const baseUrl  = cfg.baseUrl || "";
    if (apiToken && email && baseUrl) return { creds: { baseUrl, email, apiToken } };
  }
  return null;
}

cloneRouter.get("/projects", async (req, res) => {
  const scopeId  = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
  const resolved = resolveFirstJira(scopeId);
  if (!resolved) return res.json({ data: [], notConfigured: true });
  try {
    const projects = await jira.listProjectsWith(resolved.creds);
    res.json({ data: projects });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// POST /clone-ticket: creates a Jira issue in the TARGET instance configured on
// the source connector's cloning settings. The target Jira creds are stored on
// each connector independently (cloneTargetUrl/Email/Token/Project) so a clone
// from Workspace A's ClickUp can land in Workspace B's Jira without that B
// instance being a connected source-connector here.
cloneRouter.post("/clone-ticket", async (req, res) => {
  const { sourceProvider, title, description, originalLink, connectorId } = req.body as {
    sourceProvider: string;
    title: string;
    description?: string;
    originalLink: string;
    connectorId?: string;
  };

  if (!title || !originalLink || !sourceProvider || !connectorId) {
    return res.status(400).json({ error: "title, originalLink, sourceProvider, and connectorId are required" });
  }

  const wsId = getActiveWorkspaceId();
  const all = wsId ? listConnectorsForWorkspace(wsId) : listConnectorsForOverview();
  const source = all.find(c => c.id === connectorId);
  if (!source) return res.status(404).json({ error: "Connector not found" });

  const creds = extractCloneCredentials(source.config);
  if (!creds) {
    return res.status(503).json({
      error: "Cloning is not fully configured on this connector. Open Settings → Workspaces → this connector card and fill in Target Base URL, Email, API Token, and Project.",
    });
  }

  const providerLabel  = sourceProvider === "clickup" ? "ClickUp" : "Jira";
  const descriptionAdf = jira.buildCloneAdf(providerLabel, originalLink, description || "");

  try {
    const result = await jira.createIssue(
      { baseUrl: creds.baseUrl, email: creds.email, apiToken: creds.apiToken },
      { projectKey: creds.projectKey, summary: title, descriptionAdf },
    );
    const url = `${creds.baseUrl}/browse/${result.key}`;
    res.json({ data: { key: result.key, id: result.id, url } });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});
