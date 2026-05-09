import type { SecondaryTz } from "../api.js";
import { $ } from "./util.js";
import { setPrimaryTz, getPrimaryTz } from "./tz.js";
export { getPrimaryTz };

let secondaryTzs: SecondaryTz[] = [];

// Optional first-name shown in the greeting. Sourced from brand.subtitle
// (set via brand.ts → applyBrand) so users configure it from Settings →
// Preferences without a new pref.
let displayName = "";

/**
 * Set the personalised name shown in the greeting.
 * Empty / whitespace-only values fall back to a generic greeting.
 */
export function setDisplayName(name: string): void {
  displayName = (name || "").trim();
  tick();
}

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
      <div class="wc-col" title="${escape(s.tz)}">
        <span class="wc-city">${escape(city)}</span>
        <span class="wc-time" data-wc-idx="${i}">--:--</span>
      </div>`;
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

  // Eyebrow date — uppercase mono, e.g. "FRIDAY · 09 MAY 2025"
  const dateEl = $("#header-date");
  if (dateEl) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: getPrimaryTz(),
      weekday: "long", day: "2-digit", month: "short", year: "numeric",
    }).formatToParts(now);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
    dateEl.textContent = `${get("weekday")} · ${get("day")} ${get("month")} ${get("year")}`.toUpperCase();
  }

  const greet = $("#greeting");
  if (greet) {
    const base = greetingFor(ct.hour24);
    const full = displayName ? `${base}, ${displayName}.` : base;
    if (greet.dataset.greetText !== full) {
      greet.dataset.greetText = full;
      greet.innerHTML = `<span class="pulse"></span>${escape(full)}`;
    }
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
