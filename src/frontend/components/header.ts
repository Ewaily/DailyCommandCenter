import type { SecondaryTz } from "../api.js";
import { $ } from "./util.js";
import { setPrimaryTz, getPrimaryTz } from "./tz.js";
export { getPrimaryTz };

let secondaryTzs: SecondaryTz[] = [];

export function setTimezones(primary: string, secondaries: SecondaryTz[]): void {
  setPrimaryTz(primary || "Africa/Cairo");
  secondaryTzs = (secondaries || []).slice(0, 3);

  const tzLabel = $("#primary-tz-label");
  if (tzLabel) tzLabel.textContent = getPrimaryTz().split("/").pop()!.replace(/_/g, " ");

  const wc = $("#world-clocks");
  if (wc) {
    wc.innerHTML = secondaryTzs.map((s, i) => {
      const city = s.label || s.tz.split("/").pop()!.slice(0, 3).toUpperCase();
      return `
      <span class="wc-item" title="${escape(s.tz)}">
        <span class="wc-city">${escape(city)}</span>
        <span class="wc-time" data-wc-idx="${i}">--:--</span>
      </span>`;
    }).join("");
  }

  tick();
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function setDayBounds(_events: unknown[]) {
  tick();
}

function greetingFor(hour: number): string {
  if (hour < 5)  return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function getPrimaryTime(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getPrimaryTz(),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);

  const hour   = parseInt(parts.find(p => p.type === "hour")?.value   ?? "12");
  const minute = parts.find(p => p.type === "minute")?.value ?? "00";
  const ampm   = parts.find(p => p.type === "dayPeriod")?.value ?? "AM";
  const hour24 = ampm.toUpperCase() === "AM" ? (hour % 12) : (hour % 12) + 12;

  return { hour, minute, ampm, hour24, timeStr: `${hour}:${minute}` };
}

function fmtWorldClock(now: Date, tz: string): string {
  return now.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function tick() {
  const now = new Date();
  const ct  = getPrimaryTime(now);

  const clock = $("#clock");
  if (clock) clock.textContent = ct.timeStr;

  const ampmEl = $("#clock-ampm");
  if (ampmEl) ampmEl.textContent = ct.ampm;

  const dateEl = $("#header-date");
  if (dateEl) dateEl.textContent =
    now.toLocaleDateString("en-US", {
      timeZone: getPrimaryTz(),
      weekday: "long", month: "long", day: "numeric",
    });

  const greet = $("#greeting");
  if (greet) {
    const text = greetingFor(ct.hour24);
    if (greet.lastChild?.textContent?.trim() !== text)
      greet.innerHTML = `<span class="pulse"></span>${text}`;
  }

for (let i = 0; i < secondaryTzs.length; i++) {
    const el = document.querySelector<HTMLElement>(`[data-wc-idx="${i}"]`);
    if (el) el.textContent = fmtWorldClock(now, secondaryTzs[i].tz);
  }
}

export function startClock() {
  tick();
  setInterval(tick, 30_000);
}
