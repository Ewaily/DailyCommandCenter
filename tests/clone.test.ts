import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCloneAdf, createIssue, listProjectsWith, type JiraCreds } from "../src/server/integrations/jira.js";
import { extractCloningConfig } from "../src/server/routes/tickets.js";
import { pickClickUpCloningConfig } from "../src/server/routes/clickup.js";

// ── buildCloneAdf ─────────────────────────────────────────────────────────────

describe("buildCloneAdf", () => {
  it("returns a valid ADF doc envelope", () => {
    const adf = buildCloneAdf("ClickUp", "https://app.clickup.com/t/abc123", "");
    expect(adf.type).toBe("doc");
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  it("contains exactly one node (blockquote) when body is empty", () => {
    const adf = buildCloneAdf("ClickUp", "https://app.clickup.com/t/abc123", "");
    expect(adf.content).toHaveLength(1);
    expect((adf.content[0] as any).type).toBe("blockquote");
  });

  it("contains a blockquote + paragraph when body is non-empty", () => {
    const adf = buildCloneAdf("Jira", "https://jira.company.com/browse/PROJ-1", "Bug description here");
    expect(adf.content).toHaveLength(2);
    expect((adf.content[0] as any).type).toBe("blockquote");
    expect((adf.content[1] as any).type).toBe("paragraph");
    expect((adf.content[1] as any).content[0].text).toBe("Bug description here");
  });

  it("trims the body before deciding whether to append a paragraph", () => {
    const adf = buildCloneAdf("Jira", "https://jira.company.com/browse/PROJ-2", "   \n  ");
    expect(adf.content).toHaveLength(1);
  });

  it("includes the correct link mark on the blockquote text node", () => {
    const url = "https://app.clickup.com/t/xyz999";
    const adf = buildCloneAdf("ClickUp", url, "");
    const paragraph = (adf.content[0] as any).content[0];
    const textNode  = paragraph.content[0];
    expect(textNode.text).toBe("🔄 Cloned from ClickUp");
    expect(textNode.marks).toHaveLength(1);
    expect(textNode.marks[0].type).toBe("link");
    expect(textNode.marks[0].attrs.href).toBe(url);
  });

  it("uses 'Jira' as the provider label when sourceProvider is jira", () => {
    const adf = buildCloneAdf("Jira", "https://jira.company.com/browse/X-1", "");
    const textNode = (adf.content[0] as any).content[0].content[0];
    expect(textNode.text).toBe("🔄 Cloned from Jira");
  });

  it("uses 'ClickUp' as the provider label when sourceProvider is clickup", () => {
    const adf = buildCloneAdf("ClickUp", "https://app.clickup.com/t/1", "");
    const textNode = (adf.content[0] as any).content[0].content[0];
    expect(textNode.text).toBe("🔄 Cloned from ClickUp");
  });
});

// ── createIssue ───────────────────────────────────────────────────────────────

const creds: JiraCreds = { baseUrl: "https://test.atlassian.net", email: "test@example.com", apiToken: "tok" };

describe("createIssue", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /rest/api/3/issue and returns key + id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ key: "PROJ-42", id: "10042" }),
    }));
    const result = await createIssue(creds, {
      projectKey: "PROJ",
      summary: "Test issue",
      descriptionAdf: { type: "doc", version: 1, content: [] },
    });
    expect(result.key).toBe("PROJ-42");
    expect(result.id).toBe("10042");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test.atlassian.net/rest/api/3/issue");
    expect(init.method).toBe("POST");
  });

  it("throws when Jira returns a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad request — issuetype unknown"),
    }));
    await expect(createIssue(creds, { projectKey: "P", summary: "X", descriptionAdf: {} }))
      .rejects.toThrow("400");
  });
});

// ── listProjectsWith ───────────────────────────────────────────────────────────

describe("listProjectsWith", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns an array of {id, key, name} objects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        values: [
          { id: "10000", key: "PROJ", name: "Project Alpha" },
          { id: "10001", key: "DEV",  name: "Dev Board"     },
        ],
      }),
    }));
    const projects = await listProjectsWith(creds);
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ id: "10000", key: "PROJ", name: "Project Alpha" });
    expect(projects[1]).toEqual({ id: "10001", key: "DEV",  name: "Dev Board"     });
  });

  it("returns an empty array when values is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }));
    const projects = await listProjectsWith(creds);
    expect(projects).toEqual([]);
  });
});

// ── extractCloningConfig ──────────────────────────────────────────────────────

describe("extractCloningConfig", () => {
  it("returns cloningEnabled:false and empty project when config is empty", () => {
    expect(extractCloningConfig({})).toEqual({ cloningEnabled: false, defaultTargetProject: "" });
  });

  it("returns cloningEnabled:true when flag is truthy", () => {
    expect(extractCloningConfig({ cloningEnabled: true })).toMatchObject({ cloningEnabled: true });
  });

  it("returns cloningEnabled:false when flag is falsy", () => {
    expect(extractCloningConfig({ cloningEnabled: false })).toMatchObject({ cloningEnabled: false });
  });

  it("returns the defaultTargetProject string", () => {
    expect(extractCloningConfig({ cloningEnabled: true, defaultTargetProject: "PROJ" }))
      .toMatchObject({ defaultTargetProject: "PROJ" });
  });

  it("returns empty string for defaultTargetProject when value is not a string", () => {
    expect(extractCloningConfig({ defaultTargetProject: 123 }))
      .toMatchObject({ defaultTargetProject: "" });
  });
});

// ── pickClickUpCloningConfig ──────────────────────────────────────────────────

describe("pickClickUpCloningConfig", () => {
  const makeResolved = (id: string, cfg: Record<string, unknown>) => ({
    workspaceId: "ws-1" as string | undefined,
    instance: { id, config: cfg } as any,
  });

  it("returns the first connector's config when no scopeId given", () => {
    const resolved = [
      makeResolved("c1", { cloningEnabled: true, defaultTargetProject: "FIRST" }),
      makeResolved("c2", { cloningEnabled: false, defaultTargetProject: "SECOND" }),
    ];
    expect(pickClickUpCloningConfig(resolved)).toMatchObject({ defaultTargetProject: "FIRST" });
  });

  it("returns the scoped connector's config when scopeId matches", () => {
    const resolved = [
      makeResolved("c1", { cloningEnabled: false, defaultTargetProject: "FIRST" }),
      makeResolved("c2", { cloningEnabled: true,  defaultTargetProject: "SECOND" }),
    ];
    expect(pickClickUpCloningConfig(resolved, "c2")).toMatchObject({ defaultTargetProject: "SECOND" });
  });

  it("returns disabled defaults when resolved list is empty", () => {
    expect(pickClickUpCloningConfig([])).toEqual({ cloningEnabled: false, defaultTargetProject: "" });
  });

  it("returns disabled defaults when scopeId does not match any connector", () => {
    const resolved = [makeResolved("c1", { cloningEnabled: true, defaultTargetProject: "P" })];
    expect(pickClickUpCloningConfig(resolved, "missing")).toEqual({ cloningEnabled: false, defaultTargetProject: "" });
  });
});

// ── clone route input validation (pure logic, no Express) ────────────────────

function validateClonePayload(body: Record<string, unknown>): string | null {
  const { title, originalLink, targetJiraProjectId, sourceProvider } = body;
  if (!title || !originalLink || !targetJiraProjectId || !sourceProvider) {
    return "title, originalLink, targetJiraProjectId, and sourceProvider are required";
  }
  return null;
}

describe("clone route payload validation", () => {
  it("returns null when all required fields are present", () => {
    expect(validateClonePayload({
      sourceProvider: "clickup",
      title: "Fix login bug",
      originalLink: "https://app.clickup.com/t/abc",
      targetJiraProjectId: "PROJ",
    })).toBeNull();
  });

  it("returns an error string when title is missing", () => {
    expect(validateClonePayload({
      sourceProvider: "jira",
      originalLink: "https://jira.co/browse/X-1",
      targetJiraProjectId: "PROJ",
    })).toBeTruthy();
  });

  it("returns an error string when originalLink is missing", () => {
    expect(validateClonePayload({
      sourceProvider: "jira",
      title: "Some title",
      targetJiraProjectId: "PROJ",
    })).toBeTruthy();
  });

  it("returns an error string when targetJiraProjectId is missing", () => {
    expect(validateClonePayload({
      sourceProvider: "clickup",
      title: "Some title",
      originalLink: "https://app.clickup.com/t/1",
    })).toBeTruthy();
  });

  it("returns an error string when sourceProvider is missing", () => {
    expect(validateClonePayload({
      title: "Some title",
      originalLink: "https://app.clickup.com/t/1",
      targetJiraProjectId: "PROJ",
    })).toBeTruthy();
  });
});
