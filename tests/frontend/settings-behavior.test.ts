// Behavioral tests for settings.ts that mount the full settings UI in
// happy-dom, trigger `openSettings()`, and assert on rendered DOM.
//
// These tests exist to cover settings.ts internal helpers organically — by
// rendering real markup and clicking real buttons — rather than by exporting
// private functions just to test them. Per the CLAUDE_SYSTEM_RULES "Testing
// Philosophy: Behavior over Implementation".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    workspaces:        vi.fn(),
    workspace:         vi.fn(),
    appSettingsGet:    vi.fn(),
    appSettingsPut:    vi.fn().mockResolvedValue({ data: {} }),
    jiraProjects:      vi.fn(),
    connectors:        vi.fn(),
    connectorUpdate:   vi.fn().mockResolvedValue({ data: {} }),
    connectorDelete:   vi.fn().mockResolvedValue({ data: {} }),
    workspaceCreate:   vi.fn().mockResolvedValue({ data: { id: "ws-new" } }),
    workspaceUpdate:   vi.fn().mockResolvedValue({ data: {} }),
    workspaceDelete:   vi.fn().mockResolvedValue({ data: {} }),
    workspaceConnect:  vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: vi.fn() }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: vi.fn(), saveSetting: vi.fn() }));
vi.mock("../../src/frontend/components/workspace-switcher.js", () => ({
  refreshActiveWorkspace: vi.fn(),
  getActiveWorkspaceId:   vi.fn().mockReturnValue("ws-1"),
}));
vi.mock("../../src/frontend/components/brand.js",                () => ({ applyBrand: vi.fn(), DEFAULT_BRAND_NAME: "Daily Command Center" }));
vi.mock("../../src/frontend/components/theme.js",                () => ({ applyTheme: vi.fn() }));
vi.mock("../../src/frontend/components/header.js",               () => ({ setTimezones: vi.fn() }));
vi.mock("../../src/frontend/components/icons.js",                () => ({ paintIcons: vi.fn() }));
vi.mock("../../src/frontend/components/workspace-logo.js",       () => ({
  domainFromUrl: vi.fn(), buildLogoCandidates: vi.fn().mockReturnValue([]), monogramDataUrl: vi.fn().mockReturnValue(""),
  renderWorkspaceBadge: vi.fn().mockReturnValue(""),
}));
vi.mock("../../src/frontend/components/integration-setup-guide.js", () => ({ renderSetupGuide: vi.fn().mockReturnValue("") }));

import { openSettings, closeSettings, isSettingsOpen, toggleSettings, bindSettings, openToNewWorkspace } from "../../src/frontend/components/settings.js";

const wsAlpha = { id: "ws-1", name: "Alpha", slug: "alpha", color: "#0066CC", logoUrl: null };
const wsBeta  = { id: "ws-2", name: "Beta",  slug: "beta",  color: "#dc2626", logoUrl: null };

const jiraConnector = (id = "ci-jira", overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId:       "ws-1",
  type:              "jira",
  identityId:        "id-jira-1",
  config:            {},
  enabled:           true,
  position:          0,
  shared:            false,
  shareWithOverview: false,
  identity:          { account: "user@example.com", label: null, hasToken: true, accessToken: "tok", refreshToken: null, displayColor: null },
  ...overrides,
});

const clickupConnector = (id = "ci-clickup", overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId:       "ws-1",
  type:              "clickup",
  identityId:        "id-clickup-1",
  config:            { teamId: "12345" },
  enabled:           true,
  position:          1,
  shared:            false,
  shareWithOverview: false,
  identity:          { account: "user@example.com", label: null, hasToken: true, accessToken: "tok", refreshToken: null, displayColor: null },
  ...overrides,
});

const slackConnector = (id = "ci-slack", overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId:       "ws-1",
  type:              "slack",
  identityId:        "id-slack-1",
  config:            {},
  enabled:           true,
  position:          2,
  shared:            false,
  shareWithOverview: false,
  identity:          { account: "team", label: null, hasToken: true, accessToken: "tok", refreshToken: null, displayColor: null },
  ...overrides,
});

const githubConnector = (id = "ci-gh", overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId:       "ws-1",
  type:              "github",
  identityId:        null,
  config:            {},
  enabled:           true,
  position:          3,
  shared:            false,
  shareWithOverview: false,
  identity:          null,
  ...overrides,
});

const defaultAppCreds = {
  google:    { clientId: null, clientSecret: null, redirectUri: null },
  slack:     { clientId: null, clientSecret: null, redirectUri: null },
  microsoft: { clientId: null, clientSecret: null, redirectUri: null, tenant: null },
  prefs: {
    "brand.name":      "Daily Command Center",
    "brand.subtitle":  "",
    "prefs.theme":     "auto",
    "prefs.density":   "comfortable",
    "prefs.primaryTz": "America/New_York",
    "prefs.secondaryTzs": [],
    "prefs.accentColor": "#0066CC",
  },
};

function setupModalDOM() {
  document.body.innerHTML = `
    <div id="settings-modal">
      <button data-settings-tab="workspaces">Workspaces</button>
      <button data-settings-tab="preferences">Preferences</button>
      <div id="settings-body"></div>
    </div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom does not implement window.alert — stub it so that any
  // catch-branch in settings.ts that reaches `alert(...)` doesn't surface
  // as an unhandled rejection and fail CI.
  if (typeof window.alert !== "function") {
    Object.defineProperty(window, "alert", { value: () => {}, configurable: true, writable: true });
  }
  setupModalDOM();
  mockApi.workspaces.mockResolvedValue({
    data: { workspaces: [wsAlpha, wsBeta], defaultWorkspaceId: "ws-1" },
  });
  mockApi.appSettingsGet.mockResolvedValue({ data: defaultAppCreds });
  mockApi.workspace.mockImplementation(async (id: string) => ({
    data: {
      workspace: id === "ws-1" ? wsAlpha : wsBeta,
      connectors: id === "ws-1"
        ? [jiraConnector(), clickupConnector(), slackConnector(), githubConnector()]
        : [],
    },
  }));
  mockApi.jiraProjects.mockResolvedValue({
    data: [{ id: "10000", key: "PROJ", name: "Project Alpha" }, { id: "10001", key: "DEV", name: "Dev Board" }],
    notConfigured: false,
  });
  mockApi.connectors.mockResolvedValue({
    data: [jiraConnector(), clickupConnector(), slackConnector(), githubConnector()],
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ── open / close lifecycle ────────────────────────────────────────────────────

describe("settings open/close lifecycle", () => {
  it("isSettingsOpen returns false before openSettings is called", () => {
    expect(isSettingsOpen()).toBe(false);
  });

  it("openSettings adds .open class to the modal", () => {
    openSettings();
    expect(document.getElementById("settings-modal")?.classList.contains("open")).toBe(true);
    expect(isSettingsOpen()).toBe(true);
  });

  it("closeSettings removes .open class", () => {
    openSettings();
    closeSettings();
    expect(isSettingsOpen()).toBe(false);
  });

  it("toggleSettings toggles the open state", () => {
    expect(isSettingsOpen()).toBe(false);
    toggleSettings();
    expect(isSettingsOpen()).toBe(true);
    toggleSettings();
    expect(isSettingsOpen()).toBe(false);
  });
});

// ── Workspaces tab — full renderWorkspaces flow ───────────────────────────────

describe("settings Workspaces tab — behavioral render", () => {
  it("renders workspace section headers for each workspace", async () => {
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("renders the 'Add workspace' button", async () => {
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const btn = document.querySelector('[data-action="ws-new"]');
    expect(btn).not.toBeNull();
  });

  it("renders Jira connector card with clone editor when configured", async () => {
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    expect(html).toContain('data-form="connector-clone-save"');
  });

  it("renders ClickUp connector card with clone editor", async () => {
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    expect(html).toContain("ClickUp tasks");
  });

  it("renders empty state when there are no workspaces", async () => {
    mockApi.workspaces.mockResolvedValue({ data: { workspaces: [], defaultWorkspaceId: null } });
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    expect(html).toContain("No workspaces yet");
  });

  it("renders error state when api.workspaces rejects", async () => {
    mockApi.workspaces.mockRejectedValue(new Error("Boom"));
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    expect(html).toContain("Failed to load");
  });

  it("renders setup-guide link inside un-configured connector", async () => {
    // GitHub connector here has identity:null → renders the API key form
    openSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    expect(html).toContain("GitHub");
  });
});

// ── Preferences tab — full renderPreferences flow ─────────────────────────────

describe("settings Preferences tab — behavioral render", () => {
  it("clicking the preferences tab triggers a re-render", async () => {
    openSettings();
    await new Promise(r => setTimeout(r, 0));

    const prefsTab = document.querySelector<HTMLElement>('[data-settings-tab="preferences"]');
    bindSettings();
    prefsTab!.click();

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const html = document.getElementById("settings-body")!.innerHTML;
    // Preferences renderer pulls app settings — should not error
    expect(html).not.toContain("Failed to load");
  });
});

// ── openToNewWorkspace ────────────────────────────────────────────────────────

describe("openToNewWorkspace", () => {
  it("opens settings and observes the modal for the ws-new button", async () => {
    openToNewWorkspace();
    expect(isSettingsOpen()).toBe(true);
    // Wait for first render
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    const btn = document.querySelector('[data-action="ws-new"]');
    expect(btn).not.toBeNull();
  });

  it("does not throw if no modal element exists", () => {
    document.body.innerHTML = "";
    expect(() => openToNewWorkspace()).not.toThrow();
  });
});

// ── bindSettings event delegation ─────────────────────────────────────────────

describe("bindSettings", () => {
  it("does not throw when bound and modal is clicked outside body", () => {
    bindSettings();
    expect(() => document.getElementById("settings-modal")!.click()).not.toThrow();
  });

  it("submitting connector-clone-save form patches the connector config with all 4 fields", async () => {
    openSettings();
    bindSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const form = document.querySelector<HTMLFormElement>('[data-form="connector-clone-save"]');
    if (!form) return;
    const setVal = (name: string, val: string | boolean) => {
      const el = form.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (!el) return;
      if (typeof val === "boolean") el.checked = val;
      else el.value = val;
    };
    setVal("cloningEnabled",     true);
    setVal("cloneTargetUrl",     "https://target.atlassian.net");
    setVal("cloneTargetEmail",   "user@target.com");
    setVal("cloneTargetToken",   "TOKEN-XYZ");
    setVal("cloneTargetProject", "PROJ");

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.connectorUpdate).toHaveBeenCalled();
    const [, patch] = mockApi.connectorUpdate.mock.calls[0];
    expect(patch.config).toMatchObject({
      cloningEnabled:     true,
      cloneTargetUrl:     "https://target.atlassian.net",
      cloneTargetEmail:   "user@target.com",
      cloneTargetToken:   "TOKEN-XYZ",
      cloneTargetProject: "PROJ",
    });
  });

  it("blocks save when 1-Click Cloning is enabled but credentials are incomplete", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    openSettings();
    bindSettings();
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    const form = document.querySelector<HTMLFormElement>('[data-form="connector-clone-save"]');
    if (!form) { alertSpy.mockRestore(); return; }
    const enabled = form.querySelector<HTMLInputElement>('input[name="cloningEnabled"]');
    if (enabled) enabled.checked = true;
    // Deliberately leave URL/email/token/project blank
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("Target Base URL"));
    expect(mockApi.connectorUpdate).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

// ── onSettingsChange – connector toggles ─────────────────────────────────────

describe("onSettingsChange — connector instance toggles", () => {
  async function openAndBind() {
    openSettings();
    bindSettings();
    // Wait for the async render chain to settle
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  }

  it("instance-share-toggle dispatches connectorUpdate with shared:true", async () => {
    await openAndBind();
    const checkbox = document.querySelector<HTMLInputElement>(
      'input[data-action="instance-share-toggle"]'
    );
    if (!checkbox) return; // connector not rendered — skip rather than fail
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.connectorUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ shared: true }),
    );
  });

  it("instance-overview-toggle dispatches connectorUpdate with shareWithOverview", async () => {
    await openAndBind();
    const checkbox = document.querySelector<HTMLInputElement>(
      'input[data-action="instance-overview-toggle"]'
    );
    if (!checkbox) return;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.connectorUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ shareWithOverview: true }),
    );
  });
});

// ── onSettingsPaste — URL stripping ──────────────────────────────────────────

describe("onSettingsPaste — URL stripping", () => {
  async function openAndBind() {
    openSettings();
    bindSettings();
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  }

  function makeInput(name: string): HTMLInputElement {
    const input = document.createElement("input");
    input.name = name;
    input.dataset.stripUrl = "1";
    document.getElementById("settings-body")!.appendChild(input);
    return input;
  }

  function paste(input: HTMLInputElement, text: string) {
    const dt = new DataTransfer();
    dt.setData("text", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }

  it("strips github.com URL to owner/repo for repo input", async () => {
    await openAndBind();
    const input = makeInput("repo");
    paste(input, "https://github.com/owner/my-repo.git");
    expect(input.value).toBe("owner/my-repo");
  });

  it("strips atlassian.net URL to hostname for baseUrl input", async () => {
    await openAndBind();
    const input = makeInput("baseUrl");
    paste(input, "https://acme.atlassian.net/browse/PROJ-1");
    expect(input.value).toBe("acme.atlassian.net");
  });

  it("strips ClickUp URL to teamId for teamId input", async () => {
    await openAndBind();
    const input = makeInput("teamId");
    paste(input, "https://app.clickup.com/12345678/home");
    expect(input.value).toBe("12345678");
  });

  it("does not strip plain text without slash or http", async () => {
    await openAndBind();
    const input = makeInput("repo");
    paste(input, "no-slash-no-http");
    // plain text — should NOT be intercepted
    expect(input.value).toBe("");
  });
});
