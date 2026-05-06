import { Router } from "express";
import * as notion from "../integrations/notion.js";
import * as jira from "../integrations/jira.js";

export const deadlinesRouter = Router();

deadlinesRouter.get("/", async (req, res, next) => {
  const days = Math.max(1, Math.min(60, Number(req.query.days || 7)));
  if (!notion.isConfigured() && !jira.isConfigured()) {
    return res.json({ data: [], notConfigured: true });
  }
  try {
    const results = await Promise.allSettled([
      jira.listDeadlines(days),
      notion.listDeadlines(days),
    ]);
    const data = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    data.sort((x: any, y: any) => x.daysUntilDue - y.daysUntilDue);
    res.json({ data });
  } catch (e) { next(e); }
});
