import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApiWorkspace, mockGetActiveWorkspaceId } = vi.hoisted(() => ({
  mockApiWorkspace:         vi.fn(),
  mockGetActiveWorkspaceId: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/frontend/api.js", () => ({
  api: { workspace: (...a: any[]) => mockApiWorkspace(...a) },
}));

vi.mock("../../src/frontend/components/workspace-switcher.js", () => ({
  getActiveWorkspaceId: (...a: any[]) => mockGetActiveWorkspaceId(...a),
}));

import { applyCardCollapse } from "../../src/frontend/components/card-collapse.js";

function setupCards() {
  document.body.innerHTML = `
    <div id="section-prs"></div>
    <div id="section-tickets"></div>
    <div id="section-deadlines"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWorkspaceId.mockReturnValue(null);
  setupCards();
});

describe("applyCardCollapse", () => {
  it("shows all cards when no active workspace", async () => {
    mockGetActiveWorkspaceId.mockReturnValue(null);
    await applyCardCollapse();
    expect(document.getElementById("section-prs")!.classList.contains("is-collapsed")).toBe(false);
    expect(document.getElementById("section-tickets")!.classList.contains("is-collapsed")).toBe(false);
    expect(document.getElementById("section-deadlines")!.classList.contains("is-collapsed")).toBe(false);
  });

  it("collapses PR section when no enabled github connector", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockResolvedValue({ data: { connectors: [] } });
    await applyCardCollapse();
    expect(document.getElementById("section-prs")!.classList.contains("is-collapsed")).toBe(true);
  });

  it("shows PR section when github connector with identityId is enabled", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockResolvedValue({
      data: { connectors: [{ type: "github", identityId: "id-1", enabled: true }] },
    });
    await applyCardCollapse();
    expect(document.getElementById("section-prs")!.classList.contains("is-collapsed")).toBe(false);
  });

  it("collapses PR section when github connector has no identityId", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockResolvedValue({
      data: { connectors: [{ type: "github", identityId: null, enabled: true }] },
    });
    await applyCardCollapse();
    expect(document.getElementById("section-prs")!.classList.contains("is-collapsed")).toBe(true);
  });

  it("collapses PR section when github connector is disabled", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockResolvedValue({
      data: { connectors: [{ type: "github", identityId: "id-1", enabled: false }] },
    });
    await applyCardCollapse();
    expect(document.getElementById("section-prs")!.classList.contains("is-collapsed")).toBe(true);
  });

  it("shows deadlines section when jira connector is enabled", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockResolvedValue({
      data: { connectors: [{ type: "jira", identityId: "id-1", enabled: true }] },
    });
    await applyCardCollapse();
    expect(document.getElementById("section-deadlines")!.classList.contains("is-collapsed")).toBe(false);
  });

  it("shows deadlines section when notion connector is enabled", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockResolvedValue({
      data: { connectors: [{ type: "notion", identityId: "id-1", enabled: true }] },
    });
    await applyCardCollapse();
    expect(document.getElementById("section-deadlines")!.classList.contains("is-collapsed")).toBe(false);
  });

  it("returns early when workspace API call throws", async () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    mockApiWorkspace.mockRejectedValue(new Error("network error"));
    await expect(applyCardCollapse()).resolves.toBeUndefined();
  });

  it("does not throw when card elements are absent from DOM", async () => {
    document.body.innerHTML = ""; // no card elements
    mockGetActiveWorkspaceId.mockReturnValue(null);
    await expect(applyCardCollapse()).resolves.toBeUndefined();
  });
});
