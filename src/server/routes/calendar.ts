import { Router } from "express";
import { listCalendarEvents, type CalendarConfig } from "../integrations/google-calendar.js";
import { listOutlookCalendarEvents } from "../integrations/outlook-calendar.js";
import { getActiveWorkspaceId } from "../lib/request-context.js";
import { listConnectorsForWorkspace, listConnectorsForOverview, getIdentity } from "../lib/workspace-config.js";

export const calendarRouter = Router();

calendarRouter.get("/events", async (req, res, next) => {
  try {
    const start = (req.query.start as string) || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const end   = (req.query.end   as string) || new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

    const explicitWs = getActiveWorkspaceId();
    // Overview (no workspace) → connectors marked "Show in Overview".
    // Workspace → owned + opted-in shared.
    const rawAll = explicitWs
      ? listConnectorsForWorkspace(explicitWs)
      : listConnectorsForOverview();
    const scopeId = typeof req.query.connectorId === "string" ? req.query.connectorId : null;
    const all = scopeId ? rawAll.filter(c => c.id === scopeId) : rawAll;

    const hasAnyCalendar = all.some(c => c.enabled && (c.type === "gcal" || c.type === "outlook") && c.identityId);
    if (!hasAnyCalendar) {
      return res.json({ data: [], notConfigured: true });
    }

    const promises: Promise<any[]>[] = [];

    for (const c of all) {
      if (!c.enabled) continue;

      if (c.type === "gcal") {
        const cfg      = c.config as { calendarId?: string; color?: string };
        const identity = c.identityId ? getIdentity(c.identityId) : null;
        const calConfig: CalendarConfig = {
          calendarId: cfg.calendarId || "primary",
          color:      cfg.color || identity?.displayColor || null,
          label:      identity?.label || identity?.account || null,
        };
        promises.push(listCalendarEvents(c.identityId, calConfig, start, end).catch(() => []));
      }

      if (c.type === "outlook" && c.identityId) {
        promises.push(listOutlookCalendarEvents(c.identityId, start, end).catch(() => []));
      }
    }

    const merged = (await Promise.all(promises))
      .flat()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    res.json({ data: merged, fresh_at: Date.now() });
  } catch (e) { next(e); }
});
