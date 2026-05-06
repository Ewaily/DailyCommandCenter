import { Router } from "express";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { googleAuthUrl, googleHandleCallback, googleStatus } from "../auth/google.js";
import { slackAuthUrl, slackHandleCallback, slackStatus } from "../auth/slack.js";

import { microsoftAuthUrl, microsoftHandleCallback } from "../auth/microsoft.js";
import { createConnectorInstance, getWorkspace, listIdentities } from "../lib/workspace-config.js";

export const authRouter = Router();

const STATE_TTL_MS = 10 * 60 * 1000;

function newState(provider: string, context?: string) {
  const state = crypto.randomBytes(16).toString("hex");
  getDb().prepare(`INSERT INTO oauth_state (state, provider, code_verifier, created_at, context) VALUES (?, ?, NULL, ?, ?)`)
    .run(state, provider, Date.now(), context ?? null);
  return state;
}

function consumeState(state: string, provider: string): { ok: boolean; context?: string } {
  const row = getDb().prepare(`SELECT * FROM oauth_state WHERE state=? AND provider=?`).get(state, provider) as any;
  if (!row) return { ok: false };
  getDb().prepare(`DELETE FROM oauth_state WHERE state=?`).run(state);
  if (Date.now() - row.created_at >= STATE_TTL_MS) return { ok: false };
  return { ok: true, context: row.context ?? undefined };
}

authRouter.get("/:provider/start", (req, res) => {
  const { provider } = req.params;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const addAnother  = req.query.addAnother === "1";
  const ctxObj: Record<string, unknown> = {};
  if (workspaceId) ctxObj.workspaceId = workspaceId;
  if (addAnother)  ctxObj.addAnother  = true;
  const context = Object.keys(ctxObj).length ? JSON.stringify(ctxObj) : undefined;
  const state = newState(provider, context);
  if (provider === "google")    return res.redirect(googleAuthUrl(state));
  if (provider === "slack")     return res.redirect(slackAuthUrl(state));
  if (provider === "microsoft") return res.redirect(microsoftAuthUrl(state));
  res.status(404).json({ error: `unknown provider: ${provider}` });
});

authRouter.get("/:provider/callback", async (req, res) => {
  const { provider } = req.params;
  const { code, state, error } = req.query as Record<string, string>;
  if (error) return res.status(400).send(`OAuth error: ${error}`);
  const stateResult = code && state ? consumeState(state, provider) : { ok: false };
  if (!stateResult.ok) return res.status(400).send("Invalid OAuth callback (state mismatch or expired).");

  try {
    const ctx = stateResult.context ? JSON.parse(stateResult.context) : {};
    const workspaceId: string | null = ctx.workspaceId ?? null;
    const addAnother: boolean = !!ctx.addAnother;

    if (provider === "google") {
      await googleHandleCallback(code, workspaceId, { addAnother });
    } else if (provider === "slack") {
      await slackHandleCallback(code, workspaceId, { addAnother });
    } else if (provider === "microsoft") {
      if (!workspaceId || !getWorkspace(workspaceId)) {
        return res.status(400).send("Microsoft OAuth requires a valid workspaceId in the start request.");
      }

      const { identityId } = await microsoftHandleCallback(code, workspaceId);

      // Create a connector_instance linking this workspace to the new Outlook identity.
      createConnectorInstance({
        workspaceId,
        type: "outlook",
        identityId,
        config: {},
        enabled: true,
      });
    } else {
      return res.status(404).send(`unknown provider: ${provider}`);
    }

    res.send(`<!doctype html><meta charset=utf-8><title>Connected</title>
      <body style="font-family:system-ui;padding:40px;text-align:center;">
      <h1>✓ ${provider} connected</h1>
      <p>You can close this tab. <a href="/">Back to dashboard</a>.</p>
      <script>setTimeout(()=>{ if(window.opener){ window.opener.postMessage({type:'oauth-done',provider:'${provider}'},'*'); window.close(); } else { window.location='/'; }}, 800);</script>`);
  } catch (e: any) {
    res.status(500).send(`Auth failed: ${e.message}`);
  }
});

authRouter.get("/:provider/status", (req, res) => {
  const { provider } = req.params;
  if (provider === "google")    return res.json({ data: googleStatus() });
  if (provider === "slack")     return res.json({ data: slackStatus() });
  // Microsoft is per-identity; any connected identity means "connected"
  if (provider === "microsoft") {
    const ids = listIdentities("outlook");
    return res.json({ data: { connected: ids.length > 0, account: ids[0]?.account } });
  }
  res.status(404).json({ error: `unknown provider: ${provider}` });
});
