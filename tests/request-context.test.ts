import { describe, it, expect } from "vitest";
import { getActiveWorkspaceId, workspaceContext } from "../src/server/lib/request-context.js";

function makeReq(query: Record<string, string>) {
  return { query } as any;
}

function runMiddleware(req: any): Promise<void> {
  return new Promise<void>((resolve) => {
    workspaceContext(req, {} as any, () => resolve());
  });
}

describe("getActiveWorkspaceId", () => {
  it("returns undefined outside of a request context", () => {
    expect(getActiveWorkspaceId()).toBeUndefined();
  });
});

describe("workspaceContext middleware", () => {
  it("calls next()", async () => {
    await expect(runMiddleware(makeReq({}))).resolves.toBeUndefined();
  });

  it("sets workspaceId when workspace query param is provided", async () => {
    let captured: string | undefined;
    await new Promise<void>((resolve) => {
      workspaceContext(makeReq({ workspace: "ws-99" }), {} as any, () => {
        captured = getActiveWorkspaceId();
        resolve();
      });
    });
    expect(captured).toBe("ws-99");
  });

  it("sets workspaceId to undefined when workspace query is empty string", async () => {
    let captured: string | undefined = "not-yet-set" as any;
    await new Promise<void>((resolve) => {
      workspaceContext(makeReq({ workspace: "" }), {} as any, () => {
        captured = getActiveWorkspaceId();
        resolve();
      });
    });
    expect(captured).toBeUndefined();
  });

  it("sets workspaceId to undefined when no workspace param", async () => {
    let captured: string | undefined = "not-yet-set" as any;
    await new Promise<void>((resolve) => {
      workspaceContext(makeReq({}), {} as any, () => {
        captured = getActiveWorkspaceId();
        resolve();
      });
    });
    expect(captured).toBeUndefined();
  });
});
