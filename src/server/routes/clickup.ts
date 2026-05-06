import { Router } from "express";
import * as clickup from "../integrations/clickup.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import { listConnectorsForOverview, listConnectorsForWorkspace } from "../lib/workspace-config.js";

export const clickupRouter = Router();

// Resolve which workspace ids to fan-out across for ClickUp:
//   - Workspace selected → just that workspace
//   - Overview           → every owner of an overview-enabled clickup connector
// scopeId: if set, only include that specific connector instance's workspace.
function clickupTargetWorkspaceIds(scopeId?: string): (string | undefined)[] {
  const wsId = getActiveWorkspaceId();
  if (wsId) return [wsId];
  const all = listConnectorsForOverview();
  const owners = new Set<string>();
  for (const c of all) {
    if (c.type !== "clickup" || !c.workspaceId) continue;
    if (scopeId && c.id !== scopeId) continue;
    owners.add(c.workspaceId);
  }
  return owners.size ? [...owners] : [];
}

clickupRouter.get("/tasks", async (req, res) => {
  const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
  const targets = clickupTargetWorkspaceIds(scopeId);
  const usable = targets.filter(t => clickup.isConfigured(t));
  if (!usable.length) return res.json({ data: [], notConfigured: true, buckets: [], counts: {} });

  try {
    // Union of watched users across every target workspace, de-duped by id.
    const seenWatched = new Set<string>();
    const watched: ReturnType<typeof clickup.getWatchedUsers> = [];
    for (const t of usable) {
      for (const w of clickup.getWatchedUsers(t)) {
        if (!w.id || seenWatched.has(w.id)) continue;
        seenWatched.add(w.id);
        watched.push(w);
      }
    }

    const validIds = new Set<string>([clickup.MINE_BUCKET_ID, ...watched.map(w => w.id)]);
    const requested = (req.query.bucket as string | undefined) ?? clickup.MINE_BUCKET_ID;
    const bucket = validIds.has(requested) ? requested : clickup.MINE_BUCKET_ID;

    const allIds = [clickup.MINE_BUCKET_ID, ...watched.map(w => w.id)];

    const fetchBucket = async (id: string): Promise<any[]> => {
      const lists = await Promise.all(usable.map(t => {
        if (id === clickup.MINE_BUCKET_ID) return clickup.listMyTasks(t).catch(() => []);
        const w = watched.find(x => x.id === id)!;
        return clickup.listWatchedMemberTasks(w, t).catch(() => []);
      }));
      // De-dupe across workspaces by ClickUp task url.
      const seen = new Set<string>();
      const out: any[] = [];
      for (const list of lists) {
        for (const t of list as any[]) {
          if (seen.has(t.url)) continue;
          seen.add(t.url);
          out.push(t);
        }
      }
      return out;
    };

    const allLists = await Promise.all(allIds.map(fetchBucket));

    const counts: Record<string, number> = {};
    const merged: Record<string, any[]> = {};
    allIds.forEach((id, i) => {
      merged[id] = allLists[i];
      counts[id] = allLists[i].length;
    });

    res.json({ data: merged[bucket] ?? [], bucket, counts, buckets: watched });
  } catch (err: any) {
    res.status(502).json({ error: err.message || "ClickUp API error" });
  }
});
