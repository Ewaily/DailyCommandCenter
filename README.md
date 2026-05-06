<div align="center">

# 🧭 Daily Command Center

**Your morning, unified.** A local-first, multi-workspace dashboard that fuses Calendar, Slack, Linear, Jira, GitHub, and Notion into a single fluid, drag-and-drop grid — no cloud, no telemetry, no nonsense.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Local-first](https://img.shields.io/badge/local--first-100%25-blue)](#)

</div>

---

## ✨ Overview

**Daily Command Center** is a highly customizable, unified workspace engine that pulls every tool a knowledge worker touches in a day — calendars, chat, tickets, code reviews, docs — into a single, fluid, **drag-and-drop grid** running entirely on your laptop.

It is designed for the developer or manager who wakes up, opens one tab, and wants to see _everything that matters today_ — without juggling 12 windows, fighting with notification bells, or shipping their work history to a SaaS analytics layer.

> Everything is local. Your tokens never leave your machine. Your layout is yours.

---

## 🔥 Core Features

- 🎛 **Custom Grid Engine** — Drag, drop, resize, and re-tab any card. Layouts persist per workspace.
- ⌘ **Dynamic Command Palette** — Fuzzy-jump to any card, action, integration, or setting in one keystroke.
- 🌈 **Safe-Color Theming** — Polished light/dark themes with WCAG-aware accent palettes; brand name & subtitle live-editable in Settings.
- 🧩 **Multi-Workspace Model** — Run "Personal" and "Work" side-by-side; each has its own connectors, identities, and layout. Workspace isolation is **absolute** — credentials never cross boundaries.
- 🔌 **Foolproof Integrations** — Every connector field ships with a real-world placeholder, helper text, and URL-stripping paste handler. No "what format does this want?" guessing.
- 📅 **Calendar** — Google + Microsoft (Outlook). Today, agenda, conflict detection.
- 💬 **Slack** — Unreads, mentions, saved-for-later, DMs.
- 🎫 **Tickets** — Linear & Jira: assigned, mentioned, recently updated, with rich filters.
- 🔧 **GitHub** — Pull requests awaiting your review, your open PRs, recent activity.
- 📓 **Notion** — Pinned pages and database queries surfaced as cards.
- 🧠 **Smart Caching** — SQLite-backed TTL cache wraps every external call; rate-limit friendly.
- 🛡 **Local-Only Persistence** — All data, tokens, and settings live in a single SQLite file under `~/.daily-command-center/`. Delete the file → clean slate.
- ♿ **Keyboard-First** — Every action has a shortcut. The mouse is optional.

---

## 🧱 Tech Stack

| Layer | Choice |
|---|---|
| **Frontend** | TypeScript (strict) · Vite 5 · vanilla DOM components · CSS variables for theming |
| **Backend** | Node ≥ 20 · Express 4 · TypeScript (strict) · `tsx` for dev, `tsc` for prod |
| **Persistence** | SQLite via `better-sqlite3` — single-file DB, inline migrations |
| **Auth** | Native OAuth flows (Google · Slack · Microsoft) + API-key identities (GitHub · Linear · Jira · Notion) |
| **State** | Server: SQLite + AsyncLocalStorage workspace context. Client: `localStorage` for layout & preferences. |
| **Validation** | Zod schemas at every API boundary |
| **Logging** | Pino + pino-pretty |
| **HTML safety** | `sanitize-html` for any rendered third-party content |
| **Testing** | Vitest |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js ≥ 20**
- **macOS / Linux / Windows** (developed on macOS; everything is cross-platform)
- (Optional) Developer accounts for any integrations you want to enable

### 1. Clone

```bash
git clone https://github.com/Ewaily/DailyCommandCenter.git
cd DailyCommandCenter
```

### 2. Install

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in **only** the integrations you want. Every connector is optional — the dashboard renders gracefully with zero credentials. See [SETUP.md](./SETUP.md) for per-provider walkthroughs.

> **OAuth note:** All redirect URIs must point to **port 3000** (the Node server), not the Vite port. The canonical URIs are:
> - `http://localhost:3000/api/auth/google/callback`
> - `http://localhost:3000/api/auth/slack/callback`
> - `http://localhost:3000/api/auth/microsoft/callback`

### 4. Run in dev mode

```bash
npm run dev
```

Then open **http://localhost:3000** (the Node server proxies Vite's HMR for you).

### 5. Build for production

```bash
npm run build
npm start
```

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run server + Vite concurrently |
| `npm run build` | Build frontend bundle + compile server |
| `npm start` | Run compiled production server |
| `npm test` | Run Vitest suite |
| `npm run typecheck` | Strict-mode typecheck across client + server |
| `npm run reset-db` | Wipe the local SQLite DB and reseed from `.env` |

---

## 🗺 Project Layout

```
src/
  server/          # Express server, auth, integrations, cache, DB
    index.ts       # Entry point
    db.ts          # Migrations + seed
    config.ts      # .env loader
    auth/          # OAuth flows
    lib/           # request-context, cache, http helpers
  frontend/        # Vite app
    main.ts        # Entry point
    components/    # Cards, palette, settings, registry
    styles.css     # Theme variables + layout
scripts/           # Maintenance scripts
tests/             # Vitest specs
```

See **[FEATURES.md](./FEATURES.md)** for the full feature inventory and **[SETUP.md](./SETUP.md)** for integration setup walkthroughs.

---

## 🤝 Contributing

PRs welcome — and encouraged. The full contributor guide lives in **[CONTRIBUTING.md](./CONTRIBUTING.md)**. Quick version:

1. **Fork** and branch off `prod`: `git checkout -b feat/my-thing`.
2. **Follow existing conventions** — TypeScript strict, no comments unless the *why* is non-obvious, no error handling for impossible cases. See [CLAUDE.md](./CLAUDE.md).
3. **Update docs in the same PR** — if you change a control, env var, route, or shortcut, update [FEATURES.md](./FEATURES.md) and [SETUP.md](./SETUP.md). Documentation drift is flagged in review.
4. **Run `npm run typecheck && npm test`** before pushing. CI runs both on every PR.
5. **Open a PR against `prod`**. The [PR template](./.github/PULL_REQUEST_TEMPLATE.md) walks you through what's required.

For larger changes, open a discussion or issue first so we can align on direction.

By participating, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). For security issues, see [SECURITY.md](./SECURITY.md) — please **never** open a public issue for a vulnerability.

### Connector contributions

If you're adding a new integration, follow the **CONNECTOR STANDARD** in [CLAUDE.md](./CLAUDE.md):
- Every input field needs a real placeholder, helper text, and `stripUrl: true` where users might paste a URL.
- Register dashboard cards via `CapabilitySpec` in `src/frontend/components/instance-card-registry.ts` — never add `if (cap === "...")` branches in `overview-widgets.ts`.

---

## 🔒 Security

- **Never commit `.env` or any token.** The `.gitignore` is strict; respect it.
- All secrets live in SQLite locally — this app is single-user, single-machine by design.
- Found a vulnerability? Please open a private security advisory on GitHub rather than a public issue.

---

## 📜 License

[MIT](./LICENSE) © 2026 Muhammad Ewaily

---

<div align="center">

**Built for people who'd rather see their day on one screen than fifteen.**

</div>
