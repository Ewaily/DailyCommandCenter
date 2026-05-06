// Theme manager. Pre-paint init lives in index.html so we can
// apply the persisted theme without flash; this file owns runtime toggling.
import { saveSetting, getSetting } from "../state.js";
import { toast } from "./util.js";
import { icons } from "./icons.js";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return (document.documentElement.getAttribute("data-theme") as Theme) || "light";
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.innerHTML = t === "dark" ? icons.sun : icons.moon;
    const next = t === "dark" ? "light" : "dark";
    btn.setAttribute("aria-label", `Switch to ${next} theme (T)`);
    btn.setAttribute("data-tooltip", `Switch to ${next} theme · T`);
  }
  saveSetting("theme", t);
}

export function initTheme() {
  applyTheme(currentTheme());

  // React to system preference if user hasn't explicitly set one.
  if (getSetting<Theme>("theme") === undefined) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", (e) => {
      if (getSetting<Theme>("theme") === undefined) applyTheme(e.matches ? "dark" : "light");
    });
  }
}

export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  toast(`${next === "dark" ? "🌙 Dark" : "☀ Light"} mode`, "info");
}
