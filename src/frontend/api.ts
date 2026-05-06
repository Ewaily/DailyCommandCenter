// Typed fetch client. All endpoints return { data, error?, ... }.
const BASE = "/api";

// Read at call time from localStorage so api.ts doesn't need a circular import
// from workspace-switcher.ts. Empty/null → cross-workspace (server picks default).
function activeWs(): string | null {
  const v = localStorage.getItem("dcc-active-workspace");
  return v && v.length ? v : null;
}
function withWs(qs: string): string {
  const ws = activeWs();
  if (!ws) return qs;
  const sep = qs.includes("?") ? "&" : "?";
  return `${qs}${sep}workspace=${encodeURIComponent(ws)}`;
}

export type Envelope<T> = { data: T; error?: string; cached_at?: number; fresh_at?: number; notConfigured?: boolean };

export type CalendarEvent = {
  id: string; title: string; start: string; end: string;
  durationMinutes: number; isFocus: boolean; isAllDay: boolean;
  isCreatedToday: boolean;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction" | null;
  attendeeCount: number; meetUrl: string | null; htmlLink: string;
  badges: ("new" | "respond" | "tentative" | "declined" | "focus")[];
  sourceColor: string | null;
  sourceLabel: string | null;
};

export type SlackMsg = {
  channelId: string; channelName: string; isDm: boolean;
  ts: string; tsHuman: string;
  authorId: string; authorName: string; authorAvatar: string | null;
  text: string; html: string; permalink: string;
};

export type ChannelDigest = {
  channelId: string; channelName: string;
  messages: SlackMsg[]; permalink: string; error?: string;
};

export type DigestConfig = {
  channels: { id: string; name: string }[];
  msgsPerChannel: number;
};

export type Mention = SlackMsg & { urgent: boolean };

export type Todo = {
  id: string; text: string; done: boolean;
  createdDate: string; createdAt: number; completedAt: number | null;
  priority?: "low" | "medium" | "high" | null; dueDate?: string | null;
};

export type WatchedUser = {
  id: string;
  label: string;
  query: string;
  status?: string;
  hideClosed?: boolean;
};

export type JiraAssignee = { name: string; avatar: string | null; accountId: string | null };
export type Ticket = {
  source: "jira"; id: string; key: string; title: string;
  status: string;
  statusBucket: "todo" | "in_progress" | "in_review" | "blocked" | "done";
  statusColor: string | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  assignee: JiraAssignee | null;
  project: string | null;
  projectKey: string | null;
  url: string;
  dueDate: string | null; updatedAt: string;
};

export type ClickUpAssignee = { id: number; name: string; color: string | null; avatar: string | null };
export type ClickUpTask = {
  source: "clickup"; id: string; customId: string | null; title: string;
  status: string;
  statusColor: string | null;
  statusBucket: "todo" | "in_progress" | "in_review" | "done";
  priority: "urgent" | "high" | "medium" | "low" | null;
  assignees: ClickUpAssignee[];
  list: string | null;
  url: string; dueDate: string | null; updatedAt: string;
};

export type PR = {
  id: string; number: number; title: string; repo: string;
  url: string; ageHuman: string; status: string;
  waitingOnYou: boolean; author: string;
};

export type Workspace = {
  id: string; name: string; icon: string | null; color: string | null;
  website: string | null; logoUrl: string | null;
  position: number | null; isDefault: boolean; createdAt: number;
};

export type Identity = {
  id: string; type: string; label: string | null; account: string | null;
  scope: string | null; expiresAt: number | null; displayColor: string | null;
  hasToken: boolean; updatedAt: number;
};

export type ConnectorInstance = {
  id: string; workspaceId: string | null; type: string;
  identityId: string | null; config: Record<string, unknown>;
  enabled: boolean; position: number | null; shared: boolean;
  shareWithOverview: boolean;
  source?: "owned" | "shared";
  ownerWorkspace?: { id: string; name: string; icon: string | null; color: string | null; logoUrl?: string | null; website?: string | null } | null;
  enabledForThisWorkspace?: boolean;
  identity?: { account: string | null; label: string | null; hasToken: boolean; accessToken: string | null; refreshToken: string | null; displayColor: string | null } | null;
};

export type SecondaryTz = { tz: string; label: string };
export type JiraProject = { id: string; key: string; name: string };
export type AppCreds = {
  ticketWorkflows: { cloningEnabled: boolean; defaultTargetProject: string };
  brand:     { name: string; subtitle: string };
  prefs:     { primaryTz: string; secondaryTzs: SecondaryTz[] };
  google:    { clientId: string | null; clientSecret: string | null; hasSecret: boolean; redirectUri: string | null };
  slack:     { clientId: string | null; clientSecret: string | null; hasSecret: boolean; redirectUri: string | null };
  microsoft: { clientId: string | null; clientSecret: string | null; hasSecret: boolean; redirectUri: string | null; tenantId: string | null };
};


export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<Envelope<T>> {
  const res = await fetch(BASE + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

export const api = {
  health: () => req<{ ok: boolean; providers: Record<string, boolean> }>("/health"),

  calendarEvents: (start: string, end: string, connectorId?: string) =>
    req<CalendarEvent[]>(withWs(`/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${connectorId ? `&connectorId=${encodeURIComponent(connectorId)}` : ""}`)),

  slackDigest: (connectorId?: string) => req<ChannelDigest[]>(withWs(`/slack/digest${connectorId ? `?connectorId=${encodeURIComponent(connectorId)}` : ""}`)),
  slackDigestConfig: () => req<DigestConfig>(withWs("/slack/digest/config")),
  saveSlackDigestConfig: (cfg: DigestConfig) =>
    req<DigestConfig>(withWs("/slack/digest/config"), { method: "PUT", body: JSON.stringify(cfg) }),
  mentions: (days = 7, bust = false, connectorId?: string) => req<Mention[]>(withWs(`/slack/mentions?days=${days}${bust ? "&bust=1" : ""}${connectorId ? `&connectorId=${encodeURIComponent(connectorId)}` : ""}`)),

  ticketsMine: (bucket: string = "mine", connectorId?: string) =>
    req<Ticket[]>(withWs(`/tickets/mine?bucket=${encodeURIComponent(bucket)}${connectorId ? `&connectorId=${encodeURIComponent(connectorId)}` : ""}`)) as Promise<
      Envelope<Ticket[]> & { counts?: Record<string, number>; bucket?: string; buckets?: WatchedUser[] }
    >,
  ticketsTeam: (project?: string, connectorId?: string) => req<Ticket[]>(withWs(`/tickets/team${project ? `?project=${encodeURIComponent(project)}` : ""}${connectorId ? `${project ? "&" : "?"}connectorId=${encodeURIComponent(connectorId)}` : ""}`)),
  prs: (bucket: "review" | "mine" | "all" | "closed" = "review", connectorId?: string) =>
    req<PR[]>(withWs(`/prs/queue?bucket=${bucket}${connectorId ? `&connectorId=${encodeURIComponent(connectorId)}` : ""}`)) as Promise<Envelope<PR[]> & { counts?: Record<string, number> }>,
  clickupTasks: (bucket = "mine", connectorId?: string) =>
    req<ClickUpTask[]>(withWs(`/clickup/tasks?bucket=${encodeURIComponent(bucket)}${connectorId ? `&connectorId=${encodeURIComponent(connectorId)}` : ""}`)) as Promise<
      Envelope<ClickUpTask[]> & { counts?: Record<string, number>; bucket?: string; buckets?: WatchedUser[] }
    >,

  todos: () => req<Todo[]>("/todos"),
  todoCreate: (todo: Todo) => req<{ id: string }>("/todos", { method: "POST", body: JSON.stringify(todo) }),
  todoUpdate: (id: string, patch: Partial<Todo>) => req<{ id: string }>(`/todos/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  todoDelete: (id: string) => req<{ id: string }>(`/todos/${id}`, { method: "DELETE" }),

  settingsGet: () => req<Record<string, unknown>>("/settings"),
  settingsPut: (patch: Record<string, unknown>) => req<Record<string, unknown>>("/settings", { method: "PUT", body: JSON.stringify(patch) }),

  workspaces: () => req<{ workspaces: Workspace[]; defaultWorkspaceId: string | null }>("/workspaces"),
  workspace: (id: string) => req<{ workspace: Workspace; connectors: ConnectorInstance[] }>(`/workspaces/${id}`),
  workspaceCreate: (input: { name: string; icon?: string | null; color?: string | null; website?: string | null; logoUrl?: string | null; isDefault?: boolean }) =>
    req<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(input) }),
  workspaceUpdate: (id: string, patch: Partial<{ name: string; icon: string | null; color: string | null; website: string | null; logoUrl: string | null; isDefault: boolean }>) =>
    req<Workspace>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  workspaceDelete: (id: string) =>
    req<{ ok: boolean }>(`/workspaces/${id}`, { method: "DELETE" }),
  workspaceConnectorCreate: (id: string, input: { type: string; identityId?: string | null; config?: Record<string, unknown>; enabled?: boolean; shared?: boolean; shareWithOverview?: boolean }) =>
    req<ConnectorInstance>(`/workspaces/${id}/connectors`, { method: "POST", body: JSON.stringify(input) }),

  identities: (type?: string) => req<Identity[]>(`/identities${type ? `?type=${encodeURIComponent(type)}` : ""}`),
  identityCreate: (input: { type: string; label?: string | null; account?: string | null; accessToken: string; displayColor?: string | null }) =>
    req<Identity>("/identities", { method: "POST", body: JSON.stringify(input) }),
  identityUpdate: (id: string, patch: Partial<{ label: string | null; account: string | null; accessToken: string; displayColor: string | null }>) =>
    req<Identity>(`/identities/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  identityDelete: (id: string) =>
    req<{ ok: boolean }>(`/identities/${id}`, { method: "DELETE" }),

  authStatus: (provider: "google" | "slack") =>
    req<{ connected: boolean; account?: string }>(`/auth/${provider}/status`),

  appSettingsGet: () => req<AppCreds>("/app-settings"),
  appSettingsPut: (patch: Record<string, unknown>) =>
    req<AppCreds>("/app-settings", { method: "PUT", body: JSON.stringify(patch) }),

  jiraProjects: (connectorId?: string) =>
    req<JiraProject[]>(withWs(`/jira/projects${connectorId ? `?connectorId=${encodeURIComponent(connectorId)}` : ""}`)) as Promise<
      Envelope<JiraProject[]> & { notConfigured?: boolean }
    >,
  cloneTicket: (payload: {
    sourceProvider: "jira" | "clickup";
    title: string;
    description?: string;
    originalLink: string;
    targetJiraProjectId: string;
    connectorId?: string;
  }) => req<{ key: string; id: string; url: string }>(withWs("/jira/clone-ticket"), { method: "POST", body: JSON.stringify(payload) }),

  workspaceConnect: (wsId: string, body: { type: string; token: string; account?: string; label?: string; config?: Record<string, unknown>; connectorId?: string; addAnother?: boolean }) =>
    req<{ ok: boolean }>(`/workspaces/${wsId}/connect`, { method: "POST", body: JSON.stringify(body) }),
  workspaceDisconnectByType: (wsId: string, type: string) =>
    req<{ ok: boolean }>(`/workspaces/${wsId}/connectors/by-type/${encodeURIComponent(type)}`, { method: "DELETE" }),
  workspaceSharedEnrollment: (wsId: string, ciId: string, enabled: boolean) =>
    req<{ ok: boolean; enabled: boolean; enabledWorkspaces: string[] }>(
      `/workspaces/${wsId}/shared/${ciId}/enrollment`,
      { method: "PUT", body: JSON.stringify({ enabled }) },
    ),

  connectors: () => req<ConnectorInstance[]>("/connectors"),
  connectorUpdate: (id: string, patch: Partial<{ identityId: string | null; config: Record<string, unknown>; enabled: boolean; shared: boolean; shareWithOverview: boolean }>) =>
    req<ConnectorInstance>(`/connectors/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  connectorDelete: (id: string) =>
    req<{ ok: boolean }>(`/connectors/${id}`, { method: "DELETE" }),
};

export const isAuthError = (e: unknown) =>
  e instanceof ApiError && (e.status === 401 || e.status === 403 || /not_connected/i.test(e.message));
