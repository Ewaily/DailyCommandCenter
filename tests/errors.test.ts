import { describe, it, expect } from "vitest";
import { HttpError, NotConnectedError } from "../src/server/lib/errors.js";

describe("HttpError", () => {
  it("stores status and message", () => {
    const e = new HttpError(404, "not found");
    expect(e.status).toBe(404);
    expect(e.message).toBe("not found");
  });

  it("stores optional code", () => {
    const e = new HttpError(400, "bad", "bad_request");
    expect(e.code).toBe("bad_request");
  });

  it("is an instance of Error", () => {
    expect(new HttpError(500, "err")).toBeInstanceOf(Error);
  });

  it("code defaults to undefined when not passed", () => {
    const e = new HttpError(500, "oops");
    expect(e.code).toBeUndefined();
  });
});

describe("NotConnectedError", () => {
  it("has status 401", () => {
    const e = new NotConnectedError("google");
    expect(e.status).toBe(401);
  });

  it("message contains provider name", () => {
    const e = new NotConnectedError("slack");
    expect(e.message).toContain("slack");
  });

  it("has code not_connected", () => {
    const e = new NotConnectedError("jira");
    expect(e.code).toBe("not_connected");
  });

  it("is an instance of HttpError", () => {
    expect(new NotConnectedError("x")).toBeInstanceOf(HttpError);
  });
});
