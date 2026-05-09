import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetPrimaryTz } =
  vi.hoisted(() => ({
    mockApi: {
      mentions: vi.fn(),
      settingsPut: vi.fn().mockResolvedValue({}),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetPrimaryTz: vi.fn().mockReturnValue("UTC"),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: vi.fn().mockReturnValue(undefined), saveSetting: vi.fn() }));
vi.mock("../../src/frontend/components/tz.js", () => ({ getPrimaryTz: mockGetPrimaryTz }));
vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
  return { ...actual, animateNumber: vi.fn() };
});

import { instantiateMentions } from "../../src/frontend/components/mentions.js";

function makeContainer() { return document.createElement("div"); }

// Pin the clock to noon UTC on a fixed date so all day-boundary math is stable
const FIXED_NOW = new Date("2026-05-06T12:00:00.000Z");
const NOW_SEC   = Math.floor(FIXED_NOW.getTime() / 1000);
const PREV_SEC  = NOW_SEC - 86_400; // exactly 24 h earlier → 2026-05-05T12:00:00Z

// Build a Mention with ts = seconds since epoch (Slack format)
function makeMention(overrides: Partial<{
  text: string; channelName: string; authorName: string;
  ts: string; urgent: boolean; isDm: boolean; permalink: string;
}> = {}) {
  return {
    channelId: "C1", channelName: "general", isDm: false,
    ts: `${NOW_SEC}.000000`,
    tsHuman: "12:00 PM",
    authorId: "U1", authorName: "Alice", authorAvatar: null,
    text: "Hey @here", html: "<p>Hey @here</p>",
    permalink: "https://slack.com/archives/C1/p12345",
    urgent: false,
    ...overrides,
  };
}

// Yesterday's mention (pinned to 2026-05-05T12:00:00Z)
// html is set to "" so renderMention falls back to the text field.
function makeOldMention() {
  return makeMention({ ts: `${PREV_SEC}.000000`, text: "Old message", authorName: "Bob", html: "" } as any);
}

const okResp = (items = [makeMention()]) =>
  Promise.resolve({ data: items, notConfigured: false });

const notConfiguredResp = () =>
  Promise.resolve({ data: [], notConfigured: true });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.clearAllMocks();
  mockGetPrimaryTz.mockReturnValue("UTC");
  mockIsAuthError.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── structure ──────────────────────────────────────────────────────────────
describe("instantiateMentions — HTML structure", () => {
  it("renders title-source and title-text", () => {
    mockApi.mentions.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateMentions(c, "conn-1", { wsName: "Acme · dave", title: "Mentions" });
    expect(c.querySelector(".title-source")?.textContent).toBe("Acme · dave");
    expect(c.querySelector(".title-text")?.textContent?.trim()).toContain("Mentions");
  });

  it("renders the three day-navigation buttons", () => {
    mockApi.mentions.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    expect(c.querySelector("[data-ov-nav='prev']")).toBeTruthy();
    expect(c.querySelector("[data-ov-nav='today']")).toBeTruthy();
    expect(c.querySelector("[data-ov-nav='next']")).toBeTruthy();
  });

  it("shows 'Today' as default day label", () => {
    mockApi.mentions.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    expect(c.querySelector("[data-ov-day-label]")?.textContent).toBe("Today");
  });

  it("renders the card-body container", () => {
    mockApi.mentions.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    expect(c.querySelector("[data-ov-body]")).toBeTruthy();
  });
});

// ── load() ────────────────────────────────────────────────────────────────
describe("instantiateMentions — load()", () => {
  it("passes connectorId to api.mentions", async () => {
    mockApi.mentions.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-abc", { wsName: "WS", title: "Mentions" });
    await inst.load();
    expect(mockApi.mentions).toHaveBeenCalledWith(4, expect.any(Boolean), "conn-abc");
  });

  it("renders notConfigured state", async () => {
    mockApi.mentions.mockResolvedValue(notConfiguredResp());
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("Slack");
  });

  it("renders today's mention items", async () => {
    mockApi.mentions.mockResolvedValue(okResp([makeMention(), makeMention({ text: "Another" })]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();
    expect(c.querySelectorAll("[data-ov-body] .mention-item").length).toBe(2);
  });

  it("renders empty state when no mentions today", async () => {
    // Return only a yesterday mention — today's view should be empty
    mockApi.mentions.mockResolvedValue(okResp([makeOldMention()]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();
    expect(c.querySelector("[data-ov-body] .empty")).toBeTruthy();
  });

  it("renders error on network failure", async () => {
    mockApi.mentions.mockRejectedValue(new Error("slack unreachable"));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("slack unreachable");
  });

  it("renders not-connected on auth error", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockApi.mentions.mockRejectedValue(new Error("401"));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.innerHTML).toContain("not-connected");
  });

  it("includes a permalink link when mention has one", async () => {
    mockApi.mentions.mockResolvedValue(okResp([makeMention({ permalink: "https://slack.com/p/123" })]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();
    const link = c.querySelector<HTMLAnchorElement>(".slack-channel-link");
    expect(link?.href).toContain("slack.com");
  });
});

// ── day navigation ─────────────────────────────────────────────────────────
describe("instantiateMentions — day navigation", () => {
  it("prev nav shows yesterday's mentions", async () => {
    const todayM = makeMention({ text: "Today mention" });
    const yestM  = makeOldMention();
    mockApi.mentions.mockResolvedValue(okResp([todayM, yestM]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();

    // Navigate to yesterday
    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();

    const body = c.querySelector("[data-ov-body]")!;
    expect(body.querySelectorAll(".mention-item").length).toBe(1);
    expect(body.textContent).toContain("Bob"); // yesterday's mention, not today's Alice
  });

  it("day label changes after prev click", async () => {
    mockApi.mentions.mockResolvedValue(okResp([]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();

    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();
    expect(c.querySelector("[data-ov-day-label]")?.textContent).not.toBe("Today");
  });

  it("today nav resets label and shows today's items", async () => {
    mockApi.mentions.mockResolvedValue(okResp([makeMention()]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();

    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();
    c.querySelector<HTMLElement>("[data-ov-nav='today']")!.click();

    expect(c.querySelector("[data-ov-day-label]")?.textContent).toBe("Today");
    expect(c.querySelectorAll("[data-ov-body] .mention-item").length).toBe(1);
  });

  it("next nav is disabled when already on today", async () => {
    mockApi.mentions.mockResolvedValue(okResp([]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();

    const nextBtn = c.querySelector<HTMLElement>("[data-ov-nav='next']")!;
    expect(nextBtn.style.pointerEvents).toBe("none");
  });

  it("next nav re-enables after navigating to past", async () => {
    mockApi.mentions.mockResolvedValue(okResp([]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();

    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();
    const nextBtn = c.querySelector<HTMLElement>("[data-ov-nav='next']")!;
    expect(nextBtn.style.pointerEvents).not.toBe("none");
  });

  it("next nav from day -1 moves back to today", async () => {
    mockApi.mentions.mockResolvedValue(okResp([makeMention()]));
    const c = makeContainer();
    const inst = instantiateMentions(c, "conn-1", { wsName: "WS", title: "Mentions" });
    await inst.load();

    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click(); // offset -1
    c.querySelector<HTMLElement>("[data-ov-nav='next']")!.click(); // offset 0
    expect(c.querySelector("[data-ov-day-label]")?.textContent).toBe("Today");
  });
});

// ── instance isolation ─────────────────────────────────────────────────────
describe("instantiateMentions — instance isolation", () => {
  it("two instances call api.mentions with their own connectorIds", async () => {
    mockApi.mentions.mockResolvedValue(okResp());
    const c1 = makeContainer();
    const c2 = makeContainer();
    const i1 = instantiateMentions(c1, "conn-A", { wsName: "WS-A", title: "Mentions" });
    const i2 = instantiateMentions(c2, "conn-B", { wsName: "WS-B", title: "Mentions" });
    await Promise.all([i1.load(), i2.load()]);
    const ids = (mockApi.mentions as ReturnType<typeof vi.fn>).mock.calls.map(([,, id]) => id);
    expect(ids).toContain("conn-A");
    expect(ids).toContain("conn-B");
  });

  it("day navigation on one instance does not affect the other", async () => {
    mockApi.mentions.mockResolvedValue(okResp([]));
    const c1 = makeContainer();
    const c2 = makeContainer();
    const i1 = instantiateMentions(c1, "conn-A", { wsName: "WS-A", title: "Mentions" });
    const i2 = instantiateMentions(c2, "conn-B", { wsName: "WS-B", title: "Mentions" });
    await Promise.all([i1.load(), i2.load()]);

    c1.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();

    expect(c1.querySelector("[data-ov-day-label]")?.textContent).not.toBe("Today");
    expect(c2.querySelector("[data-ov-day-label]")?.textContent).toBe("Today");
  });
});

