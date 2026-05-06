import { config } from "../config.js";
import { getDb } from "../db.js";
import { getAppSetting } from "../lib/app-settings.js";
import { createIdentity, updateIdentity, getIdentity, listIdentities } from "../lib/workspace-config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function msCreds() {
  const tenantId = getAppSetting("microsoft.tenantId", config.microsoft.tenantId);
  return {
    clientId:     getAppSetting("microsoft.clientId",     config.microsoft.clientId),
    clientSecret: getAppSetting("microsoft.clientSecret", config.microsoft.clientSecret),
    redirectUri:  getAppSetting("microsoft.redirectUri",  config.microsoft.redirectUri),
    tenantId,
    authBase: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`,
  };
}

export function microsoftAuthUrl(state: string): string {
  const { clientId, redirectUri, authBase } = msCreds();
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    scope:         config.microsoft.scopes.join(" "),
    response_mode: "query",
    state,
  });
  return `${authBase}/authorize?${params}`;
}

async function exchangeCode(code: string): Promise<{
  access_token: string; refresh_token?: string; expires_in: number; scope: string;
}> {
  const { clientId, clientSecret, redirectUri, authBase } = msCreds();
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    code,
    redirect_uri:  redirectUri,
    grant_type:    "authorization_code",
  });
  const res = await fetch(`${authBase}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token exchange failed: ${text}`);
  }
  return res.json() as any;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string; refresh_token?: string; expires_in: number;
}> {
  const { clientId, clientSecret, authBase } = msCreds();
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    "refresh_token",
    scope:         config.microsoft.scopes.join(" "),
  });
  const res = await fetch(`${authBase}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error("Microsoft token refresh failed");
  return res.json() as any;
}

async function graphGet(path: string, accessToken: string): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function microsoftHandleCallback(code: string, workspaceId: string): Promise<{ identityId: string }> {
  const tokens = await exchangeCode(code);
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  // Get user email from Graph
  let account = "";
  let displayName = "";
  try {
    const me = await graphGet("/me?$select=mail,displayName,userPrincipalName", tokens.access_token);
    account = me.mail || me.userPrincipalName || "";
    displayName = me.displayName || "";
  } catch { /* non-fatal */ }

  // Create a new identity row for this Outlook account.
  const identity = createIdentity({
    type:         "outlook",
    label:        displayName || account || "Outlook",
    account,
    accessToken:  tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt,
    scope:        tokens.scope,
    displayColor: "#0078D4",
  });

  return { identityId: identity.id };
}

// Returns a valid access token for the given identity, refreshing if needed.
export async function getMicrosoftToken(identityId: string): Promise<string> {
  const identity = getIdentity(identityId);
  if (!identity?.accessToken) throw new Error(`No Microsoft token for identity ${identityId}`);

  const BUFFER_MS = 5 * 60 * 1000;
  if (identity.expiresAt && identity.expiresAt - Date.now() > BUFFER_MS) {
    return identity.accessToken;
  }

  if (!identity.refreshToken) throw new Error("Microsoft token expired and no refresh token available");
  const fresh = await refreshAccessToken(identity.refreshToken);
  const expiresAt = Date.now() + fresh.expires_in * 1000;

  updateIdentity(identityId, {
    accessToken:  fresh.access_token,
    ...(fresh.refresh_token ? { } : {}), // refreshToken field not in updateIdentity patch yet; handled below
  });

  // Persist refresh token separately via raw SQL (updateIdentity doesn't expose refreshToken).
  getDb().prepare(
    `UPDATE identities SET refresh_token = COALESCE(?, refresh_token), expires_at = ?, updated_at = ? WHERE id = ?`,
  ).run(fresh.refresh_token ?? null, expiresAt, Date.now(), identityId);

  return fresh.access_token;
}

export function listOutlookIdentities() {
  return listIdentities("outlook");
}

export function microsoftStatus(identityId: string): { connected: boolean; account?: string } {
  const id = getIdentity(identityId);
  return id?.accessToken ? { connected: true, account: id.account ?? undefined } : { connected: false };
}
