import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks — prevent real API/state/DOM side-effects ───────────────────────────
vi.mock("../../src/frontend/api.js", () => ({
  api:         {},
  isAuthError: vi.fn(),
}));
vi.mock("../../src/frontend/state.js", () => ({
  getSetting:  vi.fn(),
  saveSetting: vi.fn(),
}));
vi.mock("../../src/frontend/components/workspace-switcher.js",   () => ({ refreshActiveWorkspace: vi.fn() }));
vi.mock("../../src/frontend/components/brand.js",                () => ({ applyBrand: vi.fn(), DEFAULT_BRAND_NAME: "Daily Command Center" }));
vi.mock("../../src/frontend/components/theme.js",                () => ({ applyTheme: vi.fn() }));
vi.mock("../../src/frontend/components/header.js",               () => ({ setTimezones: vi.fn() }));
vi.mock("../../src/frontend/components/icons.js",                () => ({ paintIcons: vi.fn() }));
vi.mock("../../src/frontend/components/workspace-logo.js",       () => ({
  domainFromUrl: vi.fn(), buildLogoCandidates: vi.fn(), monogramDataUrl: vi.fn(),
  renderWorkspaceBadge: vi.fn().mockReturnValue(""),
}));
vi.mock("../../src/frontend/components/integration-setup-guide.js", () => ({ renderSetupGuide: vi.fn().mockReturnValue("") }));
vi.mock("../../src/frontend/components/setup-guides.js", () => ({
  OUTLOOK_SETUP_GUIDE: "", SLACK_SETUP_GUIDE: "", GITHUB_SETUP_GUIDE: "",
  GOOGLE_SETUP_GUIDE:  "", JIRA_SETUP_GUIDE:   "", NOTION_SETUP_GUIDE: "",
  CLICKUP_SETUP_GUIDE: "",
}));

import { renderConnectorCloneEditor } from "../../src/frontend/components/settings.js";
import type { ConnectorInstance } from "../../src/frontend/api.js";

function makeConnector(cfg: Record<string, unknown> = {}): ConnectorInstance {
  return {
    id:              "ci-jira-1",
    workspaceId:     "ws-1",
    type:            "jira",
    identityId:      "id-1",
    config:          cfg,
    enabled:         true,
    position:        0,
    shared:          false,
    shareWithOverview: false,
    identity:        { account: "user@example.com", label: null, hasToken: true, accessToken: "tok", refreshToken: null, displayColor: null },
  };
}

const projects = [
  { id: "10000", key: "PROJ", name: "Project Alpha" },
  { id: "10001", key: "DEV",  name: "Dev Board"     },
];

// ── renderConnectorCloneEditor — Jira ─────────────────────────────────────────

describe("renderConnectorCloneEditor (Jira)", () => {
  it("renders the form with data-form=connector-clone-save and data-ci", () => {
    const html = renderConnectorCloneEditor(makeConnector(), projects, false);
    expect(html).toContain('data-form="connector-clone-save"');
    expect(html).toContain('data-ci="ci-jira-1"');
  });

  it("renders a <select> when projects are provided", () => {
    const html = renderConnectorCloneEditor(makeConnector(), projects, false);
    expect(html).toContain("<select");
    expect(html).toContain("Project Alpha");
    expect(html).toContain("Dev Board");
  });

  it("falls back to a text <input> when no projects are provided", () => {
    const html = renderConnectorCloneEditor(makeConnector(), [], false);
    expect(html).not.toContain("<select");
    expect(html).toContain('<input name="cloneTargetProject"');
  });

  it("pre-selects the current cloneTargetProject value in the dropdown", () => {
    const html = renderConnectorCloneEditor(
      makeConnector({ cloningEnabled: true, cloneTargetProject: "DEV" }),
      projects,
      false,
    );
    expect(html).toContain('value="DEV" selected');
  });

  it("pre-fills the text input with the current value when no projects list", () => {
    const html = renderConnectorCloneEditor(
      makeConnector({ cloneTargetProject: "CUSTOM" }),
      [],
      false,
    );
    expect(html).toContain('value="CUSTOM"');
  });

  it("renders the checkbox checked when cloningEnabled is true", () => {
    const html = renderConnectorCloneEditor(makeConnector({ cloningEnabled: true }), projects, false);
    expect(html).toContain("checked");
  });

  it("renders the checkbox unchecked when cloningEnabled is false", () => {
    const html = renderConnectorCloneEditor(makeConnector({ cloningEnabled: false }), [], false);
    // Should not contain the standalone `checked` attribute
    expect(html).not.toContain(' checked');
  });

  it("renders 'Jira tickets' in the description when isClickUp is false", () => {
    const html = renderConnectorCloneEditor(makeConnector(), [], false);
    expect(html).toContain("Jira tickets");
  });
});

// ── renderConnectorCloneEditor — ClickUp ──────────────────────────────────────

describe("renderConnectorCloneEditor (ClickUp)", () => {
  it("renders 'ClickUp tasks' in the description when isClickUp is true", () => {
    const html = renderConnectorCloneEditor(makeConnector(), projects, true);
    expect(html).toContain("ClickUp tasks");
  });

  it("renders the all-Jira-projects dropdown for ClickUp connectors", () => {
    const html = renderConnectorCloneEditor(makeConnector(), projects, true);
    expect(html).toContain("Project Alpha");
    expect(html).toContain("Dev Board");
  });
});

