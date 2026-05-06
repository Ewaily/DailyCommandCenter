import { api, isAuthError, type CalendarEvent } from "../api.js";
import { $, escapeHtml, fmtTime, fmtDuration, offsetDateInTz, renderNotConnected, renderWorkspaceNotConfigured, stripFwdPrefix, skeletonList, animateNumber } from "./util.js";
import { setDayBounds } from "./header.js";
import { getPrimaryTz } from "./tz.js";
import { saveSetting, getSetting } from "../state.js";

export type ScheduleFilter = "all" | "mine" | "needs-response" | "hide-focus";

const state = {
  offset: 0,
  filter: (getSetting("scheduleFilter") as ScheduleFilter) || "all",
};

export function initScheduleChips() {
  document.querySelectorAll<HTMLElement>("#schedule-chips .chip").forEach(c => {
    if (c.dataset.filter === state.filter) c.classList.add("active");
    else c.classList.remove("active");
    c.addEventListener("click", () => {
      document.querySelectorAll("#schedule-chips .chip").forEach(x => x.classList.remove("active"));
      c.classList.add("active");
      state.filter = (c.dataset.filter as ScheduleFilter) || "all";
      saveSetting("scheduleFilter", state.filter);
      loadSchedule();
    });
  });
}

export function navSchedule(delta: number | "today") {
  if (delta === "today") state.offset = 0;
  else state.offset += delta;
  loadSchedule();
}

function applyFilter(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter(e => {
    if (state.filter === "hide-focus" && e.isFocus) return false;
    if (state.filter === "mine" && (e.responseStatus !== "accepted" || e.isFocus)) return false;
    if (state.filter === "needs-response" && e.responseStatus !== "needsAction") return false;
    return true;
  });
}

function eventClass(e: CalendarEvent, now: number): string {
  const start = new Date(e.start).getTime();
  const end = new Date(e.end).getTime();
  if (now >= start && now <= end) return "is-now";
  if (now > end) return "is-past";
  return "";
}

function renderEvent(e: CalendarEvent, now: number): string {
  const time = e.isAllDay ? "All day" : fmtTime(e.start);
  const dur = e.isAllDay ? "" : fmtDuration(e.durationMinutes);
  const dimClass = e.responseStatus === "declined" ? "dim" : "";
  const stateClass = eventClass(e, now);

  const badgeMap: Record<string, string> = {
    new:       `<span class="badge badge-new">NEW today</span>`,
    respond:   `<span class="badge badge-urgent">Respond</span>`,
    tentative: `<span class="badge badge-info">Tentative</span>`,
    declined:  `<span class="badge badge-warning">Declined</span>`,
    focus:     `<span class="badge badge-focus">Focus</span>`,
  };
  const order = ["new", "respond", "tentative", "declined", "focus"];
  const badges = order.filter(b => e.badges.includes(b as any))
    .slice(0, 2).map(b => badgeMap[b]).join("");

  const metaParts: string[] = [];
  if (e.attendeeCount) metaParts.push(`👥 ${e.attendeeCount}`);
  if (e.meetUrl) metaParts.push(`<a href="${escapeHtml(e.meetUrl)}" target="_blank">📹 Meet</a>`);
  if (e.htmlLink) metaParts.push(`<a href="${escapeHtml(e.htmlLink)}" target="_blank">↗ Calendar</a>`);
  const meta = metaParts.length ? metaParts.join('<span class="meta-sep">·</span>') : "";

  const stripeStyle = e.sourceColor ? ` style="--source-color:${escapeHtml(e.sourceColor)}"` : "";
  const stripeClass = e.sourceColor ? " has-source-stripe" : "";
  const sourceTitle = e.sourceLabel ? ` title="${escapeHtml(e.sourceLabel)}"` : "";

  return `
    <div class="schedule-item ${stateClass}${stripeClass}"${stripeStyle}${sourceTitle}>
      <div class="schedule-time">${time}<small>${dur}</small></div>
      <div class="schedule-content">
        <div class="schedule-title-row">
          <span class="schedule-title ${dimClass}">${escapeHtml(stripFwdPrefix(e.title))}</span>
          ${badges}
        </div>
        ${meta ? `<div class="schedule-meta">${meta}</div>` : ""}
      </div>
    </div>
  `;
}

function emptyState(): string {
  return `<div class="empty">
    <span class="emoji">🌤️</span>
    <div class="empty-title">Nothing on the calendar</div>
    <div>Enjoy the breathing room.</div>
    <div class="empty-hint">Tip: press <kbd>R</kbd> to refresh, or <kbd>⌘</kbd>+<kbd>K</kbd> to jump anywhere.</div>
  </div>`;
}

export async function loadSchedule(silent = false) {
  const body = $("#schedule-body")!;
  const summary = $("#schedule-summary")!;
  const dayLabel = $("#schedule-day-label")!;
  const { label, startIso, endIso } = offsetDateInTz(state.offset, getPrimaryTz());
  dayLabel.textContent = state.offset === 0 ? "Today" : label;

  if (!silent) body.innerHTML = skeletonList(4);
  try {
    const resp = await api.calendarEvents(startIso, endIso);
    if (resp.notConfigured) {
      body.innerHTML = renderWorkspaceNotConfigured("Calendar");
      summary.textContent = "—";
      animateNumber($("#kpi-meetings"), 0);
      const detail = $("#kpi-meetings-detail");
      if (detail) detail.textContent = "Not in this workspace";
      return;
    }
    const data = resp.data;
    const events = applyFilter(data);

    if (state.offset === 0) {
      const accepted = data.filter(e => !e.isFocus && e.responseStatus !== "declined");
      animateNumber($("#kpi-meetings"), accepted.length);
      const newCount = data.filter(e => e.isCreatedToday).length;
      const detail = $("#kpi-meetings-detail");
      if (detail) detail.textContent = newCount > 0 ? `${newCount} added today` : `${data.length} on calendar`;
      setDayBounds(data);
    }

    summary.textContent = `${events.length} shown`;
    if (!events.length) {
      body.innerHTML = emptyState();
      return;
    }

    // Insert a "now" line if today and a current event exists
    const now = state.offset === 0 ? Date.now() : -1;
    const sorted = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    let inserted = false;
    const chunks: string[] = [];
    for (const e of sorted) {
      const start = new Date(e.start).getTime();
      if (state.offset === 0 && !inserted && now < start) {
        chunks.push(`<div class="now-line">Now · ${new Date().toLocaleTimeString("en-US", { timeZone: getPrimaryTz(), hour: "numeric", minute: "2-digit", hour12: true })}</div>`);
        inserted = true;
      }
      chunks.push(renderEvent(e, now));
    }
    if (state.offset === 0 && !inserted && sorted.length) {
      // Day already wrapped — append the marker at the end
      chunks.push(`<div class="now-line">Now · day wrapped</div>`);
    }
    body.innerHTML = chunks.join("");
  } catch (err) {
    if (isAuthError(err)) body.innerHTML = renderNotConnected("Google Calendar", "google");
    else body.innerHTML = `<div class="error">Calendar error: ${escapeHtml((err as Error).message)}</div>`;
  }
}
