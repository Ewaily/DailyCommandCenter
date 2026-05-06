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

## TESTING RULE

Claude **MUST** write comprehensive unit tests for every new feature, component, or
utility function it creates. Claude **must never** consider a task "complete" unless
the corresponding tests are written **and passing**.

This is enforced at three levels:

1. **Authoring** — every new exported function, branch, and edge case must have at
   least one assertion. New bug fixes must start with a failing regression test
   that reproduces the bug, then be made to pass.
2. **Local gate** — Claude must run `npm run test:coverage` before declaring the
   work done. The command runs Vitest with V8 coverage, enforces the thresholds
   in `vitest.config.ts`, and fails non-zero if any global metric (statements,
   branches, functions, lines) drops below the project floor.
3. **CI gate** — `.github/workflows/ci.yml` runs `npm run test:coverage` on every
   pull request to `prod` against Node 20 and Node 22. A drop below the floor
   blocks the merge — there is no override.

The current coverage floor lives in `vitest.config.ts` under
`test.coverage.thresholds`. Claude **must never** lower these numbers to make a
build pass. If coverage rises permanently, the floor should be ratcheted **up**
in the same PR that raised it, never down.

**COVERAGE RATCHETING:** Whenever Claude writes new tests that increase the
overall project coverage, Claude **MUST** explicitly update the minimum
thresholds in `vitest.config.ts` to match the new higher baseline. The procedure
is:

1. Run `npm run test:coverage` and note the new coverage numbers.
2. Open `vitest.config.ts` and update **every** threshold that increased.
3. Re-run `npm run test:coverage` to confirm the updated thresholds still pass.
4. Include the threshold bump in the **same commit** as the new tests — never
   as a follow-up. The commit message must state the old → new numbers, e.g.
   `test(cache): add TTL expiry tests; ratchet statements 1.4% → 4.2%`.

The floor must always move **up**. It must never move down. It must never stay
flat when coverage actually increased. A task that adds tests without ratcheting
the thresholds is **incomplete**.

When refactoring, existing tests must still pass without modification — if a
test breaks, either the refactor is wrong or the test was protecting behavior
that is changing intentionally. State which it is in the PR description.

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
