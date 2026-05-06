// Request-scoped context — currently just the active workspace.
// Routes set the workspace from `?workspace=<id>` (Step 5 of the migration);
// integrations' `effective()` helpers read from here when callers don't pass
// an explicit workspaceId.

import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

type Ctx = { workspaceId?: string };
const als = new AsyncLocalStorage<Ctx>();

export function getActiveWorkspaceId(): string | undefined {
  return als.getStore()?.workspaceId;
}

export const workspaceContext: RequestHandler = (req, _res, next) => {
  const ws = typeof req.query.workspace === "string" && req.query.workspace.length
    ? req.query.workspace
    : undefined;
  als.run({ workspaceId: ws }, () => next());
};
