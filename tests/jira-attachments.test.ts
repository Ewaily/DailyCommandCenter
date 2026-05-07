// Unit tests for the new Jira attachment functions: getIssueDetails,
// downloadJiraFile, and uploadAttachment.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getIssueDetails,
  getIssueDescription,
  getIssueAttachments,
  downloadJiraFile,
  uploadAttachment,
  type JiraCreds,
} from "../src/server/integrations/jira.js";

const creds: JiraCreds = {
  baseUrl:  "https://test.atlassian.net",
  email:    "user@test.com",
  apiToken: "tok",
};

afterEach(() => vi.restoreAllMocks());

// ── getIssueDetails ───────────────────────────────────────────────────────────

describe("getIssueDetails", () => {
  it("returns description and image/video attachments from a single API call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        fields: {
          description: { type: "doc", version: 1, content: [] },
          attachment: [
            { filename: "shot.png",  content: "https://cdn/shot.png",  mimeType: "image/png",  size: 1024 },
            { filename: "clip.mp4",  content: "https://cdn/clip.mp4",  mimeType: "video/mp4",  size: 2048 },
            { filename: "notes.txt", content: "https://cdn/notes.txt", mimeType: "text/plain", size: 512  },
          ],
        },
      }),
    }));

    const result = await getIssueDetails(creds, "PROJ-1");

    expect(result.description).toEqual({ type: "doc", version: 1, content: [] });
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]).toEqual({ filename: "shot.png", url: "https://cdn/shot.png", mimeType: "image/png", size: 1024 });
    expect(result.attachments[1]).toEqual({ filename: "clip.mp4", url: "https://cdn/clip.mp4", mimeType: "video/mp4", size: 2048 });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("fields=description,attachment");
    expect(url).toContain("PROJ-1");
  });

  it("returns null description and empty attachments when fields are absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ fields: {} }),
    }));
    const result = await getIssueDetails(creds, "X-1");
    expect(result.description).toBeNull();
    expect(result.attachments).toEqual([]);
  });

  it("returns empty fallback when the API call throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await getIssueDetails(creds, "FAIL-1");
    expect(result.description).toBeNull();
    expect(result.attachments).toEqual([]);
  });

  it("handles attachment with missing size (defaults to 0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        fields: {
          description: null,
          attachment: [{ filename: "x.jpg", content: "https://cdn/x.jpg", mimeType: "image/jpeg" }],
        },
      }),
    }));
    const result = await getIssueDetails(creds, "P-1");
    expect(result.attachments[0].size).toBe(0);
  });
});

// ── getIssueDescription / getIssueAttachments (compat wrappers) ──────────────

describe("getIssueDescription (compat)", () => {
  it("delegates to getIssueDetails and returns the description", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ fields: { description: { type: "doc", version: 1, content: [] }, attachment: [] } }),
    }));
    const desc = await getIssueDescription(creds, "PROJ-10");
    expect(desc).toEqual({ type: "doc", version: 1, content: [] });
  });
});

describe("getIssueAttachments (compat)", () => {
  it("delegates to getIssueDetails and returns only media attachments", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        fields: {
          description: null,
          attachment: [
            { filename: "a.png",  content: "https://cdn/a.png",  mimeType: "image/png",  size: 100 },
            { filename: "b.pdf",  content: "https://cdn/b.pdf",  mimeType: "application/pdf", size: 200 },
          ],
        },
      }),
    }));
    const atts = await getIssueAttachments(creds, "PROJ-20");
    expect(atts).toHaveLength(1);
    expect(atts[0].filename).toBe("a.png");
  });
});

// ── downloadJiraFile ──────────────────────────────────────────────────────────

describe("downloadJiraFile", () => {
  it("downloads and returns buffer + mimeType on success", async () => {
    const fakeData = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === "content-type" ? "image/png" : h === "content-length" ? "3" : null },
      arrayBuffer: () => Promise.resolve(fakeData),
    }));
    const result = await downloadJiraFile(creds, "https://cdn/img.png");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.buffer.byteLength).toBe(3);
  });

  it("strips charset from content-type", async () => {
    const fakeData = new Uint8Array([0]).buffer;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === "content-type" ? "image/jpeg; charset=utf-8" : "1" },
      arrayBuffer: () => Promise.resolve(fakeData),
    }));
    const result = await downloadJiraFile(creds, "https://cdn/img.jpg");
    expect(result!.mimeType).toBe("image/jpeg");
  });

  it("returns null when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await downloadJiraFile(creds, "https://cdn/x.png")).toBeNull();
  });

  it("returns null when content-length exceeds 25 MB", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === "content-length" ? String(26 * 1024 * 1024) : null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    expect(await downloadJiraFile(creds, "https://cdn/huge.png")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await downloadJiraFile(creds, "https://cdn/x.png")).toBeNull();
  });

  it("sends the correct Authorization header", async () => {
    const fakeData = new ArrayBuffer(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(fakeData),
    }));
    await downloadJiraFile(creds, "https://cdn/x.png");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });
});

// ── uploadAttachment ──────────────────────────────────────────────────────────

describe("uploadAttachment", () => {
  it("POSTs multipart form data with X-Atlassian-Token: no-check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const buf = Buffer.from("fake-image");
    await uploadAttachment(creds, "PROJ-5", "screenshot.png", buf, "image/png");

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://test.atlassian.net/rest/api/2/issue/PROJ-5/attachments");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Atlassian-Token"]).toBe("no-check");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws when the API returns a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: () => Promise.resolve("File too large"),
    }));
    await expect(
      uploadAttachment(creds, "PROJ-5", "big.mp4", Buffer.from("x"), "video/mp4"),
    ).rejects.toThrow("413");
  });
});
