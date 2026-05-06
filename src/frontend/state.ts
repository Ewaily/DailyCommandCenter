// Lightweight settings cache backed by localStorage; best-effort sync to server.
import { api } from "./api.js";

const KEY = "dcc-settings";

type SettingsBag = Record<string, unknown>;

let cache: SettingsBag = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
})();

export function getSetting<T = unknown>(key: string): T | undefined {
  return cache[key] as T | undefined;
}

export function saveSetting(key: string, value: unknown) {
  cache[key] = value;
  localStorage.setItem(KEY, JSON.stringify(cache));
  api.settingsPut({ [key]: value }).catch(() => { /* server may be down; localStorage covers */ });
}

export async function hydrateSettingsFromServer() {
  try {
    const { data } = await api.settingsGet();
    cache = { ...cache, ...data };
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}
