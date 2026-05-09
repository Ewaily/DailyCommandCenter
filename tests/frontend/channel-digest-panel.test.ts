import { describe, it, expect, vi, beforeEach } from "vitest";

// Reset modules before each test so module-level state (panelOpen, currentConfig)
// starts fresh — without this, the toggle in test N bleeds into test N+1.
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

// Top-level mock holders so vi.mock factories can reference them.
const mockApi = {
  slackDigestConfig:     vi.fn().mockResolvedValue({ data: { channels: [], msgsPerChannel: 5 } }),
  saveSlackDigestConfig: vi.fn().mockResolvedValue({ data: { channels: [], msgsPerChannel: 5 } }),
  slackDigest:           vi.fn().mockResolvedValue({ data: [], notConfigured: false }),
};
const mockToast = vi.fn();

async function setup() {
  vi.mock("../../src/frontend/api.js", () => ({
    api: mockApi,
    isAuthError: vi.fn().mockReturnValue(false),
  }));
  vi.mock("../../src/frontend/connectors.js", () => ({
    hasCapability: vi.fn().mockReturnValue(true),
  }));
  vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
    return {
      ...actual,
      toast:        (...a: any[]) => mockToast(...a),
      skeletonList: (n: number) => `<div class="skeleton">${n}</div>`,
    };
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

describe("channel-digest save button", () => {
  it("calls saveSlackDigestConfig and closes panel on success", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    panel.querySelector<HTMLButtonElement>("#dc-save-btn")!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.saveSlackDigestConfig).toHaveBeenCalled();
    expect(panel.innerHTML).toBe("");
  });

  it("shows toast and re-enables button on save failure", async () => {
    mockApi.saveSlackDigestConfig.mockRejectedValueOnce(new Error("Network error"));
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    panel.querySelector<HTMLButtonElement>("#dc-save-btn")!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Network error"), "error");
    expect(panel.querySelector<HTMLButtonElement>("#dc-save-btn")!.disabled).toBe(false);
  });
});

describe("channel-digest stepper", () => {
  it("step-up increments msgsPerChannel", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    panel.querySelector<HTMLButtonElement>("#dc-step-up")!.click();
    expect(panel.querySelector("#dc-step-val")!.textContent).toBe("6");
  });

  it("step-down decrements msgsPerChannel (capped at 1)", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    for (let i = 0; i < 6; i++) panel.querySelector<HTMLButtonElement>("#dc-step-down")!.click();
    expect(panel.querySelector("#dc-step-val")!.textContent).toBe("1");
  });
});

describe("channel-digest add-channel flow", () => {
  it("adds a channel when id is entered and + Add is clicked", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    (panel.querySelector<HTMLInputElement>("#dc-add-id")!).value = "C123456";
    (panel.querySelector<HTMLInputElement>("#dc-add-name")!).value = "my-channel";
    panel.querySelector<HTMLButtonElement>("#dc-add-btn")!.click();
    expect(panel.innerHTML).toContain("my-channel");
  });

  it("focuses id input and does not add when id is empty", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    const before = panel.querySelectorAll(".dc-channel-row").length;
    panel.querySelector<HTMLButtonElement>("#dc-add-btn")!.click();
    expect(panel.querySelectorAll(".dc-channel-row").length).toBe(before);
  });

  it("Enter key in id input triggers add", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    const idInput = panel.querySelector<HTMLInputElement>("#dc-add-id")!;
    idInput.value = "C_ENTER";
    idInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(panel.innerHTML).toContain("C_ENTER");
  });

  it("does not add duplicate channel id", async () => {
    const { btn } = await setup();
    btn.click();
    const panel = document.getElementById("channels-config-panel")!;
    (panel.querySelector<HTMLInputElement>("#dc-add-id")!).value = "C_DUP";
    panel.querySelector<HTMLButtonElement>("#dc-add-btn")!.click();
    // Second add with same id
    (panel.querySelector<HTMLInputElement>("#dc-add-id")!).value = "C_DUP";
    panel.querySelector<HTMLButtonElement>("#dc-add-btn")!.click();
    const rows = panel.querySelectorAll(".dc-channel-row");
    expect(rows.length).toBe(1);
  });
});

describe("channel-digest keydown on channel head", () => {
  it("Enter key on channel head toggles open state", async () => {
    mockApi.slackDigest.mockResolvedValue({
      data: [{ channelId: "C1", channelName: "general", messages: [], permalink: "" }],
      notConfigured: false,
    });
    const { loadChannels } = await import("../../src/frontend/components/channel-digest.js");
    await loadChannels();
    const head = document.querySelector<HTMLElement>(".dg-channel-head")!;
    head.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector(".dg-channel")!.classList.contains("is-open")).toBe(true);
  });

  it("Space key on channel head toggles open state", async () => {
    mockApi.slackDigest.mockResolvedValue({
      data: [{ channelId: "C1", channelName: "random", messages: [], permalink: "" }],
      notConfigured: false,
    });
    const { loadChannels } = await import("../../src/frontend/components/channel-digest.js");
    await loadChannels();
    const head = document.querySelector<HTMLElement>(".dg-channel-head")!;
    head.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(document.querySelector(".dg-channel")!.classList.contains("is-open")).toBe(true);
  });
});
