# Contributing to Daily Command Center

First — thank you. This project is built in the open precisely so people like you can make it better.

This guide is the **single source of truth** for how contributions work. The rules in [CLAUDE.md](../CLAUDE.md) and [CLAUDE_SYSTEM_RULES.md](../CLAUDE_SYSTEM_RULES.md) apply to every change, human or AI-assisted.

---

## 🚀 New to Open Source? Start Here

Welcome! If this is your first time contributing, don't worry about the strict rules below. We all started somewhere. Here is how to get your feet wet safely:

1. **Look for the "Good First Issue" label:** We tag issues that are perfect for beginners to start with.
2. **Don't fear the PR process:** We view Pull Request reviews as a conversation and a learning opportunity, not an exam. It's okay to ask questions or make mistakes — that's why we're here!
3. **The "Safe" First Step:** If you aren't sure where to start, open an issue labeled "Question" or reach out to us. We'll help you pick a small task (like updating a doc or fixing a typo).
4. **We are here to help:** If you get stuck on the environment setup or the rules, just comment on the issue or PR. We'd rather help you fix it than have you feel overwhelmed.

---

## TL;DR

1. Open an issue (or claim an existing one) before you write code for anything non-trivial.
2. Branch off `prod`: `git checkout -b feat/short-description`.
3. Code, test, **update docs in the same PR** (`README.md`, `FEATURES.md`, `SETUP.md` if affected).
4. `npm run typecheck && npm test` must pass.
5. Open a PR against `prod`, fill out the template, link the issue.
6. Address review feedback; we squash-merge.

---

## 🛠 Technical Guidelines

### Ground rules

- **Be kind.** See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- **One concern per PR.** Two unrelated fixes → two PRs. Refactors that aren't needed for the change you're making → separate PR.
- **No comments unless the *why* is non-obvious.** No defensive error handling for impossible cases. Trust framework guarantees.
- **TypeScript strict.** `npx tsc --noEmit` clean before you push.
- **Never commit `.env`, `*.db`, `*.sqlite`, `layout_config.json`, tokens, or any user state.** The `.gitignore` is strict — don't relax it.

---

### Local setup

```bash
git clone https://github.com/Ewaily/DailyCommandCenter.git
cd DailyCommandCenter
npm install
cp .env.example .env       # fill in only what you need; every integration is optional
npm run dev                # http://localhost:3000
```

See [SETUP.md](./SETUP.md) for per-provider OAuth / API-key walkthroughs.

---

### Branch & commit conventions

### Branch names
- `feat/<slug>` — new feature
- `fix/<slug>` — bug fix
- `docs/<slug>` — docs only
- `chore/<slug>` — tooling, deps, repo hygiene
- `refactor/<slug>` — internal change without behavior change
- `test/<slug>` — tests only

### Commit & PR-title format (Conventional Commits)
```
feat(palette): add fuzzy-match for command names
fix(slack): handle 429 backoff correctly
docs(readme): update Microsoft OAuth setup
chore(deps): bump vitest to 2.1.2
refactor(cache): extract TTL helper
test(slack-formatter): cover code-block edge case
perf(grid): debounce layout writes
ci: add Node 22 to test matrix
```

Breaking changes go in the body with a `BREAKING CHANGE:` line.

---

### What "done" means

A PR is **not done** until **all** of the following are true:

- ✅ Code compiles under strict TypeScript.
- ✅ Tests pass (`npm test`).
- ✅ For UI changes: tested in the browser; screenshot or GIF in the PR.
- ✅ **Docs reflect reality.** If you touched a control, env var, route, shortcut, integration, or setting → `README.md` / `FEATURES.md` / `SETUP.md` are updated in the **same** PR.
- ✅ No `console.log` debris. No commented-out code.
- ✅ No new files in the project root unless absolutely needed.

---

### Adding a new connector / integration

This is a **first-class** contribution path — we want more integrations. Read these before starting:

1. **CONNECTOR STANDARD** in [CLAUDE.md](../CLAUDE.md) — every input field needs a real-world `placeholder`, a `helperText` line, and `stripUrl: true` on any field where a user might paste a URL.
2. **INSTANCE-CARD REGISTRY** in [CLAUDE.md](../CLAUDE.md) — register dashboard cards via `CapabilitySpec` in `src/frontend/components/instance-card-registry.ts`. **Do not** add `if (cap === "...")` branches to `overview-widgets.ts`.
3. **OAuth redirect URI rule** — every OAuth redirect URI must use port **3000** (the Node server). Vite (5173) does not handle callbacks.
4. **Workspace isolation is absolute** — no workspace ever sees another's tokens. UI copy must never imply credentials are shared across workspaces.

---

## Reporting bugs

Use the [Bug report template](../.github/ISSUE_TEMPLATE/bug_report.yml). Include:
- Reproduction steps
- Node version, OS
- Server logs / browser console (with secrets redacted)

## Reporting security issues

**Do not open a public issue.** Use the private advisory flow described in [SECURITY.md](./SECURITY.md).

---

## Review process

- Maintainers triage new PRs within 48 hours (best effort).
- We may ask for tests, doc updates, or scope reduction. Don't take it personally — we'd ask the same of ourselves.
- We squash-merge into `prod`. The squash commit message follows Conventional Commits and ends up in the auto-generated release notes.

Thanks again. 🙌

---

> **Stuck? Don't worry.** The rules are here to keep the project healthy, but our community is here to support you. Ask questions!
