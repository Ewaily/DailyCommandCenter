import { toast } from "./components/util.js";

const RELEASES_API  = "https://api.github.com/repos/Ewaily/DailyCommandCenter/releases/latest";
const RELEASES_PAGE = "https://github.com/Ewaily/DailyCommandCenter/releases/latest";

export const APP_VERSION = "v1.0.0";

/** Parse a semver tag (with or without leading "v") into [major, minor, patch]. */
export function parseSemver(tag: string): [number, number, number] {
  const m = tag.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * Returns true when `candidate` is strictly greater than `current`.
 * Both strings may include a leading "v".
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current);
  const [nMaj, nMin, nPat] = parseSemver(candidate);
  if (nMaj !== cMaj) return nMaj > cMaj;
  if (nMin !== cMin) return nMin > cMin;
  return nPat > cPat;
}

/**
 * Fetches the latest GitHub release and shows a persistent update toast
 * if a newer version exists. Fails silently on network / parse errors
 * and on 404 (no releases published yet).
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const res = await fetch(RELEASES_API);
    if (!res.ok) return; // 404 = no releases yet; any other error → skip silently
    const json = await res.json() as { tag_name?: string };
    const tag = json.tag_name;
    if (!tag || !isNewerVersion(APP_VERSION, tag)) return;

    toast(`✨ New update available: ${tag}. Click to download.`, {
      type: "update",
      duration: 0,
      action: {
        label: "Download",
        onClick: () => window.open(RELEASES_PAGE, "_blank", "noopener,noreferrer"),
      },
    });
  } catch {
    // network failure or JSON parse error — never surface to the user
  }
}
