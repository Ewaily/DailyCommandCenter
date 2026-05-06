import { Router } from "express";
import * as jira from "../integrations/jira.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import { listConnectorsForWorkspace, listConnectorsForOverview, getIdentity } from "../lib/workspace-config.js";

export const cloneRouter = Router();

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

cloneRouter.post("/clone-ticket", async (req, res) => {
  const { sourceProvider, title, description, originalLink, targetJiraProjectId, connectorId } = req.body as {
    sourceProvider: string;
    title: string;
    description?: string;
    originalLink: string;
    targetJiraProjectId: string;
    connectorId?: string;
  };

  if (!title || !originalLink || !targetJiraProjectId || !sourceProvider) {
    return res.status(400).json({ error: "title, originalLink, targetJiraProjectId, and sourceProvider are required" });
  }

  const resolved = resolveFirstJira(connectorId);
  if (!resolved) return res.status(503).json({ error: "No Jira connector configured for this workspace" });

  const providerLabel  = sourceProvider === "clickup" ? "ClickUp" : "Jira";
  const descriptionAdf = jira.buildCloneAdf(providerLabel, originalLink, description || "");

  try {
    const result = await jira.createIssue(resolved.creds, {
      projectKey:     targetJiraProjectId,
      summary:        title,
      descriptionAdf,
    });
    const url = `${resolved.creds.baseUrl}/browse/${result.key}`;
    res.json({ data: { key: result.key, id: result.id, url } });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});
