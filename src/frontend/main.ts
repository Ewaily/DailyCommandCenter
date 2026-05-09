import "./styles.css";
import { api } from "./api.js";
import { applyBrand } from "./components/brand.js";
import { startClock, setTimezones, getPrimaryTz } from "./components/header.js";
import { initScheduleChips, loadSchedule, navSchedule } from "./components/schedule.js";
import { loadChannels, initChannelDigestConfig } from "./components/channel-digest.js";
import { loadMentions, bindMentionsTabs, navMentions } from "./components/mentions.js";
import { loadTickets, bindTicketTabs } from "./components/tickets.js";
import { loadPRs, bindPrTabs } from "./components/prs.js";
import { loadClickUp, bindClickUpClone } from "./components/clickup.js";
import { hydrateSettingsFromServer, getSetting } from "./state.js";
import { toast } from "./components/util.js";
import { initTheme, toggleTheme } from "./components/theme.js";
import { icons, paintIcons, startIconAutoPaint } from "./components/icons.js";
import { openPalette, closePalette, bindPalette, isPaletteOpen } from "./components/palette.js";
import { bindSettings, toggleSettings, closeSettings, isSettingsOpen } from "./components/settings.js";
import { initWorkspaceSwitcher, getActiveWorkspaceId, listWorkspaces } from "./components/workspace-switcher.js";
import { initTodayBanner } from "./components/today.js";
import { applyCardCollapse } from "./components/card-collapse.js";
import { initSidebar, toggleSidebar, loadSidebar } from "./components/sidebar.js";
import { init as initDashboard } from "./components/dashboard.js";
import { loadConnectors, applyConnectorVisibility, hasCapability } from "./connectors.js";
import { applyTitles, initInlineEditing } from "./components/widget-titles.js";
import { initOverviewWidgets, clearOverviewWidgets } from "./components/overview-widgets.js";
import { initKpiSignals, initKpiLabels } from "./components/kpi-strip.js";

function markLastRefresh() {
  const el = document.getElementById("last-refresh");
  if (!el) return;
  const t = new Date().toLocaleTimeString("en-US", { timeZone: getPrimaryTz(), hour: "numeric", minute: "2-digit", hour12: true });
  el.textContent = `↻ ${t}`;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

// Only fire loaders whose connector capability is present in the active workspace.
// This prevents any API calls (and any notConfigured renders) for disconnected tools.
async function refreshAll(silent = false) {
  const scrollY = window.scrollY;
  if (!silent) toast("Refreshing…", "info");

  const refreshBtn = document.getElementById("refresh-btn");
  refreshBtn?.classList.add("is-spinning");

  const tasks: Promise<unknown>[] = [];
  if (hasCapability("calendar"))  tasks.push(loadSchedule(silent));
  if (hasCapability("slack"))     tasks.push(loadChannels(silent), loadMentions(silent));
  if (hasCapability("jira"))      tasks.push(loadTickets(silent));
  if (hasCapability("github"))    tasks.push(loadPRs(silent));
  if (hasCapability("clickup"))   tasks.push(loadClickUp(silent));
  tasks.push(loadSidebar());

  await Promise.allSettled(tasks);

  refreshBtn?.classList.remove("is-spinning");

  if (silent) {
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
    markLastRefresh();
  }
}

// Expose for the command palette commands
(window as any).__dccRefreshAll = refreshAll;

function activeWorkspaceName(): string | undefined {
  const id = getActiveWorkspaceId();
  if (!id) return undefined;
  return listWorkspaces().find(w => w.id === id)?.name;
}

// Reload connectors, re-apply visibility, then refresh data only for what's now connected.
async function onWorkspaceChanged() {
  clearOverviewWidgets();
  applyCardCollapse();
  await loadConnectors();
  applyConnectorVisibility();
  initKpiLabels();
  await initOverviewWidgets();
  applySidebarEmptyState();
  applyTitles(activeWorkspaceName());
  await refreshAll();
}

// When a section is hidden by connector-visibility, its sidebar slot should fall
// back to a "no tools" nudge if neither calendar nor slack is present.
function applySidebarEmptyState() {
  const sidebarEmpty = document.getElementById("sidebar-empty");
  if (!sidebarEmpty) return;
  const anyVisible = hasCapability("calendar") || hasCapability("slack");
  sidebarEmpty.toggleAttribute("hidden", anyVisible);
}

function toggleHelp() {
  document.getElementById("help-modal")?.classList.toggle("open");
}

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindHeaderActions() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach(el => {
    el.addEventListener("click", () => {
      switch (el.dataset.action) {
        case "refresh-all":      return refreshAll();
        case "toggle-help":      return toggleHelp();
        case "toggle-theme":     return toggleTheme();
        case "toggle-settings":  return toggleSettings();
        case "palette":          return openPalette();
        case "schedule-prev":    return navSchedule(-1);
        case "schedule-next":    return navSchedule(1);
        case "schedule-today":   return navSchedule("today");
        case "reload-schedule":  return loadSchedule();
        case "reload-channels":   return loadChannels();
        case "reload-clickup":    return loadClickUp();
        case "reload-mentions":   return loadMentions();
        case "mentions-prev":     return navMentions(-1);
        case "mentions-next":     return navMentions(1);
        case "mentions-today":    return navMentions("today");
      }
    });
  });

  document.getElementById("help-modal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) toggleHelp();
  });

  // KPI tile click → jump to corresponding section
  document.querySelectorAll<HTMLElement>(".kpi[data-kpi-jump]").forEach(tile => {
    const target = tile.dataset.kpiJump!;
    const map: Record<string, string> = {
      schedule: "section-schedule",
      mentions: "section-mentions",
      tickets: "section-tickets",
      prs: "section-prs",
    };
    const handler = () => jump(map[target] || target);
    tile.addEventListener("click", handler);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
    });
  });
}

function bindKeyboard() {
  let g = false;
  document.addEventListener("keydown", (e) => {
    const inField = ["INPUT", "TEXTAREA"].includes((document.activeElement?.tagName) || "");

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault(); openPalette(); return;
    }
    if (e.key === "Escape") {
      if (isPaletteOpen()) { closePalette(); return; }
      if (isSettingsOpen()) { closeSettings(); return; }
      document.getElementById("help-modal")?.classList.remove("open");
      return;
    }

    if (inField) return;

    if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); toggleHelp(); return; }
    if (e.key === ",") { e.preventDefault(); toggleSettings(); return; }
    if (e.key === "]") { e.preventDefault(); toggleSidebar(); return; }
    if (e.key === "r") { e.preventDefault(); refreshAll(); return; }
    if (e.key === "t") { e.preventDefault(); toggleTheme(); return; }
    if (e.key === "g") { g = true; setTimeout(() => g = false, 800); return; }
    if (g) {
      g = false;
      if (e.key === "s") return jump("section-schedule");
      if (e.key === "c") return jump("section-channels");
      if (e.key === "m") return jump("section-mentions");
      if (e.key === "p") return jump("section-prs");
    }
  });
}

function paintHeaderIcons() {
  const set = (id: string, svg: string) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = svg;
  };
  set("refresh-btn",  icons.refresh);
  set("settings-btn", icons.settings);
  set("help-btn",     icons.help);
  paintIcons();
}

async function init() {
  paintHeaderIcons();
  startIconAutoPaint();
  initKpiSignals();
  initTheme();
  try {
    const app = await api.appSettingsGet();
    applyBrand(app.data.brand);
    setTimezones(app.data.prefs.primaryTz, app.data.prefs.secondaryTzs);
  } catch { /* brand & timezones fall back to defaults */ }
  startClock();
  await hydrateSettingsFromServer();

  // Workspace switcher first — sets active workspace id in localStorage.
  await initWorkspaceSwitcher();

  // Load connectors for the active workspace, then gate visibility before
  // anything paints. This ensures a fresh workspace shows the empty-state
  // and no skeleton loaders flash for tools that aren't connected.
  await loadConnectors();
  applyConnectorVisibility();
  initKpiLabels();
  await initOverviewWidgets();
  applySidebarEmptyState();

  await initTodayBanner();

  window.addEventListener("workspace-changed", onWorkspaceChanged);
  applyCardCollapse();
  initScheduleChips();
  bindMentionsTabs();
  bindTicketTabs();
  bindClickUpClone();
  bindPrTabs();
  bindHeaderActions();
  bindPalette();
  bindSettings();
  bindKeyboard();
  initSidebar();
  initDashboard();
  applyTitles(activeWorkspaceName());
  initInlineEditing();
  await initChannelDigestConfig();

  // Only fetch data for connected tools on first load.
  await refreshAll();

  const interval = (getSetting<number>("autoRefreshMs")) || 5 * 60 * 1000;
  setInterval(() => { if (!document.hidden) refreshAll(true); }, interval);

  // OAuth popup closes → connector now live → reload store + UI immediately.
  window.addEventListener("message", async (ev) => {
    if (ev.data?.type === "oauth-done") {
      toast(`Connected to ${ev.data.provider}`, "success");
      clearOverviewWidgets();
      await loadConnectors();
      applyConnectorVisibility();
      initKpiLabels();
      await initOverviewWidgets();
      applySidebarEmptyState();
      applyTitles(activeWorkspaceName());
      await refreshAll();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
