import { api, isAuthError, type CalendarEvent, type Mention } from "../api.js";
import { escapeHtml, fmtDateTime, stripFwdPrefix } from "./util.js";
import { hasCapability } from "../connectors.js";

const KEY = "dcc-sidebar-open";

function host() { return document.getElementById("universal-sidebar"); }
function isOpen() { return document.body.classList.contains("sidebar-open"); }

export function openSidebar() {
  document.body.classList.add("sidebar-open");
  localStorage.setItem(KEY, "1");
  loadSidebar();
}
export function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  localStorage.removeItem(KEY);
}
export function toggleSidebar() {
  if (isOpen()) closeSidebar(); else openSidebar();
}

export function initSidebar() {
  if (localStorage.getItem(KEY) === "1") {
    document.body.classList.add("sidebar-open");
    loadSidebar();
  }
  host()?.querySelector("[data-action='sidebar-close']")?.addEventListener("click", closeSidebar);
  window.addEventListener("workspace-changed", () => { if (isOpen()) loadSidebar(); });
}

export async function loadSidebar() {
  if (!isOpen()) return;
  const tasks: Promise<void>[] = [];
  if (hasCapability("calendar")) tasks.push(loadNextEvents());
  if (hasCapability("slack"))    tasks.push(loadRecentMentions());
  await Promise.all(tasks);
}

async function loadNextEvents() {
  const slot = document.getElementById("sidebar-events");
  if (!slot) return;
  slot.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const { data } = await api.calendarEvents(start, end);
    const now = Date.now();
    const upcoming = data
      .filter((e: CalendarEvent) => new Date(e.end).getTime() >= now && e.responseStatus !== "declined")
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 3);
    if (!upcoming.length) {
      slot.innerHTML = `<div class="muted">Nothing upcoming.</div>`;
      return;
    }
    slot.innerHTML = upcoming.map(eventRow).join("");
  } catch (err) {
    slot.innerHTML = isAuthError(err)
      ? `<div class="muted">Calendar not connected.</div>`
      : `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

function eventRow(e: CalendarEvent): string {
  const stripe = e.sourceColor ? `style="--source-color:${escapeHtml(e.sourceColor)}"` : "";
  const t = e.isAllDay ? "All day" : fmtDateTime(e.start);
  return `
    <a class="sidebar-event ${e.sourceColor ? "has-source-stripe" : ""}" ${stripe} href="${escapeHtml(e.htmlLink || "#")}" target="_blank">
      <span class="sidebar-event-time">${t}</span>
      <span class="sidebar-event-title">${escapeHtml(stripFwdPrefix(e.title))}</span>
    </a>
  `;
}

async function loadRecentMentions() {
  const slot = document.getElementById("sidebar-mentions");
  if (!slot) return;
  slot.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const { data } = await api.mentions(3);
    const recent = data.slice(0, 5);
    if (!recent.length) {
      slot.innerHTML = `<div class="muted">No recent mentions.</div>`;
      return;
    }
    slot.innerHTML = recent.map(mentionRow).join("");
  } catch (err) {
    slot.innerHTML = isAuthError(err)
      ? `<div class="muted">Slack not connected.</div>`
      : `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

function mentionRow(m: Mention): string {
  return `
    <a class="sidebar-mention" href="${escapeHtml(m.permalink)}" target="_blank">
      <span class="sidebar-mention-meta">
        <span class="sidebar-mention-author">${escapeHtml(m.authorName)}</span>
        <span class="sidebar-mention-channel muted">#${escapeHtml(m.channelName)}</span>
      </span>
      <span class="sidebar-mention-text">${escapeHtml(m.text.slice(0, 120))}</span>
    </a>
  `;
}
