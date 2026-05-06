import "dotenv/config";
import os from "node:os";
import path from "node:path";

function expand(p: string): string {
  if (!p) return p;
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  vitePort: Number(env.VITE_PORT || 5173),
  nodeEnv: env.NODE_ENV || "development",
  isDev: (env.NODE_ENV || "development") !== "production",
  logLevel: env.LOG_LEVEL || "info",
  dbPath: expand(env.DB_PATH || "~/.daily-command-center/db.sqlite"),

  google: {
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback",
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
  },

  slack: {
    clientId: env.SLACK_CLIENT_ID || "",
    clientSecret: env.SLACK_CLIENT_SECRET || "",
    redirectUri: env.SLACK_REDIRECT_URI || "http://localhost:3000/api/auth/slack/callback",
    userToken: env.SLACK_USER_TOKEN || "",
    userId: env.SLACK_USER_ID || "",
    userScopes: [
      "channels:history",
      "channels:read",
      "groups:history",
      "groups:read",
      "im:history",
      "im:read",
      "mpim:history",
      "mpim:read",
      "search:read",
      "users:read",
      "users.profile:read",
    ],
    digestChannels: [] as { id: string; name: string }[],
  },

  jira: {
    baseUrl: env.JIRA_BASE_URL || "",
    email: env.JIRA_EMAIL || "",
    apiToken: env.JIRA_API_TOKEN || "",
  },
  github: {
    token: env.GITHUB_TOKEN || "",
    username: env.GITHUB_USERNAME || "",
    repo: env.GITHUB_REPO || "",
  },
  notion: {
    token: env.NOTION_TOKEN || "",
    databaseIds: (env.NOTION_DATABASE_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  },
  clickup: {
    token:    env.CLICKUP_TOKEN    || "",
    teamId:   env.CLICKUP_TEAM_ID  || "",
    spaceIds: (env.CLICKUP_SPACE_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
  },

  microsoft: {
    clientId:     env.MICROSOFT_CLIENT_ID     || "",
    clientSecret: env.MICROSOFT_CLIENT_SECRET || "",
    tenantId:     env.MICROSOFT_TENANT_ID     || "common",
    redirectUri:  env.MICROSOFT_REDIRECT_URI  || "http://localhost:3000/api/auth/microsoft/callback",
    scopes: ["Calendars.Read", "User.Read", "offline_access"],
  },
};

export type Config = typeof config;
