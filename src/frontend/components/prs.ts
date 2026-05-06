import { api, isAuthError, type PR } from "../api.js";
import { $, escapeHtml, renderNotConnected, skeletonCompact, animateNumber } from "./util.js";
import { saveSetting, getSetting } from "../state.js";

type Bucket = "review" | "mine" | "all" | "closed";
const BUCKETS: Bucket[] = ["review", "mine", "all", "closed"];

const _stored = getSetting<string>("prTab");
let active: Bucket = (BUCKETS.includes(_stored as Bucket) ? _stored as Bucket : "review");

function tagFor(p: PR & { merged?: boolean; state?: string }): string {
  if (p.status === "Review needed") return `<span class="badge badge-urgent">Review</span>`;
  if (p.status === "Draft")         return `<span class="badge badge-focus">Draft</span>`;
  if (p.status === "Open")          return `<span class="badge badge-info">Open</span>`;
  if (p.status === "Merged")        return `<span class="badge badge-new">Merged</span>`;
  if (p.status === "Closed")        return `<span class="badge badge-warning">Closed</span>`;
  return `<span class="badge badge-info">${escapeHtml(p.status)}</span>`;
}

export interface PRInstance {
  load(silent?: boolean): Promise<void>;
}

function renderPR(p: PR, bucket: Bucket = active): string {
  const timeLabel = bucket === "closed" ? "closed" : "opened";
  const showAuthor = bucket !== "mine";
  return `
    <div class="schedule-item">
      <div class="schedule-time item-key">#${escapeHtml(String(p.number || ""))}</div>
      <div class="schedule-content">
        <div class="schedule-title-row">
          <a href="${escapeHtml(p.url)}" target="_blank" class="schedule-title">${escapeHtml(p.title)}</a>
          ${tagFor(p)}
        </div>
        <div class="schedule-meta">
          ${escapeHtml(p.repo || "")}<span class="meta-sep">·</span>${timeLabel} ${escapeHtml(p.ageHuman || "")}
          ${p.author && showAuthor ? `<span class="meta-sep">·</span>by ${escapeHtml(p.author)}` : ""}
        </div>
      </div>
    </div>`;
}

function updateCounts(counts: Record<string, number>) {
  for (const b of BUCKETS) {
    const el = document.querySelector(`#pr-tabs [data-pr-count="${b}"]`);
    if (el) el.textContent = String(counts[b] ?? 0);
  }
  animateNumber($("#kpi-prs"), counts.review ?? 0);
  const detail = $("#kpi-prs-detail");
  if (detail) detail.textContent = `${counts.review ?? 0} to review · ${counts.mine ?? 0} mine open`;
}

function syncTabUI() {
  document.querySelectorAll<HTMLElement>("#pr-tabs [data-pr-tab]").forEach(b => {
    b.classList.toggle("active", b.dataset.prTab === active);
  });
}

function resetCounts() {
  for (const b of BUCKETS) {
    const el = document.querySelector(`#pr-tabs [data-pr-count="${b}"]`);
    if (el) el.textContent = "0";
  }
  const k = $("#kpi-prs"); if (k) k.textContent = "—";
  const d = $("#kpi-prs-detail"); if (d) d.textContent = "Not in this workspace";
}

export async function loadPRs(silent = false) {
  syncTabUI();
  const body = $("#pr-queue-body")!;
  if (!silent) body.innerHTML = skeletonCompact(3);
  try {
    const resp = await api.prs(active);
    if (resp.notConfigured) {
      body.innerHTML = renderNotConnected("GitHub", "github");
      resetCounts();
      return;
    }
    if (resp.counts) updateCounts(resp.counts);
    const data = resp.data || [];
    if (!data.length) {
      const cfg =
        active === "review" ? { emoji: "✨", title: "Review queue is clear",  desc: "No PRs waiting on your review." } :
        active === "mine"   ? { emoji: "🚀", title: "No open PRs",            desc: "Open one when you're ready." } :
        active === "all"    ? { emoji: "🏖️",  title: "Repo is quiet",          desc: "No open PRs in this repository." } :
                              { emoji: "📦", title: "No closed PRs yet",      desc: "Recently closed and merged PRs land here." };
      body.innerHTML = `<div class="empty">
        <span class="emoji">${cfg.emoji}</span>
        <div class="empty-title">${cfg.title}</div>
        <div>${cfg.desc}</div>
      </div>`;
      return;
    }
    body.innerHTML = data.map(p => renderPR(p)).join("");
  } catch (err) {
    if (isAuthError(err)) { body.innerHTML = renderNotConnected("GitHub", "github"); resetCounts(); }
    else body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

export function bindPrTabs() {
  document.querySelectorAll<HTMLElement>("#pr-tabs [data-pr-tab]").forEach(b => {
    b.addEventListener("click", () => {
      active = (b.dataset.prTab as Bucket) || "review";
      saveSetting("prTab", active);
      loadPRs();
    });
  });
}

export function instantiatePRs(
  container: HTMLElement,
  connectorId: string,
  opts: { wsName: string; title: string }
): PRInstance {
  const { wsName, title } = opts;
  const _stored = getSetting<string>("prTab");
  let bucket: Bucket = (BUCKETS.includes(_stored as Bucket) ? _stored as Bucket : "review");

  container.innerHTML = `
    <div class="card-header">
      <div class="title-row">
        <span class="title-source">${escapeHtml(wsName)}</span>
        <span class="title-text">
          <span class="title-icon" data-icon="gitPr"></span>
          <span>${escapeHtml(title)}</span>
        </span>
      </div>
      <div class="tabs" data-ov-tabs>
        <button class="tab${bucket === "review" ? " active" : ""}" data-ov-bucket="review">Needs Review <span class="tab-count" data-ov-count="review">—</span></button>
        <button class="tab${bucket === "mine" ? " active" : ""}" data-ov-bucket="mine">My PRs <span class="tab-count" data-ov-count="mine">—</span></button>
        <button class="tab${bucket === "all" ? " active" : ""}" data-ov-bucket="all">All Open <span class="tab-count" data-ov-count="all">—</span></button>
        <button class="tab${bucket === "closed" ? " active" : ""}" data-ov-bucket="closed">Closed <span class="tab-count" data-ov-count="closed">—</span></button>
      </div>
    </div>
    <div class="card-body" data-ov-body></div>
  `;

  const body = container.querySelector<HTMLElement>("[data-ov-body]")!;
  const tabsEl = container.querySelector<HTMLElement>("[data-ov-tabs]");

  function syncTabUI() {
    tabsEl?.querySelectorAll<HTMLElement>("[data-ov-bucket]").forEach(b => {
      b.classList.toggle("active", b.dataset.ovBucket === bucket);
    });
  }

  function updateCounts(counts: Record<string, number>) {
    for (const b of BUCKETS) {
      const el = container.querySelector(`[data-ov-count="${b}"]`);
      if (el) el.textContent = String(counts[b] ?? 0);
    }
  }

  tabsEl?.querySelectorAll<HTMLElement>("[data-ov-bucket]").forEach(b => {
    b.addEventListener("click", () => {
      bucket = (b.dataset.ovBucket as Bucket) || "review";
      saveSetting("prTab", bucket);
      syncTabUI();
      load();
    });
  });

  async function load(silent = false): Promise<void> {
    if (!silent) body.innerHTML = skeletonCompact(3);
    try {
      const resp = await api.prs(bucket, connectorId);
      if (resp.notConfigured) {
        body.innerHTML = renderNotConnected("GitHub", "github");
        return;
      }
      if (resp.counts) updateCounts(resp.counts);
      const data = resp.data || [];
      if (!data.length) {
        const cfg =
          bucket === "review" ? { emoji: "✨", title: "Review queue is clear",  desc: "No PRs waiting on your review." } :
          bucket === "mine"   ? { emoji: "🚀", title: "No open PRs",            desc: "Open one when you're ready." } :
          bucket === "all"    ? { emoji: "🏖️",  title: "Repo is quiet",          desc: "No open PRs in this repository." } :
                                { emoji: "📦", title: "No closed PRs yet",      desc: "Recently closed and merged PRs land here." };
        body.innerHTML = `<div class="empty">
          <span class="emoji">${cfg.emoji}</span>
          <div class="empty-title">${cfg.title}</div>
          <div>${cfg.desc}</div>
        </div>`;
        return;
      }
      body.innerHTML = data.map(p => renderPR(p, bucket)).join("");
    } catch (err) {
      if (isAuthError(err)) body.innerHTML = renderNotConnected("GitHub", "github");
      else body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  return { load };
}
