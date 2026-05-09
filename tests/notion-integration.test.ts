import { describe, it, expect, vi } from "vitest";

const { mockGetNotionConfig, mockGetActiveWorkspaceId } = vi.hoisted(() => ({
  mockGetNotionConfig:      vi.fn().mockReturnValue(null),
  mockGetActiveWorkspaceId: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../src/server/config.js", () => ({
  config: { notion: { token: "", databaseIds: [] } },
}));

vi.mock("../src/server/lib/workspace-config.js", () => ({
  getNotionConfig: mockGetNotionConfig,
}));

vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: mockGetActiveWorkspaceId,
}));

import { isConfigured, listDeadlines } from "../src/server/integrations/notion.js";

describe("notion integration", () => {
  it("isConfigured returns false when no token or databaseIds", () => {
    mockGetNotionConfig.mockReturnValue(null);
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured returns true when token + databaseIds present", () => {
    mockGetNotionConfig.mockReturnValue({ token: "ntn_tok", databaseIds: ["db-1"] });
    expect(isConfigured()).toBe(true);
  });

  it("isConfigured uses provided workspaceId", () => {
    mockGetNotionConfig.mockReturnValue({ token: "t", databaseIds: ["d"] });
    expect(isConfigured("ws-42")).toBe(true);
    expect(mockGetNotionConfig).toHaveBeenCalledWith("ws-42");
  });

  it("isConfigured falls back to active workspace", () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-active");
    mockGetNotionConfig.mockReturnValue(null);
    expect(isConfigured()).toBe(false);
    expect(mockGetNotionConfig).toHaveBeenCalledWith("ws-active");
  });

  it("listDeadlines returns empty array (stub)", async () => {
    expect(await listDeadlines()).toEqual([]);
  });
});
