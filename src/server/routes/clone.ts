import { Router } from "express";
import * as jira from "../integrations/jira.js";
import * as clickup from "../integrations/clickup.js";
import { getDb } from "../db.js";
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

/** Extracts a Jira issue key from a browse URL, e.g. https://x.atlassian.net/browse/PROJ-42 → "PROJ-42" */
function jiraKeyFromUrl(url: string): string | null {
  const m = url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Extracts a ClickUp task ID from a task URL, e.g. https://app.clickup.com/t/abc123 → "abc123" */
function clickupIdFromUrl(url: string): string | null {
  const m = url.match(/\/t\/([a-z0-9]+)/i);
  return m ? m[1] : null;
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

// GET /clone-history: returns all clone history records keyed by source URL.
cloneRouter.get("/clone-history", (_req, res) => {
  const rows = getDb()
    .prepare("SELECT source_url, source_title, cloned_key, cloned_url, cloned_at FROM clone_history ORDER BY cloned_at DESC")
    .all() as { source_url: string; source_title: string; cloned_key: string; cloned_url: string; cloned_at: number }[];
  // Group by source_url — most recent clone per ticket URL
  const bySource: Record<string, { key: string; url: string; title: string; clonedAt: number }> = {};
  for (const r of rows) {
    if (!bySource[r.source_url]) {
      bySource[r.source_url] = { key: r.cloned_key, url: r.cloned_url, title: r.source_title, clonedAt: r.cloned_at };
    }
  }
  res.json({ data: bySource });
});

// POST /clone-ticket: creates a Jira issue in the TARGET instance configured on
// the source connector's cloning settings. Fetches the full description from the
// source provider at clone time — no need to encode it in the frontend.
cloneRouter.post("/clone-ticket", async (req, res) => {
  const { sourceProvider, title, originalLink, connectorId } = req.body as {
    sourceProvider: string;
    title: string;
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

  // Fetch the full description from the source provider.
  let sourceDescription: unknown = null;
  if (sourceProvider === "jira") {
    const issueKey = jiraKeyFromUrl(originalLink);
    if (issueKey) {
      const sourceCreds = resolveFirstJira(connectorId) ?? resolveFirstJira();
      if (sourceCreds) {
        sourceDescription = await jira.getIssueDescription(sourceCreds.creds, issueKey);
      }
    }
  } else if (sourceProvider === "clickup") {
    const taskId = clickupIdFromUrl(originalLink);
    if (taskId) {
      sourceDescription = await clickup.getTaskDescription(taskId, wsId ?? undefined);
    }
  }

  const providerLabel  = sourceProvider === "clickup" ? "ClickUp" : "Jira";
  const descriptionAdf = jira.buildCloneAdf(providerLabel, originalLink, sourceDescription);

  const targetCreds = { baseUrl: creds.baseUrl, email: creds.email, apiToken: creds.apiToken };

  try {
    const result = await jira.createIssue(targetCreds, { projectKey: creds.projectKey, summary: title, descriptionAdf });
    const clonedUrl = `${creds.baseUrl}/browse/${result.key}`;

    // Persist to clone_history — never deleted.
    getDb().prepare(
      "INSERT INTO clone_history (source_url, source_title, cloned_key, cloned_url, cloned_at) VALUES (?, ?, ?, ?, ?)",
    ).run(originalLink, title, result.key, clonedUrl, Date.now());

    // Clone attachments (images + videos) — best-effort, non-fatal.
    let attachmentsCloned = 0;
    try {
      if (sourceProvider === "clickup") {
        const taskId = clickupIdFromUrl(originalLink);
        if (taskId) {
          const atts = await clickup.getTaskAttachments(taskId, wsId ?? undefined);
          for (const att of atts) {
            if (att.size > 0 && att.size > 25 * 1024 * 1024) continue;
            const dl = await clickup.downloadClickUpFile(att.url, wsId ?? undefined);
            if (!dl || !/^(image|video)\//.test(dl.mimeType)) continue;
            await jira.uploadAttachment(targetCreds, result.key, att.title, dl.buffer, dl.mimeType);
            attachmentsCloned++;
          }
        }
      } else if (sourceProvider === "jira") {
        const issueKey = jiraKeyFromUrl(originalLink);
        if (issueKey) {
          const sourceCreds = resolveFirstJira(connectorId) ?? resolveFirstJira();
          if (sourceCreds) {
            const atts = await jira.getIssueAttachments(sourceCreds.creds, issueKey);
            for (const att of atts) {
              if (att.size > 25 * 1024 * 1024) continue;
              const dl = await jira.downloadJiraFile(sourceCreds.creds, att.url);
              if (!dl) continue;
              await jira.uploadAttachment(targetCreds, result.key, att.filename, dl.buffer, dl.mimeType);
              attachmentsCloned++;
            }
          }
        }
      }
    } catch { /* attachment failures never abort the clone */ }

    res.json({ data: { key: result.key, id: result.id, url: clonedUrl, attachmentsCloned } });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});
