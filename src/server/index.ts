import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { createProxyMiddleware } from "http-proxy-middleware";

import { config } from "./config.js";
import { getDb } from "./db.js";
import { HttpError } from "./lib/errors.js";
import { workspaceContext } from "./lib/request-context.js";

import { authRouter } from "./routes/auth.js";
import { calendarRouter } from "./routes/calendar.js";
import { slackRouter } from "./routes/slack.js";
import { ticketsRouter } from "./routes/tickets.js";
import { prsRouter } from "./routes/prs.js";
import { clickupRouter } from "./routes/clickup.js";
import { todosRouter } from "./routes/todos.js";
import { settingsRouter } from "./routes/settings.js";
import { workspacesRouter, identitiesRouter, connectorsRouter } from "./routes/workspaces.js";
import { appSettingsRouter } from "./routes/app-settings.js";
import { getAppSetting } from "./lib/app-settings.js";

import { googleStatus } from "./auth/google.js";
import { slackStatus } from "./auth/slack.js";
import * as jira from "./integrations/jira.js";
import * as github from "./integrations/github.js";
import * as notion from "./integrations/notion.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const log = pino({
  level: config.logLevel,
  transport: config.isDev ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } : undefined,
});

// Init DB up front so any startup errors surface immediately.
getDb();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(workspaceContext);

app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) log.info({ method: req.method, path: req.path }, "req");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    data: {
      ok: true,
      providers: {
        google: googleStatus().connected,
        slack: slackStatus().connected,
        jira: jira.isConfigured(),
        github: github.isConfigured(),
        notion: notion.isConfigured(),
      },
    },
  });
});

app.use("/api/auth", authRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/slack", slackRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/prs", prsRouter);
app.use("/api/clickup", clickupRouter);
app.use("/api/todos", todosRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/workspaces", workspacesRouter);
app.use("/api/identities", identitiesRouter);
app.use("/api/connectors", connectorsRouter);
app.use("/api/app-settings", appSettingsRouter);

// Serve SETUP.md raw so the "not connected" CTA can link to it.
app.get("/SETUP.md", (_req, res) => {
  const p = path.resolve(dirname, "../../docs/SETUP.md");
  if (fs.existsSync(p)) res.type("text/markdown").sendFile(p);
  else res.status(404).send("SETUP.md not found");
});

// Error handler — must come AFTER routes, BEFORE the catch-all frontend.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  log.error({ err: err.message, stack: err.stack }, "unhandled");
  res.status(500).json({ error: err.message || "internal error" });
});

// Frontend: dev = proxy to Vite, prod = static dist
if (config.isDev) {
  app.use(
    createProxyMiddleware({
      target: `http://localhost:${config.vitePort}`,
      changeOrigin: false,
      ws: true,
      pathFilter: (pathname) => !pathname.startsWith("/api/") && pathname !== "/SETUP.md",
    }),
  );
} else {
  const frontendDist = path.resolve(dirname, "../frontend");
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => res.sendFile(path.join(frontendDist, "index.html")));
}

app.listen(config.port, () => {
  const brand = getAppSetting("brand.name", "Daily Command Center");
  log.info(`${brand} → http://localhost:${config.port}`);
  if (config.isDev) log.info(`Vite dev server expected on :${config.vitePort} (proxied)`);
});
