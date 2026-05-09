import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHasCapability } = vi.hoisted(() => ({
  mockHasCapability: vi.fn(),
}));

vi.mock("../../src/frontend/connectors.js", () => ({
  hasCapability: mockHasCapability,
}));

import { initKpiLabels, initKpiSignals } from "../../src/frontend/components/kpi-strip.js";

function setupDom(ids: string[]) {
  document.body.innerHTML = ids.map(id => `<span id="${id}"></span>`).join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasCapability.mockReturnValue(false);
});

describe("initKpiLabels", () => {
  beforeEach(() => {
    document.body.innerHTML = `<span id="kpi-tickets-label"></span>`;
  });

  it("shows TASKS when neither jira nor clickup is connected", () => {
    mockHasCapability.mockReturnValue(false);
    initKpiLabels();
    expect(document.getElementById("kpi-tickets-label")!.textContent).toBe("TASKS");
  });

  it("shows TICKETS · JRA when only jira is connected", () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "jira");
    initKpiLabels();
    expect(document.getElementById("kpi-tickets-label")!.textContent).toBe("TICKETS · JRA");
  });

  it("shows TASKS · CLK when only clickup is connected", () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "clickup");
    initKpiLabels();
    expect(document.getElementById("kpi-tickets-label")!.textContent).toBe("TASKS · CLK");
  });

  it("shows TASKS when both jira and clickup are connected", () => {
    mockHasCapability.mockReturnValue(true);
    initKpiLabels();
    expect(document.getElementById("kpi-tickets-label")!.textContent).toBe("TASKS");
  });

  it("does not throw when label element is missing", () => {
    document.body.innerHTML = "";
    expect(() => initKpiLabels()).not.toThrow();
  });
});

describe("initKpiSignals", () => {
  it("adds kpi-value--signal class when element has non-zero number", () => {
    document.body.innerHTML = `<span id="kpi-mentions">3</span><span id="kpi-prs">0</span>`;
    initKpiSignals();
    expect(document.getElementById("kpi-mentions")!.classList.contains("kpi-value--signal")).toBe(true);
    expect(document.getElementById("kpi-prs")!.classList.contains("kpi-value--signal")).toBe(false);
  });

  it("does not add signal class when element shows zero", () => {
    document.body.innerHTML = `<span id="kpi-mentions">0</span><span id="kpi-prs">0</span>`;
    initKpiSignals();
    expect(document.getElementById("kpi-mentions")!.classList.contains("kpi-value--signal")).toBe(false);
  });

  it("does not add signal class when element is empty", () => {
    document.body.innerHTML = `<span id="kpi-mentions"></span><span id="kpi-prs"></span>`;
    initKpiSignals();
    expect(document.getElementById("kpi-mentions")!.classList.contains("kpi-value--signal")).toBe(false);
  });

  it("does not throw when actionable elements are missing from DOM", () => {
    document.body.innerHTML = "";
    expect(() => initKpiSignals()).not.toThrow();
  });

  it("applies signal class reactively via MutationObserver when text changes", async () => {
    document.body.innerHTML = `<span id="kpi-mentions">0</span><span id="kpi-prs">0</span>`;
    initKpiSignals();
    const el = document.getElementById("kpi-mentions")!;
    el.textContent = "5";
    await new Promise(r => setTimeout(r, 0));
    expect(el.classList.contains("kpi-value--signal")).toBe(true);
  });

  it("removes signal class reactively when value drops to zero", async () => {
    document.body.innerHTML = `<span id="kpi-mentions">5</span><span id="kpi-prs">0</span>`;
    initKpiSignals();
    const el = document.getElementById("kpi-mentions")!;
    el.textContent = "0";
    await new Promise(r => setTimeout(r, 0));
    expect(el.classList.contains("kpi-value--signal")).toBe(false);
  });
});
