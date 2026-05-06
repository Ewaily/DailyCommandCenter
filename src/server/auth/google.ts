import { google } from "googleapis";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { NotConnectedError } from "../lib/errors.js";
import { getAppSetting } from "../lib/app-settings.js";
import {
  createIdentity,
  updateIdentity,
  getIdentity,
  listIdentities,
  listConnectorInstances,
  createConnectorInstance,
  getWorkspace,
} from "../lib/workspace-config.js";

function googleCreds() {
  return {
    clientId:     getAppSetting("google.clientId",     config.google.clientId),
    clientSecret: getAppSetting("google.clientSecret", config.google.clientSecret),
    redirectUri:  getAppSetting("google.redirectUri",  config.google.redirectUri),
  };
}

export function googleOauthClient() {
  const { clientId, clientSecret, redirectUri } = googleCreds();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function googleAuthUrl(state: string): string {
  return googleOauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: config.google.scopes,
    state,
  });
}

/**
 * Returns an authenticated OAuth2Client for the given identity.
 * Falls back to the legacy `tokens` table when identityId is null
 * so existing connectors keep working until they are re-authed.
 */
export async function getGoogleAuth(identityId: string | null) {
  const oauth = googleOauthClient();

  if (identityId) {
    const identity = getIdentity(identityId);
    if (!identity?.accessToken) throw new NotConnectedError("google");

    oauth.setCredentials({
      access_token:  identity.accessToken,
      refresh_token: identity.refreshToken ?? undefined,
      expiry_date:   identity.expiresAt ?? undefined,
    });

    oauth.on("tokens", (tk) => {
      updateIdentity(identityId, {
        ...(tk.access_token  ? { accessToken:  tk.access_token }  : {}),
        ...(tk.refresh_token ? { refreshToken: tk.refresh_token } : {}),
        ...(tk.expiry_date   ? { expiresAt:    tk.expiry_date }   : {}),
      });
    });
  } else {
    // Legacy fallback — tokens table (single-account era).
    const row = getDb().prepare(`SELECT * FROM tokens WHERE provider='google'`).get() as any;
    if (!row) throw new NotConnectedError("google");

    oauth.setCredentials({
      access_token:  row.access_token,
      refresh_token: row.refresh_token,
      expiry_date:   row.expires_at,
    });

    oauth.on("tokens", (tk) => {
      getDb().prepare(
        `UPDATE tokens SET access_token=COALESCE(?,access_token),
                          refresh_token=COALESCE(?,refresh_token),
                          expires_at=COALESCE(?,expires_at),
                          updated_at=?
         WHERE provider='google'`,
      ).run(tk.access_token ?? null, tk.refresh_token ?? null, tk.expiry_date ?? null, Date.now());
    });
  }

  return oauth;
}

/**
 * OAuth callback — creates or updates a google identity, then wires it to the
 * workspace's gcal connector (creating the connector if it doesn't exist yet).
 */
export async function googleHandleCallback(code: string, workspaceId: string | null, opts: { addAnother?: boolean } = {}) {
  const oauth = googleOauthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);

  let account = "";
  try {
    const userinfo = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
    account = userinfo.data.email || "";
  } catch { /* userinfo scope may not be granted */ }

  if (workspaceId && getWorkspace(workspaceId)) {
    // Per-workspace identity path.
    // addAnother (or different account) → always create a fresh identity + connector
    // so a workspace can hold multiple Google accounts side by side.
    const reuseExisting = !opts.addAnother
      ? listIdentities("google").filter(i => i.account === account && account)
      : [];
    let identityId: string;

    if (reuseExisting.length) {
      identityId = reuseExisting[0].id;
      updateIdentity(identityId, {
        accessToken:  tokens.access_token ?? "",
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expiry_date   ? { expiresAt:    tokens.expiry_date }   : {}),
      });
    } else {
      const id = createIdentity({
        type:         "google",
        label:        account ? `Google · ${account}` : "Google Calendar",
        account,
        accessToken:  tokens.access_token ?? "",
        refreshToken: tokens.refresh_token ?? null,
        expiresAt:    tokens.expiry_date ?? null,
        scope:        tokens.scope ?? null,
        displayColor: "#4285F4",
      });
      identityId = id.id;
    }

    // When the user asked to add another account, always create a brand-new gcal
    // connector. Otherwise reuse this workspace's first unlinked/linked gcal slot
    // (or create one if absent) — matches legacy single-account behavior.
    const connectors = listConnectorInstances(workspaceId);
    const gcalCi = opts.addAnother ? undefined : connectors.find(c => c.type === "gcal");
    if (gcalCi) {
      getDb()
        .prepare(`UPDATE connector_instances SET identity_id=? WHERE id=?`)
        .run(identityId, gcalCi.id);
    } else {
      createConnectorInstance({
        workspaceId,
        type:       "gcal",
        identityId,
        config:     { calendarId: "primary", color: "#4285F4" },
        enabled:    true,
      });
    }
  } else {
    // Legacy global path — update tokens table so existing behaviour is preserved.
    getDb().prepare(`
      INSERT INTO tokens (provider, access_token, refresh_token, expires_at, account, scope, raw_json, updated_at)
      VALUES ('google', @access, @refresh, @exp, @account, @scope, @raw, @ts)
      ON CONFLICT(provider) DO UPDATE SET
        access_token=excluded.access_token,
        refresh_token=COALESCE(excluded.refresh_token, tokens.refresh_token),
        expires_at=excluded.expires_at,
        account=COALESCE(excluded.account, tokens.account),
        scope=excluded.scope,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at
    `).run({
      access:  tokens.access_token || "",
      refresh: tokens.refresh_token || null,
      exp:     tokens.expiry_date || null,
      account,
      scope:   tokens.scope || "",
      raw:     JSON.stringify(tokens),
      ts:      Date.now(),
    });
  }
}

/** True if any google identity exists OR the legacy tokens table has a row. */
export function googleStatus(): { connected: boolean; account?: string } {
  const ids = listIdentities("google");
  if (ids.length) return { connected: true, account: ids[0].account ?? undefined };
  const row = getDb().prepare(`SELECT account FROM tokens WHERE provider='google'`).get() as any;
  return row ? { connected: true, account: row.account || undefined } : { connected: false };
}
