import { config } from "../config.js";
import { memo } from "../lib/cache.js";
import { getGithubConfig } from "../lib/workspace-config.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";

const API = "https://api.github.com";

// DB-first, .env fallback. Re-resolved per call so a Settings UI edit is picked up
// on the very next request without a server restart. workspaceId resolution order:
// explicit arg → request-scoped active workspace → default workspace.
function effective(workspaceId?: string) {
  const explicit = workspaceId ?? getActiveWorkspaceId();
  if (explicit) {
    // User has drilled into a specific workspace — never fall back to .env.
    return getGithubConfig(explicit) ?? { token: "", username: "", repo: "" };
  }
  const db = getGithubConfig();
  if (db) return db;
  return { token: config.github.token, username: config.github.username, repo: config.github.repo };
}

export function isConfigured(workspaceId?: string) {
  const e = effective(workspaceId);
  return !!(e.token && e.username);
}

async function gh<T = any>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DailyCommandCenter",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

function ageHuman(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  const days = Math.round(sec / 86400);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

type GhSearchItem = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  user: { login: string } | null;
  repository_url: string;
  pull_request?: { merged_at: string | null; html_url: string };
};

function normalize(item: GhSearchItem, kind: PrBucket) {
  const repo = item.repository_url?.replace("https://api.github.com/repos/", "") || "";
  const merged = !!item.pull_request?.merged_at;
  let status: string;
  let waitingOnYou = false;
  if (kind === "review") {
    status = "Review needed";
    waitingOnYou = true;
  } else if (kind === "closed") {
    status = merged ? "Merged" : "Closed";
  } else {
    // mine / all: show draft vs open state
    status = item.draft ? "Draft" : "Open";
  }
  return {
    id: String(item.id),
    number: item.number,
    title: item.title,
    repo,
    url: item.html_url,
    ageHuman: ageHuman(kind === "closed" ? (item.closed_at || item.updated_at) : item.created_at),
    status,
    waitingOnYou,
    author: item.user?.login || "",
    merged,
    state: item.state,
  };
}

export type PrBucket = "review" | "mine" | "all" | "closed";

function queryFor(bucket: PrBucket, repo: string, me: string): string {
  const repoQ = `repo:${repo}`;
  if (bucket === "review") return `${repoQ} is:pr is:open review-requested:${me}`;
  if (bucket === "mine")   return `${repoQ} is:pr is:open author:${me}`;
  if (bucket === "all")    return `${repoQ} is:pr is:open`;
  return `${repoQ} is:pr is:closed`;
}

export async function listBucket(bucket: PrBucket, workspaceId?: string) {
  const e = effective(workspaceId);
  if (!e.token || !e.username || !e.repo) return [];
  return listBucketWith(e, bucket);
}

/** Fetch one bucket for explicit credentials. Used by the fan-out route. */
export async function listBucketWith(
  creds: { token: string; username: string; repo: string },
  bucket: PrBucket,
): Promise<ReturnType<typeof normalize>[]> {
  if (!creds.token || !creds.username || !creds.repo) return [];
  return memo(`github.${creds.repo}.${creds.username}.${bucket}`, 60_000, async () => {
    const q = queryFor(bucket, creds.repo, creds.username);
    const sort = bucket === "closed" ? "&sort=updated&order=desc" : "&sort=created&order=desc";
    const data = await gh<{ items: GhSearchItem[] }>(creds.token, `/search/issues?q=${encodeURIComponent(q)}${sort}&per_page=30`);
    return (data.items || []).map(it => normalize(it, bucket));
  });
}

// Back-compat for the existing /api/prs/queue route — returns review queue.
export const listReviewQueue = () => listBucket("review");
