import { describe, it, expect, vi, beforeEach } from "vitest";

// Reset modules before each test so module-level state (panelOpen, currentConfig)
// starts fresh — without this, the toggle in test N bleeds into test N+1.
beforeEach(() => { vi.resetModules(); });

async function setup() {
  // Re-mock after every resetModules call.
  vi.mock("../../src/frontend/api.js", () => ({
    api: {
      slackDigestConfig: vi.fn().mockResolvedValue({ data: { channels: [], msgsPerChannel: 5 } }),
      saveSlackDigestConfig: vi.fn(),
      slackDigest: vi.fn().mockResolvedValue({ data: [] }),
    },
    isAuthError: vi.fn().mockReturnValue(false),
  }));
  vi.mock("../../src/frontend/connectors.js", () => ({
    hasCapability: vi.fn().mockReturnValue(true),
  }));
  vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
    return { ...actual, toast: vi.fn() };
  });

  document.body.innerHTML = `
    <button id="channels-config-btn"></button>
    <span id="channels-header-meta"></span>
    <div id="channels-config-panel"></div>
    <div id="channels-body"></div>
  `;

  const { initChannelDigestConfig } = await import(
    "../../src/frontend/components/channel-digest.js"
  );
  await initChannelDigestConfig();
  return { btn: document.getElementById("channels-config-btn")! };
}

describe("channel-digest renderPanel", () => {
  it("renders .dc-scroll-area and .dc-actions when config panel is opened", async () => {
    const { btn } = await setup();
    btn.click();

    const panel = document.getElementById("channels-config-panel")!;
    expect(panel.querySelector(".dc-scroll-area")).not.toBeNull();
    expect(panel.querySelector(".dc-actions")).not.toBeNull();
  });

  it("keeps .dc-actions outside .dc-scroll-area so Save is always reachable", async () => {
    const { btn } = await setup();
    btn.click();

    const panel = document.getElementById("channels-config-panel")!;
    const scrollArea = panel.querySelector(".dc-scroll-area")!;
    const actions = panel.querySelector(".dc-actions")!;

    expect(scrollArea).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(scrollArea.contains(actions)).toBe(false);
    expect(panel.querySelector("#dc-save-btn")).not.toBeNull();
    expect(panel.querySelector("#dc-cancel-btn")).not.toBeNull();
  });

  it("clears the config panel when cancel is clicked", async () => {
    const { btn } = await setup();
    btn.click();

    const panel = document.getElementById("channels-config-panel")!;
    expect(panel.innerHTML).not.toBe("");

    panel.querySelector<HTMLButtonElement>("#dc-cancel-btn")!.click();
    expect(panel.innerHTML).toBe("");
  });
});
