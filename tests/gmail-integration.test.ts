import { describe, it, expect } from "vitest";
import { isConfigured, listPriorityInbox } from "../src/server/integrations/gmail.js";

describe("gmail integration (stub)", () => {
  it("isConfigured returns false", () => {
    expect(isConfigured()).toBe(false);
  });

  it("listPriorityInbox returns empty array", async () => {
    const result = await listPriorityInbox();
    expect(result).toEqual([]);
  });
});
