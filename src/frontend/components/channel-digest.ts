import { api, isAuthError, type SlackMsg, type ChannelDigest, type DigestConfig } from "../api.js";
import { $, escapeHtml, renderNotConnected, renderWorkspaceNotConfigured, skeletonList, toast } from "./util.js";
import { hasCapability } from "../connectors.js";

function renderMessage(m: SlackMsg): string {
  return `
    <div class="slack-msg">
      <div class="msg-head">
        <span class="author">${escapeHtml(m.authorName || "Unknown")}</span>
        <span class="ts">${escapeHtml(m.tsHuman || "")}</span>
      </div>
      <div class="text">${m.html || escapeHtml(m.text || "")}</div>
      ${m.permalink ? `<a class="dg-msg-link" href="${escapeHtml(m.permalink)}" target="_blank">Reply ↗</a>` : ""}
    </div>`;
}

function previewText(m: SlackMsg | undefined): string {
  if (!m) return "";
  const raw = (m.text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return raw.length > 140 ? raw.slice(0, 140) + "…" : raw;
}

function renderChannelTile(ch: ChannelDigest): string {
  const latest = ch.messages[0];
  const slackUrl = ch.permalink || `https://app.slack.com/client/-/${ch.channelId}`;
  const count = ch.messages.length;
  const preview = previewText(latest);

  return `
    <div class="dg-channel">
      <div class="dg-channel-head" role="button" tabindex="0" aria-expanded="false">
        <span class="dg-channel-name">#${escapeHtml(ch.channelName)}</span>
        <span class="dg-channel-count" title="${count} recent messages">${count}</span>
        <span class="dg-channel-chevron" aria-hidden="true">▾</span>
      </div>
      <div class="dg-channel-preview">
        ${latest ? `
          <div class="dg-preview-meta">
            <span class="dg-preview-author">${escapeHtml(latest.authorName || "Unknown")}</span>
            <span class="dg-preview-time">${escapeHtml(latest.tsHuman || "")}</span>
          </div>
          <div class="dg-preview-text">${escapeHtml(preview) || '<span class="dim">No text</span>'}</div>
        ` : '<div class="dg-preview-empty">No recent messages</div>'}
      </div>
      <div class="dg-channel-thread">
        ${ch.messages.length ? ch.messages.map(renderMessage).join("") : '<div class="dg-preview-empty">No recent messages</div>'}
        <a class="dg-channel-link" href="${escapeHtml(slackUrl)}" target="_blank">Open #${escapeHtml(ch.channelName)} in Slack ↗</a>
      </div>
    </div>`;
}

// ---- Config panel ----

let currentConfig: DigestConfig = { channels: [], msgsPerChannel: 5 };
let panelOpen = false;

function metaEl() { return document.getElementById("channels-header-meta"); }
function panelEl() { return document.getElementById("channels-config-panel"); }
function configBtn() { return document.getElementById("channels-config-btn"); }

function updateMeta() {
  const el = metaEl();
  if (el) el.textContent = `${currentConfig.msgsPerChannel} msgs · ${currentConfig.channels.length} channels`;
}

function renderPanel() {
  const el = panelEl();
  if (!el) return;
  if (!panelOpen) { el.innerHTML = ""; return; }

  const channelRows = currentConfig.channels.map((ch, i) => `
    <div class="dc-channel-row" data-idx="${i}" draggable="true">
      <span class="dc-drag-handle" title="Drag to reorder">⠿</span>
      <span class="dc-channel-name">#${escapeHtml(ch.name)}</span>
      <span class="dc-channel-id">${escapeHtml(ch.id)}</span>
      <button class="dc-remove-btn" data-remove="${i}" title="Remove channel">✕</button>
    </div>`).join("");

  el.innerHTML = `
    <div class="digest-config-panel">
      <div class="dc-scroll-area">
        <div class="dc-section-label">Channels</div>
        <div class="dc-channels-list" id="dc-channels-list">
          ${channelRows || '<div class="dc-empty">No channels — add one below.</div>'}
        </div>

        <div class="dc-add-row">
          <input class="dc-input" id="dc-add-id" placeholder="Channel ID (e.g. C05BWN1AHSS)" spellcheck="false">
          <input class="dc-input dc-input-name" id="dc-add-name" placeholder="Display name (e.g. ai-guild)">
          <button class="dc-add-btn" id="dc-add-btn">+ Add</button>
        </div>

        <div class="dc-msgs-row">
          <span class="dc-section-label" style="margin:0;">Messages per channel</span>
          <div class="dc-stepper">
            <button class="dc-step-btn" id="dc-step-down">−</button>
            <span class="dc-step-val" id="dc-step-val">${currentConfig.msgsPerChannel}</span>
            <button class="dc-step-btn" id="dc-step-up">+</button>
          </div>
        </div>
      </div>

      <div class="dc-actions">
        <button class="dc-save-btn" id="dc-save-btn">Save &amp; Reload</button>
        <button class="dc-cancel-btn" id="dc-cancel-btn">Cancel</button>
      </div>
    </div>`;

  // bind remove buttons
  el.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.remove);
      currentConfig = { ...currentConfig, channels: currentConfig.channels.filter((_, i) => i !== idx) };
      renderPanel();
    });
  });

  // drag-and-drop reorder
  let dragSrc = -1;
  const rows = Array.from(el.querySelectorAll<HTMLElement>(".dc-channel-row"));

  rows.forEach(row => {
    row.addEventListener("dragstart", e => {
      dragSrc = Number(row.dataset.idx);
      row.classList.add("dc-dragging");
      e.dataTransfer!.effectAllowed = "move";
    });

    row.addEventListener("dragend", () => {
      rows.forEach(r => r.classList.remove("dc-dragging", "dc-drop-above", "dc-drop-below"));
    });

    row.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      rows.forEach(r => r.classList.remove("dc-drop-above", "dc-drop-below"));
      const { top, height } = row.getBoundingClientRect();
      row.classList.add(e.clientY < top + height / 2 ? "dc-drop-above" : "dc-drop-below");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("dc-drop-above", "dc-drop-below");
    });

    row.addEventListener("drop", e => {
      e.preventDefault();
      const dropIdx = Number(row.dataset.idx);
      if (dragSrc === dropIdx) return;
      const { top, height } = row.getBoundingClientRect();
      const insertBefore = e.clientY < top + height / 2;
      const channels = [...currentConfig.channels];
      const [moved] = channels.splice(dragSrc, 1);
      // After removal the drop target shifts if it was after the source
      let insertAt = dropIdx > dragSrc ? dropIdx - 1 : dropIdx;
      if (!insertBefore) insertAt += 1;
      channels.splice(insertAt, 0, moved);
      currentConfig = { ...currentConfig, channels };
      renderPanel();
    });
  });

  // add channel
  el.querySelector<HTMLButtonElement>("#dc-add-btn")?.addEventListener("click", () => {
    const idInput = el.querySelector<HTMLInputElement>("#dc-add-id")!;
    const nameInput = el.querySelector<HTMLInputElement>("#dc-add-name")!;
    const id = idInput.value.trim();
    const name = nameInput.value.trim();
    if (!id) { idInput.focus(); return; }
    if (currentConfig.channels.find(c => c.id === id)) { idInput.select(); return; }
    currentConfig = { ...currentConfig, channels: [...currentConfig.channels, { id, name: name || id }] };
    idInput.value = "";
    nameInput.value = "";
    renderPanel();
    idInput.focus();
  });

  // allow Enter in the add inputs to trigger add
  [el.querySelector<HTMLInputElement>("#dc-add-id"), el.querySelector<HTMLInputElement>("#dc-add-name")].forEach(inp => {
    inp?.addEventListener("keydown", e => {
      if (e.key === "Enter") el.querySelector<HTMLButtonElement>("#dc-add-btn")?.click();
    });
  });

  // stepper
  el.querySelector("#dc-step-down")?.addEventListener("click", () => {
    currentConfig = { ...currentConfig, msgsPerChannel: Math.max(1, currentConfig.msgsPerChannel - 1) };
    const v = el.querySelector("#dc-step-val");
    if (v) v.textContent = String(currentConfig.msgsPerChannel);
  });
  el.querySelector("#dc-step-up")?.addEventListener("click", () => {
    currentConfig = { ...currentConfig, msgsPerChannel: Math.min(20, currentConfig.msgsPerChannel + 1) };
    const v = el.querySelector("#dc-step-val");
    if (v) v.textContent = String(currentConfig.msgsPerChannel);
  });

  // save
  el.querySelector("#dc-save-btn")?.addEventListener("click", async () => {
    const btn = el.querySelector<HTMLButtonElement>("#dc-save-btn")!;
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const { data } = await api.saveSlackDigestConfig(currentConfig);
      currentConfig = data;
      updateMeta();
      panelOpen = false;
      configBtn()?.classList.remove("active");
      renderPanel();
      await loadChannels();
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, "error");
      btn.disabled = false;
      btn.textContent = "Save & Reload";
    }
  });

  // cancel
  el.querySelector("#dc-cancel-btn")?.addEventListener("click", () => {
    panelOpen = false;
    configBtn()?.classList.remove("active");
    renderPanel();
    // restore config from server in case user made unsaved changes
    api.slackDigestConfig().then(r => { currentConfig = r.data; updateMeta(); }).catch(() => {});
  });
}

export async function initChannelDigestConfig() {
  if (hasCapability("slack")) {
    try {
      const { data } = await api.slackDigestConfig();
      currentConfig = data;
    } catch { /* keep defaults */ }
  }
  updateMeta();

  configBtn()?.addEventListener("click", () => {
    panelOpen = !panelOpen;
    configBtn()?.classList.toggle("active", panelOpen);
    renderPanel();
  });
}

// ---- Digest loader ----

export async function loadChannels(silent = false) {
  const body = $("#channels-body")!;
  if (!silent) body.innerHTML = skeletonList(3);
  try {
    const resp = await api.slackDigest();
    if (resp.notConfigured) {
      body.innerHTML = renderWorkspaceNotConfigured("Slack");
      return;
    }
    const data = resp.data;
    if (!data.length) {
      body.innerHTML = `<div class="empty">
        <span class="emoji">💤</span>
        <div class="empty-title">All quiet on Slack</div>
        <div>No channel activity right now.</div>
      </div>`;
      return;
    }
    // Sort: channels with messages first; within those, most recent first
    const sorted = [...data].sort((a, b) => {
      const at = Number(a.messages[0]?.ts?.split(".")[0] || 0);
      const bt = Number(b.messages[0]?.ts?.split(".")[0] || 0);
      return bt - at;
    });
    body.innerHTML = `<div class="dg-grid">${sorted.map(renderChannelTile).join("")}</div>`;

    // Single-open: clicking a tile head toggles it; opening one closes the others.
    const tiles = Array.from(body.querySelectorAll<HTMLElement>(".dg-channel"));
    tiles.forEach(tile => {
      const head = tile.querySelector<HTMLElement>(".dg-channel-head");
      if (!head) return;
      const toggle = () => {
        const wasOpen = tile.classList.contains("is-open");
        tiles.forEach(t => {
          t.classList.remove("is-open");
          t.querySelector(".dg-channel-head")?.setAttribute("aria-expanded", "false");
        });
        if (!wasOpen) {
          tile.classList.add("is-open");
          head.setAttribute("aria-expanded", "true");
        }
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    });
  } catch (err) {
    if (isAuthError(err)) body.innerHTML = renderNotConnected("Slack", "slack");
    else body.innerHTML = `<div class="error">Slack error: ${escapeHtml((err as Error).message)}</div>`;
  }
}
