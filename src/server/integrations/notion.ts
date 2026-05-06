// TODO: implement Notion deadlines (PROJECT_BRIEF.md §3.10).
// For each NOTION_DATABASE_IDS DB id: POST /v1/databases/<id>/query with a
// filter for next 7 days on the date property.
import { config } from "../config.js";
import { getNotionConfig } from "../lib/workspace-config.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";

function effective(workspaceId?: string) {
  const wsId = workspaceId ?? getActiveWorkspaceId();
  const db = getNotionConfig(wsId);
  if (db) return db;
  return { token: config.notion.token, databaseIds: config.notion.databaseIds };
}

export function isConfigured(workspaceId?: string) {
  const e = effective(workspaceId);
  return !!(e.token && e.databaseIds.length);
}
export async function listDeadlines(_days = 7) { return []; }
