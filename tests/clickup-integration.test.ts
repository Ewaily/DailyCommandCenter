// Unit tests for clickup.ts integration functions added in this PR:
// getTaskDescription, getTaskAttachments, downloadClickUpFile.
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock workspace-config and request-context so effective() resolves creds
// without hitting the DB.
vi.mock("../src/server/lib/workspace-config.js", () => ({
  getClickUpConfig: vi.fn().mockReturnValue({
    token: "cu-token-123",
    teamId: "team-1",
    spaceIds: [],
  }),
}));
vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: vi.fn().mockReturnValue("ws-1"),
}));
vi.mock("../src/server/config.js", () => ({
  config: { clickup: { token: "", teamId: "", spaceIds: [] } },
}));

import {
  getTaskDescription,
  getTaskAttachments,
  downloadClickUpFile,
} from "../src/server/integrations/clickup.js";

afterEach(() => vi.restoreAllMocks());

// ── getTaskDescription ────────────────────────────────────────────────────────

describe("getTaskDescription", () => {
  it("returns markdown_description when present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markdown_description: "# Heading\nSome text", description: "plain" }),
    }));
    const result = await getTaskDescription("task-1");
    expect(result).toBe("# Heading\nSome text");
  });

  it("falls back to description when markdown_description is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ description: "plain fallback" }),
    }));
    const result = await getTaskDescription("task-2");
    expect(result).toBe("plain fallback");
  });

  it("returns null when both fields are empty strings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markdown_description: "  ", description: "" }),
    }));
    expect(await getTaskDescription("task-3")).toBeNull();
  });

  it("returns null when the API throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await getTaskDescription("task-err")).toBeNull();
  });

  it("requests include_markdown_description=true in the URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markdown_description: "md" }),
    }));
    await getTaskDescription("abc123");
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("include_markdown_description=true");
    expect(url).toContain("abc123");
  });
});

// ── getTaskAttachments ────────────────────────────────────────────────────────

describe("getTaskAttachments", () => {
  it("returns only media files filtered by extension", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        attachments: [
          { id: "a1", title: "screenshot.png",  url: "https://cdn/s.png",  size: 1024 },
          { id: "a2", title: "recording.mp4",   url: "https://cdn/r.mp4",  size: 2048 },
          { id: "a3", title: "notes.docx",       url: "https://cdn/n.docx", size: 512  },
          { id: "a4", title: "photo.jpg",        url: "https://cdn/p.jpg",  size: 800  },
        ],
      }),
    }));
    const atts = await getTaskAttachments("task-1");
    expect(atts).toHaveLength(3);
    expect(atts.map(a => a.title)).toEqual(["screenshot.png", "recording.mp4", "photo.jpg"]);
  });

  it("returns empty array when task has no attachments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ attachments: null }),
    }));
    expect(await getTaskAttachments("task-empty")).toEqual([]);
  });

  it("returns empty array when the API throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("error")));
    expect(await getTaskAttachments("task-err")).toEqual([]);
  });

  it("defaults size to 0 when not provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        attachments: [{ id: "a1", title: "img.png", url: "https://cdn/img.png" }],
      }),
    }));
    const atts = await getTaskAttachments("task-nosize");
    expect(atts[0].size).toBe(0);
  });
});

// ── downloadClickUpFile ───────────────────────────────────────────────────────

describe("downloadClickUpFile", () => {
  it("downloads and returns buffer + mimeType on success", async () => {
    const fakeData = new Uint8Array([10, 20, 30]).buffer;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === "content-type" ? "image/png" : h === "content-length" ? "3" : null },
      arrayBuffer: () => Promise.resolve(fakeData),
    }));
    const result = await downloadClickUpFile("https://cdn/img.png");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.buffer.byteLength).toBe(3);
  });

  it("strips charset suffix from content-type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === "content-type" ? "video/mp4; codecs=avc1" : "10" },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    }));
    const result = await downloadClickUpFile("https://cdn/v.mp4");
    expect(result!.mimeType).toBe("video/mp4");
  });

  it("returns null when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await downloadClickUpFile("https://cdn/x.png")).toBeNull();
  });

  it("returns null when content-length exceeds 25 MB", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === "content-length" ? String(26 * 1024 * 1024) : null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    expect(await downloadClickUpFile("https://cdn/huge.mp4")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await downloadClickUpFile("https://cdn/x.png")).toBeNull();
  });

  it("passes an Authorization header to the CDN fetch call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    }));
    await downloadClickUpFile("https://cdn/x.png");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://cdn/x.png");
    expect(init.headers).toHaveProperty("Authorization");
  });
});
