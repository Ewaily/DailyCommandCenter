// KPI tile values are written by the modules that own the underlying data:
//   #kpi-meetings → schedule.ts
//   #kpi-mentions → mentions.ts
//   #kpi-tickets  → lists.ts (loadTickets)
//   #kpi-prs      → lists.ts (loadPRs)
//
// initKpiSignals() watches actionable tiles and applies .kpi-value--signal
// (sig-now color) when they become non-zero so the spec's "color is earned"
// rule is enforced purely through DOM observation — no changes in data loaders.

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
