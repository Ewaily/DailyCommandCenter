import { api, isAuthError, type Mention } from "../api.js";
import { $, escapeHtml, renderNotConnected, renderWorkspaceNotConfigured, skeletonList, animateNumber } from "./util.js";

// Day offset from today: 0 = today, -1 = yesterday, etc.
let dayOffset = 0;
let cachedData: Mention[] = [];

import { getPrimaryTz } from "./tz.js";
const TZ = () => getPrimaryTz();

function dayLabel(offset: number): string {
  if (offset === 0) return "Today";
  if (offset === -1) return "Yesterday";
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-US", { timeZone: TZ(), weekday: "short", month: "short", day: "numeric" });
}

function isOnDay(ts: string, offset: number): boolean {
  const msgDate = new Date(Number(ts.split(".")[0]) * 1000);
  const target  = new Date();
  target.setDate(target.getDate() + offset);
  return (
    msgDate.toLocaleDateString("en-US", { timeZone: TZ() }) ===
    target.toLocaleDateString("en-US", { timeZone: TZ() })
  );
}

function renderMention(m: Mention): string {
  const source = m.isDm ? "" : escapeHtml(m.channelName ? "#" + m.channelName + " · " : "");
  return `
    <div class="mention-item ${m.urgent ? "urgent" : ""}">
      <div class="mention-meta">
        <span class="author">${escapeHtml(m.authorName || "Unknown")}</span>
        <span>${source}${escapeHtml(m.tsHuman || "")}</span>
      </div>
      <div class="mention-text">${m.html || escapeHtml(m.text || "")}</div>
      ${m.permalink ? `<a class="slack-channel-link" href="${escapeHtml(m.permalink)}" target="_blank" style="font-size:11px;">Reply in Slack ↗</a>` : ""}
    </div>`;
}

function renderBody() {
  const body = $("#mentions-body");
  if (!body) return;

  const items = cachedData.filter(m => isOnDay(m.ts, dayOffset));

  // Update day label + nav button states
  const labelEl = document.getElementById("mentions-day-label");
  const todayBtn = document.getElementById("mentions-today-btn");
  if (labelEl) labelEl.textContent = dayLabel(dayOffset);
  if (todayBtn) todayBtn.classList.toggle("active", dayOffset === 0);

  // Can't navigate into the future
  document.querySelectorAll<HTMLElement>("[data-action='mentions-next']").forEach(btn => {
    btn.style.opacity = dayOffset >= 0 ? "0.35" : "";
    btn.style.pointerEvents = dayOffset >= 0 ? "none" : "";
  });

  if (!items.length) {
    const label = dayLabel(dayOffset).toLowerCase();
    body.innerHTML = `<div class="empty">
      <span class="emoji">✨</span>
      <div class="empty-title">Nothing ${label}</div>
      <div class="empty-hint">No mentions or DMs ${label === "today" ? "since midnight" : "on this day"}</div>
    </div>`;
    return;
  }

  body.innerHTML = items.map(renderMention).join("");
}

function updateKpi() {
  const todayItems = cachedData.filter(m => isOnDay(m.ts, 0));
  animateNumber($("#kpi-mentions"), todayItems.length);
  const detail = $("#kpi-mentions-detail");
  if (detail) {
    detail.textContent = todayItems.length
      ? `${todayItems.length} today`
      : "None today";
  }
}

export function navMentions(dir: -1 | 1 | "today") {
  if (dir === "today") { dayOffset = 0; }
  else if (dir === 1 && dayOffset < 0) { dayOffset += 1; }
  else if (dir === -1) { dayOffset -= 1; }
  renderBody();
}

export async function loadMentions(silent = false) {
  const body = $("#mentions-body");
  if (!body) return;
  if (!silent) body.innerHTML = skeletonList(4);
  try {
    const resp = await api.mentions(4, !silent);
    if (resp.notConfigured) {
      body.innerHTML = renderWorkspaceNotConfigured("Slack");
      cachedData = [];
      const v = $("#kpi-mentions"); if (v) v.textContent = "—";
      const d = $("#kpi-mentions-detail"); if (d) d.textContent = "Not in this workspace";
      return;
    }
    cachedData = resp.data;
    updateKpi();
    renderBody();
  } catch (err) {
    if (isAuthError(err)) {
      body.innerHTML = renderNotConnected("Slack", "slack");
      const v = $("#kpi-mentions"); if (v) v.textContent = "—";
      const d = $("#kpi-mentions-detail"); if (d) d.textContent = "Not connected";
    } else {
      body.innerHTML = `<div class="error">Mentions error: ${escapeHtml((err as Error).message)}</div>`;
    }
  }
}

export function bindMentionsTabs() {
  // no-op — kept for import compatibility; wiring is in main.ts bindHeaderActions
}

export interface MentionsInstance {
  load(silent?: boolean): Promise<void>;
}

export function instantiateMentions(
  container: HTMLElement,
  connectorId: string,
  opts: { wsName: string; title: string }
): MentionsInstance {
  const { wsName, title } = opts;
  let instanceDayOffset = 0;
  let instanceCachedData: Mention[] = [];

  container.innerHTML = `
    <div class="card-header">
      <div class="title-row">
        <span class="title-source">${escapeHtml(wsName)}</span>
        <span class="title-text">
          <span class="title-icon" data-icon="bell"></span>
          <span>${escapeHtml(title)}</span>
        </span>
        <span class="header-meta" data-ov-day-label>Today</span>
      </div>
      <div class="tabs">
        <button class="tab tab-icon" data-ov-nav="prev" data-icon="chevronLeft" aria-label="Previous day"></button>
        <button class="tab active" data-ov-nav="today">Today</button>
        <button class="tab tab-icon" data-ov-nav="next" data-icon="chevronRight" aria-label="Next day"></button>
      </div>
    </div>
    <div class="card-body main-tall" data-ov-body></div>
  `;

  const body = container.querySelector<HTMLElement>("[data-ov-body]")!;
  const dayLabelEl = container.querySelector<HTMLElement>("[data-ov-day-label]");
  const todayBtn = container.querySelector<HTMLElement>("[data-ov-nav='today']");
  const nextBtn = container.querySelector<HTMLElement>("[data-ov-nav='next']");

  function updateNavState() {
    if (todayBtn) todayBtn.classList.toggle("active", instanceDayOffset === 0);
    if (nextBtn) {
      nextBtn.style.opacity = instanceDayOffset >= 0 ? "0.35" : "";
      nextBtn.style.pointerEvents = instanceDayOffset >= 0 ? "none" : "";
    }
    if (dayLabelEl) dayLabelEl.textContent = dayLabel(instanceDayOffset);
  }

  function renderBodyLocal() {
    const items = instanceCachedData.filter(m => isOnDay(m.ts, instanceDayOffset));
    updateNavState();
    if (!items.length) {
      const label = dayLabel(instanceDayOffset).toLowerCase();
      body.innerHTML = `<div class="empty">
        <span class="emoji">✨</span>
        <div class="empty-title">Nothing ${label}</div>
        <div class="empty-hint">No mentions or DMs ${label === "today" ? "since midnight" : "on this day"}</div>
      </div>`;
      return;
    }
    body.innerHTML = items.map(renderMention).join("");
  }

  container.querySelector("[data-ov-nav='prev']")?.addEventListener("click", () => { instanceDayOffset--; renderBodyLocal(); });
  container.querySelector("[data-ov-nav='today']")?.addEventListener("click", () => { instanceDayOffset = 0; renderBodyLocal(); });
  container.querySelector("[data-ov-nav='next']")?.addEventListener("click", () => {
    if (instanceDayOffset < 0) { instanceDayOffset++; renderBodyLocal(); }
  });

  async function load(silent = false): Promise<void> {
    if (!silent) body.innerHTML = skeletonList(4);
    try {
      const resp = await api.mentions(4, !silent, connectorId);
      if (resp.notConfigured) {
        body.innerHTML = renderWorkspaceNotConfigured("Slack");
        instanceCachedData = [];
        return;
      }
      instanceCachedData = resp.data;
      renderBodyLocal();
    } catch (err) {
      if (isAuthError(err)) {
        body.innerHTML = renderNotConnected("Slack", "slack");
      } else {
        body.innerHTML = `<div class="error">Mentions error: ${escapeHtml((err as Error).message)}</div>`;
      }
    }
  }

  return { load };
}
