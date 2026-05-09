export const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

export const escapeHtml = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));

import { getPrimaryTz } from "./tz.js";
const TZ = () => getPrimaryTz();

export const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", {
    timeZone: TZ(),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const dayOf = d.toLocaleDateString("en-US", { timeZone: TZ() });
  const today = now.toLocaleDateString("en-US", { timeZone: TZ() });
  const yesterday = new Date(now.getTime() - 86400000).toLocaleDateString("en-US", { timeZone: TZ() });
  const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString("en-US", { timeZone: TZ() });
  const time = d.toLocaleTimeString("en-US", { timeZone: TZ(), hour: "numeric", minute: "2-digit", hour12: true });
  if (dayOf === today) return time;
  if (dayOf === tomorrow) return `Tomorrow · ${time}`;
  if (dayOf === yesterday) return `Yesterday · ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const dateStr = d.toLocaleDateString("en-US", {
    timeZone: TZ(), month: "short", day: "numeric",
    ...(!sameYear ? { year: "numeric" } : {}),
  });
  return `${dateStr} · ${time}`;
};

export const fmtDuration = (mins: number): string =>
  mins < 60 ? `${mins}m` : (mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h ${mins % 60}m`);

export const todayKey = (): string => new Date().toISOString().slice(0, 10);

function ymdInTz(date: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return {
    y: +parts.find(p => p.type === "year")!.value,
    m: +parts.find(p => p.type === "month")!.value,
    d: +parts.find(p => p.type === "day")!.value,
  };
}

function tzOffsetMinutesAt(utcMs: number, tz: string): number {
  const d = new Date(utcMs);
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  return (local.getTime() - utc.getTime()) / 60000;
}

/** "Today + offset" as it falls on the calendar in `tz`, with start/end UTC instants for that day. */
export function offsetDateInTz(offset: number, tz: string) {
  const today = ymdInTz(new Date(), tz);
  const anchor = Date.UTC(today.y, today.m - 1, today.d, 12, 0, 0) + offset * 86_400_000;
  const a = new Date(anchor);
  const ymd = ymdInTz(a, tz);
  const iso = `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(ymd.d).padStart(2, "0")}`;
  const noonUtc = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0);
  const off = tzOffsetMinutesAt(noonUtc, tz);
  const startMs = noonUtc - 12 * 3600_000 - off * 60_000;
  const endMs   = noonUtc + 12 * 3600_000 - off * 60_000 - 1;
  const label = a.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
  return { iso, label, startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

export const timeAgo = (ts: number | null | undefined): string => {
  if (!ts) return "";
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

export const stripFwdPrefix = (title: string): string =>
  (title || "(untitled)").replace(/^(FW|FWD|Fwd|RE|Re):\s*/i, "");

export const renderNotConnected = (provider: string, key: string): string => `
  <div class="not-connected">
    <span class="empty-icon" data-icon="plug"></span>
    <div class="title">${escapeHtml(provider)} not connected</div>
    <div class="desc">Add credentials to your <code>.env</code> per
      <a href="/SETUP.md" target="_blank">SETUP.md</a> and restart the server.</div>
    <a class="not-connected-cta" href="/api/auth/${escapeHtml(key)}/start">Connect now</a>
  </div>
`;

/** Placeholder shown when the active workspace has no connector for this provider. */
export const renderWorkspaceNotConfigured = (provider: string): string => `
  <div class="empty">
    <span class="empty-icon" data-icon="plug"></span>
    <div class="empty-title">${escapeHtml(provider)} not configured for this workspace</div>
    <div class="empty-hint">Open <kbd>,</kbd> Settings → Workspaces and add a ${escapeHtml(provider)} connector,
      or switch back to <em>Overview</em> in the header to see everything shared across workspaces.</div>
  </div>
`;

/** Skeleton placeholder for list-style cards while data is loading. */
export const skeletonList = (rows = 4): string => {
  const row = `
    <div class="skeleton-row">
      <div><span class="sk short"></span></div>
      <div>
        <span class="sk tall mid"></span>
        <span class="sk short"></span>
      </div>
    </div>`;
  return `<div class="skeleton-list">${row.repeat(rows)}</div>`;
};

/** Compact skeleton (for narrow cards). */
export const skeletonCompact = (rows = 3): string => {
  const row = `
    <div class="skeleton-row">
      <div>
        <span class="sk tall mid"></span>
        <span class="sk short"></span>
      </div>
    </div>`;
  return `<div class="skeleton-list">${row.repeat(rows)}</div>`;
};

type ToastOpts = {
  type?: "info" | "success" | "error" | "update";
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export function toast(msg: string, typeOrOpts: "info" | "success" | "error" | "update" | ToastOpts = "info") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const opts: ToastOpts = typeof typeOrOpts === "string" ? { type: typeOrOpts } : typeOrOpts;
  const type = opts.type ?? "info";
  const rawDuration = opts.duration ?? (opts.action ? 8000 : 2200);
  const persistent  = rawDuration === 0;

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);

  let timer: number;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  };

  if (opts.action) {
    const btn = document.createElement("button");
    btn.textContent = opts.action.label;
    btn.addEventListener("click", () => { opts.action!.onClick(); dismiss(); });
    el.appendChild(btn);
  }

  stack.appendChild(el);
  if (!persistent) timer = window.setTimeout(dismiss, rawDuration);
  return dismiss;
}

/**
 * Shows a lightweight confirm dialog using the existing .modal-backdrop / .modal
 * CSS classes. Resolves true if the user confirms, false if they cancel.
 */
export function confirmModal(opts: {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop open";
    backdrop.innerHTML = `
      <div class="modal clone-confirm-modal" style="max-width:420px">
        <h2 style="margin:0 0 10px;font-size:var(--fs-lg)">${escapeHtml(opts.title)}</h2>
        <p class="clone-confirm-body">${opts.body}</p>
        <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
          <button class="btn btn-ghost clone-confirm-cancel">${escapeHtml(opts.cancelLabel ?? "Cancel")}</button>
          <button class="btn btn-primary clone-confirm-ok">${escapeHtml(opts.confirmLabel ?? "Confirm")}</button>
        </div>
      </div>`;

    const close = (result: boolean) => {
      backdrop.classList.remove("open");
      setTimeout(() => backdrop.remove(), 220);
      resolve(result);
    };

    backdrop.querySelector<HTMLElement>(".clone-confirm-cancel")?.addEventListener("click", () => close(false));
    backdrop.querySelector<HTMLElement>(".clone-confirm-ok")?.addEventListener("click",    () => close(true));
    backdrop.addEventListener("click", e => { if (e.target === backdrop) close(false); });

    document.body.appendChild(backdrop);
    (backdrop.querySelector(".clone-confirm-ok") as HTMLElement)?.focus();
  });
}

/**
 * Shows a persistent error modal with the full error text in a copyable block.
 * Use this for clone failures so the user can copy-paste the error for debugging.
 */
export function errorModal(opts: { title: string; detail: string }): void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop open";
  backdrop.innerHTML = `
    <div class="modal clone-error-modal" style="max-width:480px">
      <h2 style="margin:0 0 10px;font-size:var(--fs-lg);color:var(--error)">${escapeHtml(opts.title)}</h2>
      <p style="font-size:var(--fs-sm);color:var(--text-muted);margin:0 0 10px">
        Copy this error and share it for debugging:
      </p>
      <pre class="clone-error-pre">${escapeHtml(opts.detail)}</pre>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn btn-ghost clone-error-copy">Copy error</button>
        <button class="btn btn-primary clone-error-close">Close</button>
      </div>
    </div>`;

  const close = () => {
    backdrop.classList.remove("open");
    setTimeout(() => backdrop.remove(), 220);
  };

  backdrop.querySelector(".clone-error-close")!.addEventListener("click", close);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".clone-error-copy")!.addEventListener("click", () => {
    navigator.clipboard.writeText(opts.detail).catch(() => {});
    const btn = backdrop.querySelector(".clone-error-copy") as HTMLButtonElement;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy error"; }, 1500);
  });

  document.body.appendChild(backdrop);
}

/**
 * Shows a success modal after a clone operation.
 * Displays the new ticket key, a clickable URL, and a "Copy link" button.
 */
export function cloneSuccessModal(opts: { key: string; url: string }): void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop open";
  backdrop.innerHTML = `
    <div class="modal clone-success-modal" style="max-width:420px;text-align:center">
      <div class="clone-success-icon">✓</div>
      <h2 style="margin:8px 0 4px;font-size:var(--fs-xl)">Cloned successfully</h2>
      <p style="font-size:var(--fs-sm);color:var(--text-muted);margin:0 0 16px">New ticket created in Jira</p>
      <div class="clone-success-key">${escapeHtml(opts.key)}</div>
      <a class="clone-success-url" href="${escapeHtml(opts.url)}" target="_blank" rel="noopener">
        ${escapeHtml(opts.url)}
      </a>
      <div style="display:flex;justify-content:center;gap:8px;margin-top:20px">
        <button class="btn btn-ghost clone-success-copy">Copy link</button>
        <a class="btn btn-primary" href="${escapeHtml(opts.url)}" target="_blank" rel="noopener">Open in Jira ↗</a>
      </div>
      <button class="clone-success-close" aria-label="Close">✕</button>
    </div>`;

  const close = () => {
    backdrop.classList.remove("open");
    setTimeout(() => backdrop.remove(), 220);
  };

  backdrop.querySelector(".clone-success-close")!.addEventListener("click", close);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".clone-success-copy")!.addEventListener("click", () => {
    navigator.clipboard.writeText(opts.url).catch(() => {});
    const btn = backdrop.querySelector(".clone-success-copy") as HTMLButtonElement;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
  });

  document.body.appendChild(backdrop);
}

/** Animate a number from current to target value. */
export function animateNumber(el: HTMLElement | null, target: number, duration = 600) {
  if (!el) return;
  const start = parseInt(el.textContent || "0", 10);
  const safeStart = Number.isFinite(start) ? start : 0;
  if (safeStart === target) { el.textContent = String(target); return; }
  const startedAt = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = Math.round(safeStart + (target - safeStart) * eased);
    el.textContent = String(v);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
