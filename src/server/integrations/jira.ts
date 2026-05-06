import { config } from "../config.js";
import { memo } from "../lib/cache.js";
import { getJiraConfig, type WatchedUser } from "../lib/workspace-config.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";

export type JiraCreds = { baseUrl: string; email: string; apiToken: string };
export type { WatchedUser };

// "mine" is always available; everything else comes from the connector's watchedUsers config.
export const MINE_BUCKET_ID = "mine";

function effective(workspaceId?: string): JiraCreds {
  const explicit = workspaceId ?? getActiveWorkspaceId();
  if (explicit) {
    const db = getJiraConfig(explicit);
    return db
      ? { baseUrl: db.baseUrl, email: db.email, apiToken: db.token }
      : { baseUrl: "", email: "", apiToken: "" };
  }
  const db = getJiraConfig();
  if (db) return { baseUrl: db.baseUrl, email: db.email, apiToken: db.token };
  return { baseUrl: config.jira.baseUrl, email: config.jira.email, apiToken: config.jira.apiToken };
}

export function isConfigured(workspaceId?: string) {
  const e = effective(workspaceId);
  return !!(e.baseUrl && e.email && e.apiToken);
}

function authHeader(creds: JiraCreds) {
  return "Basic " + Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");
}

async function jiraGet<T = any>(creds: JiraCreds, path: string): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    headers: { Authorization: authHeader(creds), Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`jira GET ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function jiraPost<T = any>(creds: JiraCreds, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`jira POST ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Resolve a display name → accountId. Cached per baseUrl so different Jira
// instances don't share the same name→id mapping.
const accountIdCache = new Map<string, string | null>();
async function getAccountId(creds: JiraCreds, displayName: string): Promise<string | null> {
  const key = `${creds.baseUrl}::${displayName}`;
  if (accountIdCache.has(key)) return accountIdCache.get(key)!;
  try {
    const users: any[] = await jiraGet(creds, `/rest/api/3/user/search?query=${encodeURIComponent(displayName)}`);
    const exact = users.find(u => u.displayName === displayName) || users[0] || null;
    accountIdCache.set(key, exact?.accountId ?? null);
    return exact?.accountId ?? null;
  } catch {
    accountIdCache.set(key, null);
    return null;
  }
}

const PRIORITY_MAP: Record<string, "urgent" | "high" | "medium" | "low" | null> = {
  Highest: "urgent", High: "high", Medium: "medium", Low: "low", Lowest: "low",
};

function bucketFromStatus(name: string, category: string) {
  if (/blocked|impediment/i.test(name)) return "blocked" as const;
  if (/review|qa|verify/i.test(name)) return "in_review" as const;
  if (/clarification/i.test(name)) return "in_review" as const;
  if (category === "indeterminate") return "in_progress" as const;
  if (category === "done") return "done" as const;
  return "todo" as const;
}

// Jira `statusCategory.colorName` is a CSS-ish keyword ("yellow", "blue-gray",
// "green", "medium-gray"). Map to a hex so the renderer can tint the status
// chip the same way ClickUp does with task.status.color.
const STATUS_CATEGORY_COLOR: Record<string, string> = {
  "blue-gray":   "#4C9AFF",
  "yellow":      "#FFAB00",
  "green":       "#36B37E",
  "brown":       "#998DD9",
  "warm-red":    "#FF5630",
  "medium-gray": "#6B778C",
};

function normalize(creds: JiraCreds, i: any) {
  const f = i.fields || {};
  const a = f.assignee;
  const assignee = a
    ? {
        name: a.displayName || a.emailAddress || "Unassigned",
        avatar: a.avatarUrls?.["48x48"] || a.avatarUrls?.["32x32"] || a.avatarUrls?.["24x24"] || null,
        accountId: a.accountId || null,
      }
    : null;
  const statusColor = STATUS_CATEGORY_COLOR[f.status?.statusCategory?.colorName] || null;
  return {
    source: "jira" as const,
    id: i.id,
    key: i.key,
    title: f.summary || "(untitled)",
    status: f.status?.name || "Unknown",
    statusBucket: bucketFromStatus(f.status?.name || "", f.status?.statusCategory?.key || ""),
    statusColor,
    priority: PRIORITY_MAP[f.priority?.name] ?? null,
    assignee,
    project: f.project?.name ?? null,
    projectKey: f.project?.key ?? null,
    url: `${creds.baseUrl}/browse/${i.key}`,
    dueDate: f.duedate || null,
    updatedAt: f.updated || "",
  };
}

async function searchIssues(creds: JiraCreds, jql: string, max = 50) {
  const data: any = await jiraPost(creds, `/rest/api/3/search/jql`, {
    jql,
    fields: ["summary", "status", "priority", "assignee", "duedate", "project", "updated"],
    maxResults: max,
  });
  return (data.issues || []).map((i: any) => normalize(creds, i));
}

// Pages through all results — Jira Cloud caps each request at 100.
async function searchAllIssues(creds: JiraCreds, jql: string) {
  const PAGE = 100;
  const fields = ["summary", "status", "priority", "assignee", "duedate", "project", "updated"];
  const all: any[] = [];
  let startAt = 0;
  while (true) {
    const data: any = await jiraPost(creds, `/rest/api/3/search/jql`, { jql, fields, maxResults: PAGE, startAt });
    const page: any[] = data.issues || [];
    all.push(...page.map((i: any) => normalize(creds, i)));
    if (all.length >= (data.total ?? 0) || page.length < PAGE) break;
    startAt += page.length;
  }
  return all;
}

// "mine" is computed from JQL currentUser(). Any other bucket is a WatchedUser
// defined per-connector in Settings — arbitrary count, arbitrary labels.
function escapeJql(s: string): string { return s.replace(/"/g, '\\"'); }

async function jqlForWatchedUser(creds: JiraCreds, w: WatchedUser): Promise<string | null> {
  // Treat the query as accountId if it looks like one (no spaces, has colon or is hex-ish).
  // Otherwise resolve as display name → accountId. Email queries also work via the search endpoint.
  let id: string | null = w.query;
  const looksLikeId = !/\s/.test(w.query) && (w.query.includes(":") || w.query.length >= 20);
  if (!looksLikeId) {
    id = await getAccountId(creds, w.query);
    if (!id) return null;
  }
  const safeId = escapeJql(id);
  if (w.status && w.status.trim()) {
    const safeStatus = escapeJql(w.status.trim());
    return `assignee = "${safeId}" AND status = "${safeStatus}" ORDER BY updated DESC`;
  }
  // hideClosed defaults to true (hide closed unless explicitly set to false)
  const hideClosedFilter = w.hideClosed !== false ? ` AND statusCategory != Done` : "";
  return `assignee = "${safeId}"${hideClosedFilter} ORDER BY updated DESC`;
}

const MINE_JQL = `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;

export async function listMineWith(creds: JiraCreds) {
  if (!creds.baseUrl || !creds.email || !creds.apiToken) return [];
  return memo(`jira.bucket.${creds.baseUrl}.${creds.email}.mine`, 60_000, () => searchIssues(creds, MINE_JQL));
}

export async function listWatchedUserWith(creds: JiraCreds, watched: WatchedUser) {
  if (!creds.baseUrl || !creds.email || !creds.apiToken) return [];
  const hideKey = watched.hideClosed !== false ? "1" : "0";
  return memo(`jira.bucket.${creds.baseUrl}.${creds.email}.${watched.id}.${watched.query}.${watched.status || ""}.${hideKey}`, 60_000, async () => {
    const jql = await jqlForWatchedUser(creds, watched);
    if (!jql) return [];
    return searchIssues(creds, jql);
  });
}

// Back-compat alias used by the deadlines aggregator.
export const listMyIssues = () => listMineWith(effective());

/**
 * Team Board: open issues in the project of the user's most-recently-updated assigned ticket.
 */
export async function listTeamIssues(project?: string) {
  const creds = effective();
  if (!isConfigured()) return [];
  return listTeamIssuesWith(creds, project);
}

export async function listTeamIssuesWith(creds: JiraCreds, project?: string) {
  if (!creds.baseUrl || !creds.email || !creds.apiToken) return [];
  return memo(`jira.team.${creds.baseUrl}.${project || "auto"}`, 60_000, async () => {
    let projectKey = project;
    if (!projectKey) {
      const recent = await searchIssues(creds, `assignee = currentUser() ORDER BY updated DESC`, 1);
      projectKey = recent[0]?.key?.split("-")[0];
    }
    if (!projectKey) return [];
    const jql = `project = "${projectKey}" AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    return searchIssues(creds, jql, 30);
  });
}

/** Issues with a due date in the next `days` days, assigned to Ewaily. */
export async function listDeadlines(days = 7) {
  const creds = effective();
  if (!isConfigured()) return [];
  return memo(`jira.deadlines.${creds.baseUrl}.${days}`, 60_000, async () => {
    const today = new Date();
    const jql = `assignee = currentUser() AND duedate >= now() AND duedate <= "${days}d" AND statusCategory != Done ORDER BY duedate ASC`;
    const issues = await searchIssues(creds, jql);
    return issues
      .filter((i: any) => i.dueDate)
      .map((i: any) => {
        const d = Math.round((new Date(i.dueDate).getTime() - today.getTime()) / 86400_000);
        const rel = d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
        return {
          id: i.id,
          title: `${i.key} — ${i.title}`,
          source: "Jira",
          url: i.url,
          dueDate: i.dueDate,
          dueRelative: rel,
          daysUntilDue: d,
        };
      });
  });
}
