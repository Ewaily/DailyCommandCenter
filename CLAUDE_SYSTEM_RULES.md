# Claude System Rules — Daily Command Center

These are **strict, non-negotiable directives** that Claude must follow on every task in this repository. They supplement (and never override) the project conventions in [CLAUDE.md](./CLAUDE.md).

---

## OPEN SOURCE RULE

Before modifying any code, Claude **must** read the existing documentation
([README.md](./README.md), [SETUP.md](./SETUP.md), [FEATURES.md](./FEATURES.md), [CLAUDE.md](./CLAUDE.md))
that covers the area being changed.

After completing **any** feature, fix, refactor, or behavior change, Claude **must autonomously**
update the following files in the same response — without being asked, without confirmation:

- **[FEATURE_BREAKDOWN.md](./FEATURES.md)** (the project's `FEATURES.md`) — every user-facing
  feature, card, shortcut, toggle, integration, and setting must reflect reality.
- **[USER_ONBOARDING.md](./SETUP.md)** (the project's `SETUP.md`) — every env var,
  prerequisite, OAuth redirect URI, and "how to connect" step must reflect reality.
- **[README.md](./README.md)** — the public-facing description, feature list, tech stack,
  scripts table, and Getting Started flow must reflect reality.

A task is **not complete** until all three documents match the code.
Documentation drift is unacceptable. If the user has to remind Claude to "also update the docs",
the rule has already been violated.

---

## GIT FLOW RULE

- All completed Claude Code sessions must be committed to the **`prod`** branch
  (this is the project's main branch until further notice).
- **Never commit secrets.** Before any `git add`, Claude must verify that no `.env`,
  no token, no API key, no `*.db` / `*.sqlite`, no `layout_config.json`, and no
  `.DS_Store` is being staged. The `.gitignore` is the first defense; visual
  verification of `git status` output is the second.
- **Never `git push --force`** to `prod`. Never push to `main` if it exists.
- Always use conventional-commit style messages: `feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`, `ci:`.
- Before pushing, `npm run typecheck` and `npm test` must both pass.

---

## SECURITY RULE

- Treat every string that looks like a token (`ghp_…`, `xox[pb]-…`, `ATATT…`,
  `GOCSPX-…`, JWT-shaped values, UUIDs paired with "secret") as radioactive.
  Never echo, log, or commit them.
- Never weaken `.gitignore`. If a contributor needs a file tracked, find another
  path — never remove `.env`, `*.db`, or `*.sqlite` rules.
- OAuth redirect URIs must always use **port 3000** in code and docs.

---

## DOCUMENTATION SELF-CHECK (run before ending every turn)

Did this change touch any:

- user-facing control, button, toggle, or setting?
- environment variable, prerequisite, or startup command?
- API route, integration, or OAuth flow?
- keyboard shortcut, card, or sidebar section?

If **yes** to any of the above → open `README.md`, `SETUP.md`, and `FEATURES.md`
and confirm each is still accurate. Fix drift in the **same** response.

If **no** → state explicitly that no doc update is required, so the user can
verify the judgment call.
