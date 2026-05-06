import { config } from "../config.js";
import { getDb } from "../db.js";
import { formatSlackText, type UserMap, type ChannelMap, type SubteamMap } from "../lib/slack-formatter.js";
import { memo, invalidate } from "../lib/cache.js";
import { getAppSetting } from "../lib/app-settings.js";

const DIGEST_CONFIG_KEY = "slack.digest.config";

export type DigestConfig = {
  channels: { id: string; name: string }[];
  msgsPerChannel: number;
};

export function getDigestConfig(): DigestConfig {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(DIGEST_CONFIG_KEY) as { value: string } | undefined;
    if (row) return JSON.parse(row.value) as DigestConfig;
  } catch { /* fall through */ }
  return { channels: config.slack.digestChannels, msgsPerChannel: 5 };
}

export function saveDigestConfig(cfg: DigestConfig): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(DIGEST_CONFIG_KEY, JSON.stringify(cfg));
  invalidate("slack.digest");
}

const SLACK_API = "https://slack.com/api";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function slackGet<T = any>(path: string, params: Record<string, any> = {}, token: string): Promise<T> {
  const url = new URL(`${SLACK_API}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  // Retry on 429. Keep total wall time bounded so a rate-limited channel
  // doesn't stall the whole pipeline — caller falls back to stale cache.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      await sleep(Math.min(Math.max(retryAfter, 1), 5) * 1000);
      continue;
    }
    const json: any = await res.json();
    if (!json.ok) {
      if (json.error === "ratelimited" && attempt < 2) { await sleep(2000); continue; }
      throw new Error(`slack ${path}: ${json.error}`);
    }
    return json;
  }
  throw new Error(`slack ${path}: rate limited (exhausted retries)`);
}

// Run an async fn over a list with a concurrency cap. Avoids bursting Slack's
// per-method rate limits when iterating over many DMs.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- User & subteam resolution ----------

const userCache = new Map<string, { name: string; avatar: string | null }>();

export async function resolveUsers(ids: string[], token: string): Promise<UserMap> {
  const out: UserMap = {};
  const todo = ids.filter(id => !userCache.has(id));
  await Promise.all(todo.map(async id => {
    try {
      const r: any = await slackGet("users.info", { user: id }, token);
      const name = r.user?.profile?.display_name?.trim()
        || r.user?.profile?.real_name
        || r.user?.real_name
        || r.user?.name
        || id;
      userCache.set(id, { name, avatar: r.user?.profile?.image_48 || null });
    } catch {
      userCache.set(id, { name: id, avatar: null });
    }
  }));
  for (const id of ids) out[id] = userCache.get(id)?.name || id;
  return out;
}

export function userInfo(id: string) {
  return userCache.get(id) || { name: id, avatar: null };
}

const subteamCache = new Map<string, string>();
export async function resolveSubteams(ids: string[], token: string): Promise<SubteamMap> {
  const todo = ids.filter(id => !subteamCache.has(id));
  if (todo.length) {
    try {
      const r: any = await slackGet("usergroups.list", { include_users: 0 }, token);
      for (const g of r.usergroups || []) subteamCache.set(g.id, g.handle || g.name);
    } catch { /* missing scope: usergroups:read — skip */ }
  }
  const out: SubteamMap = {};
  for (const id of ids) out[id] = subteamCache.get(id) || id;
  return out;
}

const channelCache = new Map<string, string>();
export async function resolveChannels(ids: string[], token: string): Promise<ChannelMap> {
  const out: ChannelMap = {};
  for (const id of ids) {
    if (!channelCache.has(id)) {
      try {
        const r: any = await slackGet("conversations.info", { channel: id }, token);
        channelCache.set(id, r.channel?.name || id);
      } catch {
        channelCache.set(id, id);
      }
    }
    out[id] = channelCache.get(id)!;
  }
  return out;
}

// ---------- Entity extraction from raw text ----------

function extractIds(text: string) {
  const users = new Set<string>();
  const subteams = new Set<string>();
  const channels = new Set<string>();
  const re = /<([^<>]+)>/g;
  let m;
  while ((m = re.exec(text))) {
    const inner = m[1];
    if (inner.startsWith("@")) users.add(inner.slice(1).split("|")[0]);
    else if (inner.startsWith("!subteam^")) subteams.add(inner.slice("!subteam^".length).split("|")[0]);
    else if (inner.startsWith("#")) channels.add(inner.slice(1).split("|")[0]);
  }
  return { users: [...users], subteams: [...subteams], channels: [...channels] };
}

// ---------- Public API ----------

export type SlackMessage = {
  channelId: string;
  channelName: string;
  isDm: boolean;
  ts: string;
  tsHuman: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  text: string;
  html: string;
  permalink: string;
};

function primaryTz(): string {
  return getAppSetting("prefs.primaryTz", "Africa/Cairo") || "Africa/Cairo";
}

function tsToHuman(ts: string): string {
  const tz = primaryTz();
  const d = new Date(Number(ts.split(".")[0]) * 1000);
  const now = new Date();
  const dayOf    = d.toLocaleDateString("en-US", { timeZone: tz });
  const today    = now.toLocaleDateString("en-US", { timeZone: tz });
  const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString("en-US", { timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  if (dayOf === today) return time;
  if (dayOf === yesterday) return `Yesterday · ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const dateStr = d.toLocaleDateString("en-US", {
    timeZone: tz, month: "short", day: "numeric",
    ...(!sameYear ? { year: "numeric" } : {}),
  });
  return `${dateStr} · ${time}`;
}

// Workspace base URL is cached per-token so different Slack workspaces resolve separately.
const wsUrlCache = new Map<string, string>();
async function getWorkspaceUrl(token: string): Promise<string> {
  if (wsUrlCache.has(token)) return wsUrlCache.get(token)!;
  try {
    const r: any = await slackGet("auth.test", {}, token);
    const url = (r.url as string).replace(/\/$/, "");
    wsUrlCache.set(token, url);
    return url;
  } catch {
    wsUrlCache.set(token, "https://app.slack.com");
    return "https://app.slack.com";
  }
}

function buildPermalink(base: string, channelId: string, ts: string): string {
  return `${base}/archives/${channelId}/p${ts.replace(".", "")}`;
}

async function formatBatch(
  msgs: any[],
  channelId: string,
  channelName: string,
  isDm: boolean,
  token: string,
  selfUserId: string,
): Promise<SlackMessage[]> {
  const userIds    = new Set<string>();
  const subteamIds = new Set<string>();
  const channelIds = new Set<string>();
  for (const m of msgs) {
    if (m.user) userIds.add(m.user);
    const ext = extractIds(m.text || "");
    ext.users.forEach(u => userIds.add(u));
    ext.subteams.forEach(s => subteamIds.add(s));
    ext.channels.forEach(c => channelIds.add(c));
  }
  const [users, subteams, channels, wsUrl] = await Promise.all([
    resolveUsers([...userIds], token),
    resolveSubteams([...subteamIds], token),
    resolveChannels([...channelIds], token),
    getWorkspaceUrl(token),
  ]);

  return msgs.map(m => {
    const author = m.user ? userInfo(m.user) : { name: m.username || "Slackbot", avatar: null };
    const html = formatSlackText(m.text || "", { users, subteams, channels, selfUserId });
    return {
      channelId,
      channelName,
      isDm,
      ts: m.ts,
      tsHuman: tsToHuman(m.ts),
      authorId: m.user || m.bot_id || "",
      authorName: author.name,
      authorAvatar: author.avatar,
      text: m.text || "",
      html,
      permalink: buildPermalink(wsUrl, channelId, m.ts),
    };
  });
}

export async function getChannelDigest(
  token: string,
  digestCfg?: DigestConfig,
): Promise<{ channelId: string; channelName: string; messages: SlackMessage[]; permalink: string }[]> {
  // Always use the per-connector config passed in. Never fall back to the global
  // settings-table key — that leaks one workspace's channel list into another.
  const { channels, msgsPerChannel } = digestCfg ?? { channels: [], msgsPerChannel: 5 };
  const limit    = Math.max(1, Math.min(20, msgsPerChannel));
  const cacheKey = `slack.digest.${token.slice(-8)}`;
  return memo(cacheKey, 60 * 1000, async () => {
    const out = await Promise.all(channels.map(async ch => {
      try {
        const r: any = await slackGet("conversations.history", { channel: ch.id, limit }, token);
        const msgs    = (r.messages || []).filter((m: any) => m.subtype !== "channel_join");
        const formatted = await formatBatch(msgs, ch.id, ch.name, false, token, "");
        return { channelId: ch.id, channelName: ch.name, messages: formatted, permalink: `slack://channel?team=&id=${ch.id}` };
      } catch (err: any) {
        return { channelId: ch.id, channelName: ch.name, messages: [], permalink: "", error: err.message };
      }
    }));
    return out;
  });
}

const URGENT_RE = /\b(urgent|asap|blocker|prod|down|escalat)/i;

export function invalidateMentionsCache() {
  invalidate("slack.mentions");
}

async function processSearchMatches(
  matches: any[],
  me: string,
  cutoff: number,
  token: string,
): Promise<(SlackMessage & { urgent: boolean })[]> {
  const relevant = matches.filter((m: any) => m.user !== me && Number(m.ts) >= cutoff);
  const byChannel = new Map<string, any[]>();
  for (const m of relevant) {
    const cid = m.channel?.id || "unknown";
    if (!byChannel.has(cid)) byChannel.set(cid, []);
    byChannel.get(cid)!.push(m);
  }
  const out: (SlackMessage & { urgent: boolean })[] = [];
  for (const [cid, list] of byChannel) {
    const ch    = list[0]?.channel;
    const isIm  = !!ch?.is_im;
    const isMpim = !!ch?.is_mpim;
    const isDm  = isIm || isMpim;

    let cname: string;
    if (isIm) {
      const senderId = list[0].user || "";
      const nameMap  = senderId ? await resolveUsers([senderId], token) : {};
      cname = nameMap[senderId] || ch?.name || cid;
    } else if (isMpim) {
      cname = (ch?.name || "Group DM").replace(/^mpdm-/, "").replace(/-\d+$/, "").replace(/--/g, ", ");
    } else {
      cname = ch?.name || cid;
    }

    const formatted = await formatBatch(list, cid, cname, isDm, token, me);
    for (let i = 0; i < formatted.length; i++) {
      out.push({
        ...formatted[i],
        permalink: list[i].permalink || formatted[i].permalink,
        urgent: URGENT_RE.test(formatted[i].text),
      });
    }
  }
  return out;
}

export async function getMentions(
  token: string,
  userId: string,
  days = 4,
): Promise<(SlackMessage & { urgent: boolean })[]> {
  const cacheKey = `slack.mentions.${token.slice(-8)}.${days}`;
  return memo(cacheKey, 60 * 1000, async () => {
    const cutoff = (Date.now() / 1000) - days * 86400;
    const after  = new Date(cutoff * 1000).toISOString().slice(0, 10);

    const [dmResult, mentionResult] = await Promise.allSettled([
      slackGet("search.messages", { query: `is:dm after:${after}`, count: 100, sort: "timestamp", sort_dir: "desc" }, token),
      slackGet("search.messages", { query: `<@${userId}> after:${after}`, count: 100, sort: "timestamp", sort_dir: "desc" }, token),
    ]);

    if (dmResult.status === "rejected" && mentionResult.status === "rejected") {
      throw (dmResult as PromiseRejectedResult).reason;
    }

    const dmMatches      = dmResult.status      === "fulfilled" ? (dmResult.value.messages?.matches || [])      : [];
    const mentionMatches = mentionResult.status  === "fulfilled"
      ? (mentionResult.value.messages?.matches || []).filter((m: any) => !m.channel?.is_im && !m.channel?.is_mpim)
      : [];

    const [dms, mentions] = await Promise.all([
      processSearchMatches(dmMatches, userId, cutoff, token),
      processSearchMatches(mentionMatches, userId, cutoff, token),
    ]);

    const seenTs = new Set<string>();
    const all: (SlackMessage & { urgent: boolean })[] = [];
    for (const m of [...dms, ...mentions]) {
      if (!seenTs.has(m.ts)) { seenTs.add(m.ts); all.push(m); }
    }
    all.sort((a, b) => Number(b.ts) - Number(a.ts));
    return all;
  });
}
