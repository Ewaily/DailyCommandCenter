import { Router } from "express";
import * as jira from "../integrations/jira.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import {
  listConnectorsForWorkspace,
  listConnectorsForOverview,
  getIdentity,
  type WatchedUser,
} from "../lib/workspace-config.js";

export const ticketsRouter = Router();

// Public response shape — what the client receives in /tickets and /clickup envelopes.
// We deliberately do NOT expose the target Jira credentials here; the token never
// leaves the server outside the authenticated `/connectors` settings response.
export type ConnectorCloningConfig = {
  cloningEnabled:     boolean;
  cloneTargetProject: string;
  // The source connector id — the click-to-clone button needs it so the
  // backend can look up the stored target creds for THIS specific connector.
  connectorId?:       string;
};

type ResolvedJira = {
  id: string;
  creds: jira.JiraCreds;
  watchedUsers: WatchedUser[];
  cloningConfig: ConnectorCloningConfig;
};

export function extractCloningConfig(cfg: Record<string, unknown>): ConnectorCloningConfig {
  return {
    cloningEnabled:     !!(cfg.cloningEnabled),
    cloneTargetProject: typeof cfg.cloneTargetProject === "string" ? cfg.cloneTargetProject : "",
  };
}

// Server-internal — full credentials needed to actually create the cloned issue.
// Pulled directly from the source connector's config; never sent to the client
// outside the settings response.
export type CloneCredentials = {
  baseUrl:    string;
  email:      string;
  apiToken:   string;
  projectKey: string;
};

export function extractCloneCredentials(cfg: Record<string, unknown>): CloneCredentials | null {
  if (!cfg.cloningEnabled) return null;
  const baseUrl    = typeof cfg.cloneTargetUrl     === "string" ? cfg.cloneTargetUrl.trim()     : "";
  const email      = typeof cfg.cloneTargetEmail   === "string" ? cfg.cloneTargetEmail.trim()   : "";
  const apiToken   = typeof cfg.cloneTargetToken   === "string" ? cfg.cloneTargetToken.trim()   : "";
  const projectKey = typeof cfg.cloneTargetProject === "string" ? cfg.cloneTargetProject.trim() : "";
  if (!baseUrl || !email || !apiToken || !projectKey) return null;
  return { baseUrl, email, apiToken, projectKey };
}

function resolveJira(scopeId?: string): ResolvedJira[] {
  const wsId = getActiveWorkspaceId();
  const all  = wsId ? listConnectorsForWorkspace(wsId) : listConnectorsForOverview();

  const result: ResolvedJira[] = [];
  for (const c of all) {
    if (c.type !== "jira" || !c.enabled) continue;
    if (scopeId && c.id !== scopeId) continue;
    const identity = c.identityId ? getIdentity(c.identityId) : null;
    const cfg = c.config as { baseUrl?: string; email?: string; watchedUsers?: WatchedUser[] };
    const apiToken = identity?.accessToken || "";
    const email = cfg.email || identity?.account || "";
    const baseUrl = cfg.baseUrl || "";
    if (!apiToken || !email || !baseUrl) continue;
    result.push({
      id: c.id,
      creds: { baseUrl, email, apiToken },
      watchedUsers: Array.isArray(cfg.watchedUsers) ? cfg.watchedUsers : [],
      cloningConfig: extractCloningConfig(c.config),
    });
  }
  return result;
}

// Union watched users across all connectors, de-duped by id; first occurrence wins
// so the order matches the user's primary connector.
function unionBuckets(resolved: ResolvedJira[]): WatchedUser[] {
  const seen = new Set<string>();
  const out: WatchedUser[] = [];
  for (const r of resolved) {
    for (const w of r.watchedUsers) {
      if (!w.id || seen.has(w.id)) continue;
      seen.add(w.id);
      out.push(w);
    }
  }
  return out;
}

ticketsRouter.get("/mine", async (req, res) => {
  const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
  const resolved = resolveJira(scopeId);
  if (!resolved.length) return res.json({ data: [], notConfigured: true, buckets: [], counts: {} });

  const watched = unionBuckets(resolved);
  const validIds = new Set<string>([jira.MINE_BUCKET_ID, ...watched.map(w => w.id)]);
  const requested = (req.query.bucket as string | undefined) ?? jira.MINE_BUCKET_ID;
  const bucket = validIds.has(requested) ? requested : jira.MINE_BUCKET_ID;

  // Fan out: for each connector × each bucket id, fetch in parallel.
  const fetchBucket = async (id: string): Promise<unknown[]> => {
    if (id === jira.MINE_BUCKET_ID) {
      const lists = await Promise.all(resolved.map(r => jira.listMineWith(r.creds).catch(() => [])));
      return lists.flat();
    }
    const w = watched.find(x => x.id === id);
    if (!w) return [];
    const lists = await Promise.all(resolved.map(r => jira.listWatchedUserWith(r.creds, w).catch(() => [])));
    return lists.flat();
  };

  const allIds = [jira.MINE_BUCKET_ID, ...watched.map(w => w.id)];
  const allLists = await Promise.all(allIds.map(fetchBucket));

  const counts: Record<string, number> = {};
  const merged: Record<string, any[]> = {};
  allIds.forEach((id, i) => {
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const t of allLists[i] as any[]) {
      const key = `${t.url}::${t.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(t);
    }
    merged[id] = deduped;
    counts[id] = deduped.length;
  });

  // Use the scoped connector's config when connectorId is set; else the first resolved.
  // resolved is guaranteed non-empty here (early return above) and resolveJira already
  // filtered by scopeId, so the lookup never misses.
  const primary = scopeId ? resolved.find(r => r.id === scopeId)! : resolved[0];
  const primaryConfig: ConnectorCloningConfig = {
    ...primary.cloningConfig,
    connectorId: primary.id,
  };

  res.json({
    data: merged[bucket] ?? [],
    bucket,
    counts,
    buckets: watched,
    connectorCloningConfig: primaryConfig,
  });
});

ticketsRouter.get("/team", async (req, res) => {
  const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
  const resolved = resolveJira(scopeId);
  if (!resolved.length) return res.json({ data: [], notConfigured: true });

  const project = req.query.project as string | undefined;

  const results = await Promise.all(
    resolved.map(r => jira.listTeamIssuesWith(r.creds, project).catch(() => [])),
  );

  const seen = new Set<string>();
  const data: any[] = [];
  for (const tickets of results) {
    for (const t of tickets) {
      const dedupeKey = `${t.url}::${t.key}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        data.push(t);
      }
    }
  }

  res.json({ data });
});
