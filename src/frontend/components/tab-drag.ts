// Universal tab drag-to-reorder engine.
//
// Mark a tab container:  data-tab-reorder="<group>"
// Mark each tab button:  data-tab-id="<stable-id>"
//
// The engine delegates from the document, so dynamically-rendered tabs (Jira,
// ClickUp) automatically inherit reordering without any per-widget wiring.
// Tab clicks work normally — drag only activates after a 5 px pointer movement.

export const TAB_ORDER_KEY = "dcc-tab-order-v1";

const DRAG_THRESHOLD = 5;   // px of movement before drag starts
const SLIDE_MS       = 180; // sibling slide transition duration

// ── Persistence ──────────────────────────────────────────────────────────────

export function loadTabOrder(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || "{}"); }
  catch { return {}; }
}

function saveTabOrder(map: Record<string, string[]>): void {
  localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(map));
}

export function resetTabOrder(): void {
  localStorage.removeItem(TAB_ORDER_KEY);
}

// Restore persisted order for a group. Called on page load and after dynamic
// tab renders (Jira/ClickUp rebuild their containers on each data fetch).
export function applyTabOrder(group: string): void {
  const container = document.querySelector<HTMLElement>(`[data-tab-reorder="${group}"]`);
  if (!container) return;
  const order = loadTabOrder()[group];
  if (!order?.length) return;
  const tabs = Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"));
  const byId = new Map(tabs.map(t => [t.dataset.tabId!, t]));
  for (const id of order) {
    const node = byId.get(id);
    if (node) container.appendChild(node);
  }
}

// ── Drag state ───────────────────────────────────────────────────────────────

interface DragState {
  container: HTMLElement;
  group:     string;
  tab:       HTMLElement;
  tabId:     string;
  startX:    number;
  startY:    number;
  isDragging: boolean;
  origIndex: number;
  step:      number;   // tab width + gap
  targetIndex: number;
}

let drag: DragState | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTabs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"));
}

function clearStyles(tabs: HTMLElement[]): void {
  for (const t of tabs) {
    t.style.transition  = "";
    t.style.transform   = "";
    t.style.zIndex      = "";
    t.style.position    = "";
    t.style.flexShrink  = "";
    t.style.pointerEvents = "";
  }
}

// ── Pointer handlers ──────────────────────────────────────────────────────────

function onPointerDown(e: PointerEvent): void {
  // Only primary button; skip if inside a button's inner interactive element.
  if (e.button !== 0) return;
  const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-tab-reorder] [data-tab-id]");
  if (!tab) return;
  const container = tab.closest<HTMLElement>("[data-tab-reorder]")!;
  const group     = container.dataset.tabReorder!;
  const tabId     = tab.dataset.tabId!;
  const tabs      = getTabs(container);
  const origIndex = tabs.indexOf(tab);

  // Measure step (width + gap) from first two tabs when possible.
  let step = tab.getBoundingClientRect().width + 8;
  if (tabs.length > 1) {
    const r0 = tabs[0].getBoundingClientRect();
    const r1 = tabs[1].getBoundingClientRect();
    step = r1.left - r0.left;
  }

  drag = {
    container, group, tab, tabId,
    startX: e.clientX, startY: e.clientY,
    isDragging: false,
    origIndex,
    step,
    targetIndex: origIndex,
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup",     onPointerUp,     { once: true });
  document.addEventListener("pointercancel", onPointerUp,     { once: true });
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;

  // ── Enter drag mode once threshold exceeded ──
  if (!drag.isDragging) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.isDragging = true;

    // Snapshot flex width so siblings don't reflow while transforms are live.
    getTabs(drag.container).forEach(t => { t.style.flexShrink = "0"; });

    // Elevate the dragged tab.
    drag.tab.style.position    = "relative";
    drag.tab.style.zIndex      = "50";
    drag.tab.style.pointerEvents = "none";
    drag.tab.classList.add("tab-dragging");
    document.body.classList.add("tabs-dragging-active");
  }

  // Follow the pointer.
  drag.tab.style.transform = `translateX(${dx}px) scale(1.05)`;

  // Compute target slot.
  const rawIndex    = drag.origIndex + Math.round(dx / drag.step);
  const tabs        = getTabs(drag.container);
  const targetIndex = Math.max(0, Math.min(tabs.length - 1, rawIndex));
  drag.targetIndex  = targetIndex;

  // Slide siblings to open a gap at the target slot.
  tabs.forEach((t, i) => {
    if (t === drag!.tab) return;
    let shift = 0;
    if (drag!.origIndex < targetIndex && i > drag!.origIndex && i <= targetIndex) {
      shift = -drag!.step;
    } else if (drag!.origIndex > targetIndex && i >= targetIndex && i < drag!.origIndex) {
      shift = drag!.step;
    }
    t.style.transition = `transform ${SLIDE_MS}ms ease`;
    t.style.transform  = shift ? `translateX(${shift}px)` : "";
  });

  e.preventDefault(); // prevent scroll while dragging horizontally
}

function onPointerUp(): void {
  document.removeEventListener("pointermove", onPointerMove);
  document.body.classList.remove("tabs-dragging-active");

  if (!drag) return;
  const { container, group, tab, origIndex, targetIndex, isDragging } = drag;

  if (isDragging) {
    const tabs = getTabs(container);

    // Block the click that fires after pointerup from triggering the tab switch.
    document.addEventListener("click", e => e.stopPropagation(), { capture: true, once: true });

    // Clear all live styles before committing the DOM reorder.
    clearStyles(tabs);
    tab.classList.remove("tab-dragging");

    // Commit the new order in the DOM.
    if (targetIndex !== origIndex) {
      tabs.splice(origIndex, 1);
      tabs.splice(targetIndex, 0, tab);
      tabs.forEach(t => container.appendChild(t));

      // Persist.
      const ids = tabs.map(t => t.dataset.tabId!).filter(Boolean);
      const map = loadTabOrder();
      map[group] = ids;
      saveTabOrder(map);
    }
  }

  drag = null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTabDrag(): void {
  document.addEventListener("pointerdown", onPointerDown);
}
