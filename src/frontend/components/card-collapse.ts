// Auto-collapse empty cards in workspace mode.
//
// Card → required connector type(s):
//   section-prs       → github
//   section-tickets   → jira
//   section-deadlines → jira | notion
//
// Schedule, mentions, and channels are universal/identity-level — never collapsed.

import { api } from "../api.js";
import { getActiveWorkspaceId } from "./workspace-switcher.js";

const RULES: { cardId: string; types: string[] }[] = [
  { cardId: "section-prs",       types: ["github"] },
  { cardId: "section-tickets",   types: ["jira"] },
  { cardId: "section-deadlines", types: ["jira", "notion"] },
];

export async function applyCardCollapse() {
  const wsId = getActiveWorkspaceId();
  if (!wsId) {
    RULES.forEach(r => setCollapsed(r.cardId, false));
    return;
  }
  let connectors: { type: string; identityId: string | null; enabled: boolean }[] = [];
  try {
    const r = await api.workspace(wsId);
    connectors = r.data.connectors;
  } catch {
    return;
  }
  for (const rule of RULES) {
    const has = rule.types.some(t =>
      connectors.some(c => c.type === t && c.enabled && !!c.identityId),
    );
    setCollapsed(rule.cardId, !has);
  }
}

function setCollapsed(cardId: string, collapsed: boolean) {
  const el = document.getElementById(cardId);
  if (!el) return;
  el.classList.toggle("is-collapsed", collapsed);
}
