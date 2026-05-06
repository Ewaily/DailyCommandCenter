import { Router } from "express";
import * as github from "../integrations/github.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import { listConnectorsForWorkspace, listConnectorsForOverview, getIdentity } from "../lib/workspace-config.js";

export const prsRouter = Router();

const BUCKETS: github.PrBucket[] = ["review", "mine", "all", "closed"];

prsRouter.get("/queue", async (req, res) => {
  const wsId = getActiveWorkspaceId();
  const all  = wsId ? listConnectorsForWorkspace(wsId) : listConnectorsForOverview();

  const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : null;

  // Collect every GitHub connector visible in this scope.
  const credsList: { token: string; username: string; repo: string }[] = [];
  for (const c of all) {
    if (c.type !== "github" || !c.enabled) continue;
    if (scopeId && c.id !== scopeId) continue;
    const identity = c.identityId ? getIdentity(c.identityId) : null;
    const token = identity?.accessToken || "";
    const cfg = c.config as { username?: string; repo?: string };
    const username = cfg.username || identity?.account || "";
    const repo = cfg.repo || "";
    if (token && username && repo) credsList.push({ token, username, repo });
  }

  if (!credsList.length) return res.json({ data: [], notConfigured: true });

  const bucket = (BUCKETS.includes(req.query.bucket as any) ? req.query.bucket : "review") as github.PrBucket;

  // Fan-out: fetch all buckets from every connector, then merge.
  const perConnector = await Promise.all(
    credsList.map(creds => Promise.all(BUCKETS.map(b => github.listBucketWith(creds, b).catch(() => [])))),
  );

  // Merge across connectors: deduplicate by URL, aggregate counts per bucket.
  const seen = new Set<string>();
  const merged: Record<github.PrBucket, ReturnType<typeof github.listBucketWith> extends Promise<infer T> ? T : never> = { review: [], mine: [], all: [], closed: [] };
  const counts: Record<string, number> = { review: 0, mine: 0, all: 0, closed: 0 };

  for (const connectorBuckets of perConnector) {
    BUCKETS.forEach((b, i) => {
      for (const pr of connectorBuckets[i]) {
        if (!seen.has(pr.url)) {
          seen.add(pr.url);
          (merged[b] as any[]).push(pr);
        }
      }
      counts[b] = merged[b].length;
    });
  }

  res.json({ data: merged[bucket], counts, bucket });
});
