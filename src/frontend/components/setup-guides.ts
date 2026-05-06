// Setup guides — authored Markdown for each connector type. Loaded into the
// IntegrationSetupGuide accordion next to the credentials form. Adding a new
// connector? Add a const here, plug it into the ConnectorTypeDef in
// settings.ts (the schema requires `setupGuideMarkdown`), and the UI
// auto-renders it.

export const OUTLOOK_SETUP_GUIDE = `## Outlook Calendar — Azure AD setup

> **Port note:** the app server runs on **port 3000**. The Vite dev server runs on port 5173 — do not use 5173 in the redirect URI. If you changed the server port via \`PORT=\` in \`.env\`, substitute that port below.

1. Open [portal.azure.com](https://portal.azure.com) and sign in with the Microsoft account that should own the app.
2. Search for **App registrations** in the top bar and open it.
3. Click **+ New registration**.
   - **Name**: \`Daily Command Center\`
   - **Supported account types**: select **Accounts in any organizational directory and personal Microsoft accounts** (multitenant).
   - **Redirect URI** type **Web**, value:
\`\`\`
http://localhost:3000/api/auth/microsoft/callback
\`\`\`
   - Click **Register**.
4. On the **Overview** page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
   - Paste the client ID into the form below.
   - Paste the tenant ID into *Tenant ID* — or leave blank to use the multitenant \`common\` endpoint.
5. Left sidebar → **Certificates & secrets** → **+ New client secret**. Add a description and expiry.
6. **Immediately copy the \`Value\` column** (not the Secret ID — the value is only shown once). Paste it into *Client secret value* below.
7. Left sidebar → **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**. Add:
   - \`Calendars.Read\`
   - \`offline_access\`
   - \`User.Read\`
   - \`openid\`, \`profile\`, \`email\`
   - Click **Add permissions**.
8. Save the credentials below, then click **Connect Outlook ↗**.

> **Watch out:** pasting the Secret ID (a GUID) instead of the Value is the #1 reason connections fail. The Value is the long string with letters and \`~\` characters.
`;

export const SLACK_SETUP_GUIDE = `## Slack — OAuth app setup

> **Port note:** the app server runs on **port 3000**. The Vite dev server runs on port 5173 — do not use 5173 in the redirect URI. If you changed the server port via \`PORT=\` in \`.env\`, substitute that port below.

1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
   - **App Name**: \`Daily Command Center\`
   - Pick the workspace you want to install into.
   - Click **Create App**.
2. Left sidebar → **OAuth & Permissions**.
3. Under **Redirect URLs**, click **Add New Redirect URL** and paste:
\`\`\`
http://localhost:3000/api/auth/slack/callback
\`\`\`
   Click **Add URL**, then **Save URLs**.
4. Scroll to **Scopes** → **User Token Scopes** and add:
   - \`channels:history\`, \`channels:read\`
   - \`groups:history\`, \`groups:read\`
   - \`im:history\`, \`im:read\`
   - \`mpim:history\`, \`mpim:read\`
   - \`users:read\`, \`users:read.email\`
   - \`search:read\`, \`reactions:read\`
5. Left sidebar → **Basic Information** → **App Credentials**.
   - Copy **Client ID** → paste into *Client ID* below.
   - Click **Show** next to **Client Secret** → paste into *Client secret*.
6. Save the credentials below, then click **Connect Slack ↗**. Slack will prompt you to authorize the install.

> **Why User Token Scopes (not Bot)?** This connector reads Slack on your behalf — DMs, mentions, and search — none of which a bot user can see.
`;

export const GITHUB_SETUP_GUIDE = `## GitHub — Personal Access Token

The current GitHub connector uses a Personal Access Token (PAT). This is the simplest setup and works for both personal and org accounts.

1. Open [github.com/settings/tokens](https://github.com/settings/tokens) → **Tokens (classic)** → **Generate new token (classic)**.
2. Configure:
   - **Note**: \`Daily Command Center\`
   - **Expiration**: 90 days (or longer if you prefer).
   - **Scopes**: tick \`repo\`, \`read:user\`, and \`read:org\`.
   - Click **Generate token**.
3. **Copy the \`ghp_…\` token immediately** — GitHub only shows it once. Paste it into *Personal access token* below.
4. Fill in *Username / Org* (your login, e.g. \`octocat\`) and *Repository* (\`owner/repo-name\`). Pasting a full \`https://github.com/...\` URL is fine — it'll be auto-stripped to the slug.
5. Click **Connect**.

### Optional: OAuth App (advanced)

Prefer a proper OAuth flow? Create an OAuth App at [github.com/settings/developers](https://github.com/settings/developers) with callback URL:
\`\`\`
http://localhost:3000/api/auth/github/callback
\`\`\`
Copy the **Client ID** and a freshly generated **Client Secret**. (The current connector form expects a PAT — OAuth wiring is on the roadmap.)
`;

export const GOOGLE_SETUP_GUIDE = `## Google Calendar — OAuth client setup

> **Port note:** the app server runs on **port 3000**. The Vite dev server runs on port 5173 — do not use 5173 in the redirect URI. If you changed the server port via \`PORT=\` in \`.env\`, substitute that port below.

1. Open the [Google Cloud Console](https://console.cloud.google.com) and create or select a project.
2. **APIs & Services → Library**: enable **Google Calendar API** (and **Gmail API** if you also want mail).
3. **APIs & Services → OAuth consent screen**: configure as **External**, add yourself as a **Test user**.
4. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
   - **Application type**: Web application.
   - **Authorized redirect URI**:
\`\`\`
http://localhost:3000/api/auth/google/callback
\`\`\`
   - Click **Create**.
5. From the credential detail page, copy:
   - **Client ID** (ends in \`.apps.googleusercontent.com\`) → *Client ID*.
   - **Client secret** (starts with \`GOCSPX-\`) → *Client secret*.
6. Save the credentials below, then click **Connect Google Calendar ↗**.

> **Scopes requested:** \`calendar.readonly\`, \`calendar.events\`, \`gmail.readonly\` (only if Gmail is enabled), \`userinfo.email\`, \`userinfo.profile\`. You'll see them on Google's consent screen.
`;

export const JIRA_SETUP_GUIDE = `## Jira — API token

1. Open [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) → **Create API token**.
2. Label it \`Daily Command Center\` and click **Create**. **Copy the token** — it's only shown once.
3. Paste it into *API token* below.
4. *Email* — the address you log in to Jira with.
5. *Base URL* — your site host, e.g. \`acme.atlassian.net\` (no \`https://\`, no trailing slash). Pasting a full URL is fine, it'll be stripped.
6. Click **Connect**.
`;

export const NOTION_SETUP_GUIDE = `## Notion — Internal Integration

1. Open [notion.so/my-integrations](https://www.notion.so/my-integrations) → **+ New integration**.
2. Configure:
   - **Type**: Internal.
   - **Associated workspace**: your workspace.
   - Click **Save**.
3. Under **Capabilities**, ensure **Read content** is enabled.
4. Copy the **Internal Integration Secret** (starts with \`secret_\`) → paste into *Integration token* below.
5. **Important:** open each Notion database you want to query → **•••** menu → **Connections** → add your integration. The token alone gives no access until pages are explicitly shared.
6. *Database IDs* — paste the database URL(s); the 32-char ID is auto-extracted.
7. Click **Connect**.
`;

export const CLICKUP_SETUP_GUIDE = `## ClickUp — Personal API token

1. Open [app.clickup.com](https://app.clickup.com) → click your **avatar** → **Settings** → **Apps**.
2. Under **API Token**, click **Generate** (or **Regenerate**) and copy the \`pk_…\` token.
3. Paste it into *Personal API token* below.
4. *Workspace ID* — the numeric ID at the start of any ClickUp URL: \`app.clickup.com/{ID}/...\`. Pasting the whole URL is fine.
5. *Space IDs* — leave blank to include all Spaces, or paste a comma-separated list to narrow scope.
6. Click **Connect**.
`;
