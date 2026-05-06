import { Router } from "express";
import { getAppSetting, getAppSettingJSON, setAppSettings } from "../lib/app-settings.js";
import { config } from "../config.js";

export type SecondaryTz = { tz: string; label: string };
export const DEFAULT_PRIMARY_TZ = "Africa/Cairo";
export const DEFAULT_SECONDARY_TZS: SecondaryTz[] = [
  { tz: "Europe/London",    label: "LON" },
  { tz: "Asia/Riyadh",      label: "RUH" },
  { tz: "America/Winnipeg", label: "YWG" },
];

function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export const appSettingsRouter = Router();

export const DEFAULT_BRAND_NAME     = "Daily Command Center";
export const DEFAULT_BRAND_SUBTITLE = "";

function readAll() {
  return {
    brand: {
      name:     getAppSetting("brand.name",     DEFAULT_BRAND_NAME),
      subtitle: getAppSetting("brand.subtitle", DEFAULT_BRAND_SUBTITLE),
    },
    prefs: {
      primaryTz:    getAppSetting("prefs.primaryTz", DEFAULT_PRIMARY_TZ) || DEFAULT_PRIMARY_TZ,
      secondaryTzs: getAppSettingJSON<SecondaryTz[]>("prefs.secondaryTzs", DEFAULT_SECONDARY_TZS),
    },
    google: {
      clientId:    getAppSetting("google.clientId",    config.google.clientId)    || null,
      clientSecret: getAppSetting("google.clientSecret", config.google.clientSecret) || null,
      hasSecret:   !!getAppSetting("google.clientSecret", config.google.clientSecret),
      redirectUri: getAppSetting("google.redirectUri", config.google.redirectUri) || null,
    },
    slack: {
      clientId:    getAppSetting("slack.clientId",    config.slack.clientId)    || null,
      clientSecret: getAppSetting("slack.clientSecret", config.slack.clientSecret) || null,
      hasSecret:   !!getAppSetting("slack.clientSecret", config.slack.clientSecret),
      redirectUri: getAppSetting("slack.redirectUri", config.slack.redirectUri) || null,
    },
    microsoft: {
      clientId:    getAppSetting("microsoft.clientId",    config.microsoft.clientId)    || null,
      clientSecret: getAppSetting("microsoft.clientSecret", config.microsoft.clientSecret) || null,
      hasSecret:   !!getAppSetting("microsoft.clientSecret", config.microsoft.clientSecret),
      redirectUri: getAppSetting("microsoft.redirectUri", config.microsoft.redirectUri) || null,
      tenantId:    getAppSetting("microsoft.tenantId",    config.microsoft.tenantId)    || null,
    },
  };
}

appSettingsRouter.get("/", (_req, res) => {
  res.json({ data: readAll() });
});

const ALLOWED_KEYS = new Set([
  "brand.name", "brand.subtitle",
  "prefs.primaryTz", "prefs.secondaryTzs",
  "google.clientId", "google.clientSecret", "google.redirectUri",
  "slack.clientId", "slack.clientSecret", "slack.redirectUri",
  "microsoft.clientId", "microsoft.clientSecret", "microsoft.redirectUri", "microsoft.tenantId",
]);

appSettingsRouter.put("/", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(k)) continue;

    if (k === "prefs.secondaryTzs") {
      if (!Array.isArray(v)) continue;
      const cleaned: SecondaryTz[] = [];
      for (const item of v.slice(0, 3)) {
        if (!item || typeof item !== "object") continue;
        const tz    = (item as any).tz;
        const label = (item as any).label;
        if (!isValidTz(tz)) continue;
        cleaned.push({ tz, label: typeof label === "string" && label ? label.slice(0, 6) : tz.split("/").pop()!.slice(0, 3).toUpperCase() });
      }
      patch[k] = cleaned;
      continue;
    }

    if (k === "prefs.primaryTz") {
      if (isValidTz(v)) patch[k] = v;
      continue;
    }

    if (typeof v !== "string") continue;
    // Brand strings are allowed to be empty (clears back to default); secrets/IDs are not.
    if (k.startsWith("brand.") || v !== "") patch[k] = v;
  }
  setAppSettings(patch);
  res.json({ data: readAll() });
});
