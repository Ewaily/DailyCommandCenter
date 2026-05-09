# Changelog

All notable changes to this project will be documented in this file.

---

## [v1.0.2] — 2026-05-09

### 🔧 Chores

- Sync `package-lock.json` with `v1.0.1` version bump ([#25](https://github.com/Ewaily/DailyCommandCenter/pull/25))

---

## [v1.0.1] — 2026-05-09

### 🐛 Bug Fixes

- **Footer version hardcoded** — Footer was displaying `v0.1.0` regardless of the actual release. Version is now read from `APP_VERSION` in `update-checker.ts` and written to the DOM at startup, so it always reflects the true running version.

---

## [v1.0.0] — 2026-05-09

### 🚀 Features

- **Automatic update notifier** — On every shell load, the app silently checks GitHub for a newer release. If one exists, a persistent gradient toast appears with a one-click _Download_ button linking directly to the releases page. Fails silently on 404 / network errors. ([#24](https://github.com/Ewaily/DailyCommandCenter/pull/24))
- **Quiet Operator redesign** — Full cinematic UI overhaul: refined typography, new colour tokens, elevated card shadows, and improved clone discoverability across all widgets. README updated with screenshots. ([#23](https://github.com/Ewaily/DailyCommandCenter/pull/23))
- **1-click smart ticket cloning** — Clone any ClickUp task or Jira issue to Jira in a single click. The clone editor pre-fills summary, description, priority, and labels; a success modal shows the new issue key and a direct link. ([#22](https://github.com/Ewaily/DailyCommandCenter/pull/22))

### 🐛 Bug Fixes

- **Infinite MutationObserver loop** — Tab state self-heals stale `localStorage` entries and breaks re-entrant observer cycles that could lock the UI. ([#21](https://github.com/Ewaily/DailyCommandCenter/pull/21))
- **Scrollable widget shell** — Enforces a bulletproof `flex/overflow` shell on every dashboard card so content always scrolls and headers never collapse under extreme grid resizing. ([#20](https://github.com/Ewaily/DailyCommandCenter/pull/20))
- **Workspace ↔ Overview parity** — Unified the rendering path so every widget looks and behaves identically in both Workspace mode and Overview mode — no more "lite" shells or missing controls in multi-instance views. ([#19](https://github.com/Ewaily/DailyCommandCenter/pull/19))
- **Tab click regression** — Tabs were non-clickable outside edit mode and tab order could become corrupted in `localStorage`; both issues are now resolved. ([#18](https://github.com/Ewaily/DailyCommandCenter/pull/18))

### 💅 Polish

- Comprehensive documentation and visual strategy audit — README rewritten marketing-first with collapsible `FEATURES.md` sections. ([#17](https://github.com/Ewaily/DailyCommandCenter/pull/17), [#14](https://github.com/Ewaily/DailyCommandCenter/pull/14))
- Repository structure reorganised: `docs/` and `examples/` directories introduced with updated cross-links. ([#13](https://github.com/Ewaily/DailyCommandCenter/pull/13))
- Codecov integration with coverage ratcheting — every PR is gated on the coverage floor; patch coverage must not be 0 on new code. ([#10](https://github.com/Ewaily/DailyCommandCenter/pull/10), [#11](https://github.com/Ewaily/DailyCommandCenter/pull/11))
- Initial open-source contributor scaffolding, security audit, and `STARTUP & SYNC PROTOCOL` added to system rules.

---

_Full diff: [`v1.0.0`](https://github.com/Ewaily/DailyCommandCenter/releases/tag/v1.0.0)_
