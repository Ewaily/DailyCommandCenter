// ClickUp integration. Currently exposes a token-pinging health check and a
// minimal "list my tasks" call so the connector can prove it works once added
// from Settings → Workspaces. Wider data fetching (deadlines, board sync)
// can hang off the same effective() helper later.
import { config } from "../config.js";
import { memo } from "../lib/cache.js";
import { getClickUpConfig, type WatchedUser } from "../lib/workspace-config.js";
export type { WatchedUser };
import { getActiveWorkspaceId } from "../lib/request-context.js";

export const MINE_BUCKET_ID = "mine";

export type ClickUpCreds = { token: string; teamId: string; spaceIds: string[] };

const API = "https://api.clickup.com/api/v2";

function effective(workspaceId?: string): ClickUpCreds {
  const wsId = workspaceId ?? getActiveWorkspaceId();
  const db = wsId ? getClickUpConfig(wsId) : getClickUpConfig();
  if (db) return db;
  return {
    token: config.clickup.token,
    teamId: config.clickup.teamId,
    spaceIds: config.clickup.spaceIds,
  };
}

export function isConfigured(workspaceId?: string) {
  const e = effective(workspaceId);
  return !!(e.token && e.teamId);
}

async function clickUpGet<T = any>(creds: ClickUpCreds, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: creds.token, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`clickup GET ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Returns the authenticated user — used to verify the token works. */
export async function whoAmI(workspaceId?: string) {
  const creds = effective(workspaceId);
  if (!creds.token) return null;
  const data = await clickUpGet<{ user: { id: number; username: string; email: string } }>(creds, "/user");
  return data.user;
}

// Pages through all results — ClickUp returns at most 100 tasks per page.
async function fetchAllTasks(creds: ClickUpCreds, baseParams: Record<string, string>) {
  const all: any[] = [];
  let page = 0;
  while (true) {
    const qs = new URLSearchParams({ ...baseParams, page: String(page) });
    const data = await clickUpGet<{ tasks: any[] }>(creds, `/team/${creds.teamId}/task?${qs.toString()}`);
    const tasks: any[] = data.tasks || [];
    all.push(...tasks);
    if (tasks.length < 100) break;
    page++;
  }
  return all;
}

/** Lists open tasks assigned to the authenticated user across the configured team. */
export async function listMyTasks(workspaceId?: string) {
  const creds = effective(workspaceId);
  if (!isConfigured(workspaceId)) return [];
  return memo(`clickup.mine.${creds.teamId}`, 60_000, async () => {
    const me = await whoAmI(workspaceId);
    if (!me) return [];
    const tasks = await fetchAllTasks(creds, { "assignees[]": String(me.id), include_closed: "false" });
    return tasks.map(normalize);
  });
}

export function getWatchedUsers(workspaceId?: string): WatchedUser[] {
  const wsId = workspaceId ?? getActiveWorkspaceId();
  const db = wsId ? getClickUpConfig(wsId) : getClickUpConfig();
  return db?.watchedUsers ?? [];
}

type ClickUpMember = { user: { id: number; email: string | null; username: string | null } };

async function fetchTeamMembers(creds: ClickUpCreds): Promise<ClickUpMember[]> {
  return memo(`clickup.members.${creds.teamId}`, 300_000, async () => {
    // ClickUp v2 has no /team/{id}/member endpoint. Members are nested inside
    // GET /team — we pick the matching team and read team.members.
    const data = await clickUpGet<{ teams: { id: string | number; members: ClickUpMember[] }[] }>(creds, `/team`);
    const team = (data.teams || []).find(t => String(t.id) === String(creds.teamId));
    return team?.members ?? [];
  });
}

async function resolveMemberId(creds: ClickUpCreds, query: string): Promise<number | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  // Numeric → treat as a ClickUp user id directly. Lets watchers reference
  // members who aren't returned by GET /team (e.g. guests on specific lists).
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const members = await fetchTeamMembers(creds);
  const q = trimmed.toLowerCase();
  const match = members.find(m => {
    const email = m.user.email?.toLowerCase() ?? "";
    const username = m.user.username?.toLowerCase() ?? "";
    return email === q || (username && username.includes(q));
  });
  return match?.user.id ?? null;
}

export async function listWatchedMemberTasks(watched: WatchedUser, workspaceId?: string) {
  const creds = effective(workspaceId);
  if (!isConfigured(workspaceId)) return [];
  const memberId = await resolveMemberId(creds, watched.query);
  if (!memberId) return [];
  // include_closed=false excludes "closed" (archived) tasks, but ClickUp also has
  // status.type === "done" for finished tasks that aren't yet archived — fetch both
  // variants and post-filter so hideClosed works correctly.
  const includeClosed = watched.hideClosed === false ? "true" : "false";
  const hideKey = watched.hideClosed !== false ? "1" : "0";
  return memo(`clickup.watched.${creds.teamId}.${memberId}.${includeClosed}.${hideKey}`, 60_000, async () => {
    const raw = await fetchAllTasks(creds, { "assignees[]": String(memberId), include_closed: includeClosed });
    const tasks = raw.map(normalizeFull);
    if (watched.hideClosed !== false) {
      return tasks.filter(t => !isDoneOrClosed(t.statusType)).map(stripStatusType);
    }
    return tasks.map(stripStatusType);
  });
}

// ClickUp status.type values: "open" | "custom" | "done" | "closed"
// "done" = finished but still visible; "closed" = archived.
// include_closed=false only suppresses "closed" — "done" tasks still come back.
function isDoneOrClosed(type: string) {
  return type === "done" || type === "closed";
}

// ClickUp priority comes back as { id, priority: "urgent"|"high"|"normal"|"low", color }
// — normalize to the same enum the Jira renderer uses so badges share styling.
function mapPriority(p: any): "urgent" | "high" | "medium" | "low" | null {
  const name = (p?.priority || "").toLowerCase();
  if (name === "urgent") return "urgent";
  if (name === "high")   return "high";
  if (name === "normal" || name === "medium") return "medium";
  if (name === "low")    return "low";
  return null;
}

function statusBucketFromType(type: string): "todo" | "in_progress" | "in_review" | "done" {
  if (type === "done" || type === "closed") return "done";
  if (type === "custom") return "in_progress";
  return "todo";
}

function normalizeFull(t: any) {
  const assignees: { id: number; name: string; color: string | null; avatar: string | null }[] = Array.isArray(t.assignees)
    ? t.assignees.map((a: any) => ({
        id: a.id,
        name: a.username || a.email || `User ${a.id}`,
        color: a.color || null,
        avatar: a.profilePicture || null,
      }))
    : [];
  return {
    source: "clickup" as const,
    id: t.id,
    customId: t.custom_id || null,
    title: t.name || "(untitled)",
    status: t.status?.status || "Unknown",
    statusType: (t.status?.type || "open") as string,
    statusColor: t.status?.color || null,
    statusBucket: statusBucketFromType(t.status?.type || "open"),
    priority: mapPriority(t.priority),
    assignees,
    list: t.list?.name || null,
    url: t.url,
    dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
    updatedAt: t.date_updated ? new Date(Number(t.date_updated)).toISOString() : "",
  };
}

function stripStatusType(t: ReturnType<typeof normalizeFull>) {
  const { statusType: _st, ...rest } = t;
  return rest;
}

function normalize(t: any) { return stripStatusType(normalizeFull(t)); }
