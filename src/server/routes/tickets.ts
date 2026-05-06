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

export type ConnectorCloningConfig = { cloningEnabled: boolean; defaultTargetProject: string };

type ResolvedJira = {
  id: string;
  creds: jira.JiraCreds;
  watchedUsers: WatchedUser[];
  cloningConfig: ConnectorCloningConfig;
};

export function extractCloningConfig(cfg: Record<string, unknown>): ConnectorCloningConfig {
  return {
    cloningEnabled:       !!(cfg.cloningEnabled),
    defaultTargetProject: typeof cfg.defaultTargetProject === "string" ? cfg.defaultTargetProject : "",
  };
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
  const primaryConfig = (scopeId ? resolved.find(r => r.id === scopeId) : resolved[0])?.cloningConfig
    ?? { cloningEnabled: false, defaultTargetProject: "" };

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
