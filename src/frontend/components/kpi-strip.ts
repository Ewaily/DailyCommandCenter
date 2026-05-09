// KPI tile values are written by the modules that own the underlying data:
//   #kpi-meetings → schedule.ts
//   #kpi-mentions → mentions.ts
//   #kpi-tickets  → tickets.ts (Jira) or clickup.ts (ClickUp), whichever is active
//   #kpi-prs      → prs.ts
//
// initKpiSignals() watches actionable tiles and applies .kpi-value--signal
// (sig-now color) when they become non-zero so the spec's "color is earned"
// rule is enforced purely through DOM observation — no changes in data loaders.
//
// initKpiLabels() must be called after loadConnectors() on every workspace change
// so the ticket tile label always names the actual connected source.

import { hasCapability } from "../connectors.js";

const ACTIONABLE_IDS = ["kpi-mentions", "kpi-prs"] as const;

function applySignal(el: HTMLElement): void {
  const raw = el.textContent?.trim() ?? "";
  const n   = parseInt(raw, 10);
  const isNonZero = !Number.isNaN(n) && n > 0;
  el.classList.toggle("kpi-value--signal", isNonZero);
}

export function initKpiSignals(): void {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target instanceof HTMLElement) applySignal(m.target);
    }
  });

  for (const id of ACTIONABLE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    applySignal(el as HTMLElement);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
  }
}

// Updates the ticket KPI eyebrow label to reflect whichever task connector(s)
// are active. Called after every connector reload (workspace switch, OAuth, etc.).
export function initKpiLabels(): void {
  const label = document.getElementById("kpi-tickets-label");
  if (!label) return;
  const hasJira    = hasCapability("jira");
  const hasClickUp = hasCapability("clickup");
  if (hasJira && hasClickUp) {
    label.textContent = "TASKS";
  } else if (hasJira) {
    label.textContent = "TICKETS · JRA";
  } else if (hasClickUp) {
    label.textContent = "TASKS · CLK";
  } else {
    label.textContent = "TASKS";
  }
}
