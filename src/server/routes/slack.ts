import { Router } from "express";
import { getChannelDigest, getMentions, invalidateMentionsCache, type DigestConfig } from "../integrations/slack.js";
import { getSlackToken, getSlackUserId } from "../auth/slack.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import { listConnectorsForWorkspace, listConnectorsForOverview, updateConnectorInstance } from "../lib/workspace-config.js";

export const slackRouter = Router();

type SlackConnectorView = { id: string; token: string; userId: string; digestCfg?: DigestConfig };

/** Returns all Slack connector credentials visible to the active workspace. */
function resolveSlackAll(scopeId?: string): SlackConnectorView[] {
  const wsId = getActiveWorkspaceId();
  // Overview (no workspace selected): only connectors the owner explicitly
  // marked "Show in Overview". Drilled into a workspace: owned + opted-in shared.
  const all = wsId
    ? listConnectorsForWorkspace(wsId)
    : listConnectorsForOverview();

  const result: SlackConnectorView[] = [];
  for (const slackCi of all) {
    if (slackCi.type !== "slack" || !slackCi.enabled) continue;
    if (scopeId && slackCi.id !== scopeId) continue;
    const identityId = slackCi.identityId ?? null;
    let token: string;
    let userId: string;
    try {
      token  = getSlackToken(identityId);
      userId = getSlackUserId(identityId);
    } catch {
      continue;
    }

    const cfgChannels = slackCi.config?.digestChannels as { id: string; name: string }[] | undefined;
    const cfgMsgsPerChannel = slackCi.config?.msgsPerChannel as number | undefined;
    const digestCfg = cfgChannels?.length
      ? { channels: cfgChannels, msgsPerChannel: cfgMsgsPerChannel ?? 5 }
      : undefined;

    result.push({ id: slackCi.id, token, userId, digestCfg });
  }
  return result;
}

slackRouter.get("/digest", async (req, res, next) => {
  try {
    const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
    const connectors = resolveSlackAll(scopeId);
    if (!connectors.length) return res.json({ data: [], notConfigured: true });

    // Fan-out: fetch digest from all Slack connectors and merge by channel ID.
    const allDigests = await Promise.all(
      connectors.map(r => getChannelDigest(r.token, r.digestCfg).catch(() => [])),
    );

    const seen = new Set<string>();
    const merged: any[] = [];
    for (const digests of allDigests) {
      for (const d of digests) {
        if (!seen.has(d.channelId)) {
          seen.add(d.channelId);
          merged.push(d);
        }
      }
    }

    res.json({ data: merged, fresh_at: Date.now() });
  } catch (e) { next(e); }
});

// Returns the digest config for the first Slack connector visible to the
// active workspace. Falls back to empty channels if none is configured yet —
// never bleeds another workspace's channel list.
slackRouter.get("/digest/config", (_req, res) => {
  const connectors = resolveSlackAll();
  const first = connectors[0];
  const cfg: DigestConfig = {
    channels: (first ? (first.digestCfg?.channels ?? []) : []),
    msgsPerChannel: first?.digestCfg?.msgsPerChannel ?? 5,
  };
  res.json({ data: cfg });
});

// Saves digest config to the connector_instances row so it is scoped to this
// workspace's connector, never to a global settings key.
slackRouter.put("/digest/config", (req, res) => {
  const wsId = getActiveWorkspaceId();
  if (!wsId) { res.status(400).json({ error: "no active workspace" }); return; }

  const { channels, msgsPerChannel } = req.body as Partial<DigestConfig>;
  if (!Array.isArray(channels) || typeof msgsPerChannel !== "number") {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const cfg: DigestConfig = {
    channels: channels.map(c => ({ id: String(c.id || ""), name: String(c.name || "") })).filter(c => c.id),
    msgsPerChannel: Math.max(1, Math.min(20, Math.round(msgsPerChannel))),
  };

  // Find the first owned Slack connector for this workspace and persist there.
  const all = listConnectorsForWorkspace(wsId);
  const owned = all.find(c => c.type === "slack" && c.workspaceId === wsId);
  if (!owned) { res.status(404).json({ error: "no owned Slack connector found for this workspace" }); return; }

  const merged = { ...(owned.config as Record<string, unknown> ?? {}), digestChannels: cfg.channels, msgsPerChannel: cfg.msgsPerChannel };
  updateConnectorInstance(owned.id, { config: merged });

  res.json({ data: cfg });
});

slackRouter.get("/channels/:id/messages", async (_req, res) => {
  res.status(501).json({ error: "use /api/slack/digest" });
});

slackRouter.get("/mentions", async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(30, Number(req.query.days || 7)));
    if (req.query.bust === "1") invalidateMentionsCache();
    const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : undefined;
    const connectors = resolveSlackAll(scopeId);
    if (!connectors.length) return res.json({ data: [], notConfigured: true });

    // Fan-out: fetch mentions from all Slack connectors and merge by ts+channel.
    const allMentions = await Promise.all(
      connectors.map(r => getMentions(r.token, r.userId, days).catch(() => [])),
    );

    const seen = new Set<string>();
    const merged: any[] = [];
    for (const mentions of allMentions) {
      for (const m of mentions) {
        const key = `${m.channelId}::${m.ts}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(m);
        }
      }
    }

    // Re-sort by timestamp descending after merging multiple accounts.
    merged.sort((a, b) => Number(b.ts.replace(".", "")) - Number(a.ts.replace(".", "")));

    res.json({ data: merged, fresh_at: Date.now() });
  } catch (e) { next(e); }
});
