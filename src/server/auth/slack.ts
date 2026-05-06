import { config } from "../config.js";
import { getDb } from "../db.js";
import { getAppSetting } from "../lib/app-settings.js";
import { NotConnectedError } from "../lib/errors.js";
import {
  createIdentity,
  updateIdentity,
  getIdentity,
  listIdentities,
  listConnectorInstances,
  createConnectorInstance,
  getWorkspace,
} from "../lib/workspace-config.js";

function slackCreds() {
  return {
    clientId:     getAppSetting("slack.clientId",     config.slack.clientId),
    clientSecret: getAppSetting("slack.clientSecret", config.slack.clientSecret),
    redirectUri:  getAppSetting("slack.redirectUri",  config.slack.redirectUri),
  };
}

export function slackAuthUrl(state: string): string {
  const { clientId, redirectUri } = slackCreds();
  const params = new URLSearchParams({
    client_id:  clientId,
    user_scope: config.slack.userScopes.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

/**
 * OAuth callback — creates or updates a slack identity, then wires it to the
 * workspace's slack connector.  When workspaceId is null the token is written
 * to the legacy tokens table so the universal connector keeps working.
 */
export async function slackHandleCallback(code: string, workspaceId: string | null, opts: { addAnother?: boolean } = {}) {
  const { clientId, clientSecret, redirectUri } = slackCreds();
  const params = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    code,
    redirect_uri:  redirectUri,
  });
  const res  = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`slack oauth: ${json.error}`);

  const userToken = json.authed_user?.access_token || "";
  const userId    = json.authed_user?.id            || "";
  if (!userToken) throw new Error("slack oauth: missing user token");

  if (workspaceId && getWorkspace(workspaceId)) {
    const reuseExisting = !opts.addAnother
      ? listIdentities("slack").filter(i => i.account === userId && userId)
      : [];
    let identityId: string;

    if (reuseExisting.length) {
      identityId = reuseExisting[0].id;
      updateIdentity(identityId, { accessToken: userToken });
    } else {
      const id = createIdentity({
        type:         "slack",
        label:        userId ? `Slack · ${userId}` : "Slack",
        account:      userId,
        accessToken:  userToken,
        scope:        json.authed_user?.scope || null,
        displayColor: "#4A154B",
      });
      identityId = id.id;
    }

    // addAnother → always create a new slack connector so the workspace can hold
    // multiple Slack accounts. Otherwise reuse this workspace's existing slack slot.
    const connectors = listConnectorInstances(workspaceId);
    const slackCi    = opts.addAnother ? undefined : connectors.find(c => c.type === "slack");
    if (slackCi) {
      getDb()
        .prepare(`UPDATE connector_instances SET identity_id=? WHERE id=?`)
        .run(identityId, slackCi.id);
    } else {
      createConnectorInstance({
        workspaceId,
        type:      "slack",
        identityId,
        config:    { userId, digestChannels: [] },
        enabled:   true,
      });
    }
  } else {
    // Legacy global path.
    getDb().prepare(`
      INSERT INTO tokens (provider, access_token, refresh_token, expires_at, account, scope, raw_json, updated_at)
      VALUES ('slack', @access, NULL, NULL, @account, @scope, @raw, @ts)
      ON CONFLICT(provider) DO UPDATE SET
        access_token=excluded.access_token,
        account=excluded.account,
        scope=excluded.scope,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at
    `).run({
      access:  userToken,
      account: userId,
      scope:   json.authed_user?.scope || "",
      raw:     JSON.stringify(json),
      ts:      Date.now(),
    });
  }
}

/**
 * Returns the Slack user token for the given identity.
 * Falls back to tokens table then env var so legacy setups keep working.
 */
export function getSlackToken(identityId: string | null): string {
  if (identityId) {
    const identity = getIdentity(identityId);
    if (identity?.accessToken) return identity.accessToken;
  }
  const row = getDb().prepare(`SELECT access_token FROM tokens WHERE provider='slack'`).get() as any;
  if (row?.access_token) return row.access_token;
  if (config.slack.userToken) return config.slack.userToken;
  throw new NotConnectedError("slack");
}

/**
 * Returns the Slack userId for the given identity.
 * Falls back to the hard-coded env config so legacy connectors keep working.
 */
export function getSlackUserId(identityId: string | null): string {
  if (identityId) {
    const identity = getIdentity(identityId);
    if (identity?.account) return identity.account;
  }
  const row = getDb().prepare(`SELECT account FROM tokens WHERE provider='slack'`).get() as any;
  if (row?.account) return row.account;
  return config.slack.userId;
}

export function slackStatus(): { connected: boolean; account?: string } {
  const ids = listIdentities("slack");
  if (ids.length) return { connected: true, account: ids[0].account ?? undefined };
  const row = getDb().prepare(`SELECT account FROM tokens WHERE provider='slack'`).get() as any;
  if (row) return { connected: true, account: row.account || undefined };
  if (config.slack.userToken) return { connected: true, account: config.slack.userId };
  return { connected: false };
}
