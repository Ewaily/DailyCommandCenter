<!--
Thanks for contributing to Daily Command Center!
Please fill out the sections below. PRs that ignore this template
will be asked to update before review.
-->

# 🧪 Testing Requirements — read this first

> **PRs without tests will not be reviewed.**
>
> This project enforces a minimum coverage floor in CI. Your branch **cannot
> drop the global statements / branches / functions / lines coverage** below
> the current floor — `npm run test:coverage` must pass locally and in CI
> before this PR can merge. New code without new tests is rejected at the
> gate, not at review.

## ✅ Test checklist (mandatory)

- [ ] **I have written unit tests that fully cover my new code** (every new function, branch, and edge case has at least one assertion).
- [ ] **I have run `npm run test:coverage` locally and the coverage thresholds pass.**
- [ ] **I have verified that my code does not drop the overall project test coverage** — neither global nor file-level.
- [ ] If I deleted or refactored code, I updated/removed the corresponding tests in the same PR.
- [ ] If this is a **bug fix**, I added a failing test first that reproduces the bug, then made it pass.

If any box above is unchecked, the PR will be closed with a request to add tests. No exceptions for "trivial" changes.

---

## What
<!-- One-line summary of the change. -->

## Why
<!-- The problem being solved or the motivation. Link issues with `Closes #123`. -->

## How
<!-- Key implementation choices, trade-offs, anything a reviewer should look at first. -->

## Screenshots / GIFs
<!-- Required for any user-visible UI change. Drag-drop here. -->

## Documentation
- [ ] `README.md` updated, or N/A — explain: 
- [ ] `FEATURES.md` updated, or N/A — explain: 
- [ ] `SETUP.md` updated, or N/A — explain: 

## Verification
- [ ] `npm run typecheck` passes
- [ ] `npm run test:coverage` passes (thresholds enforced)
- [ ] Manually verified the change end-to-end (describe below)

**Manual verification steps:**
<!-- e.g. "Connected a Jira API token, confirmed Tickets card renders, dragged it across the grid, reloaded — layout persisted." -->

## Type of change
- [ ] Bug fix (non-breaking) — includes a regression test
- [ ] New feature (non-breaking) — includes unit tests
- [ ] Breaking change — includes tests + migration notes
- [ ] Docs only
- [ ] Refactor / chore (no behavior change) — existing tests must still pass without modification

## Checklist
- [ ] Targeted at the `prod` branch
- [ ] Conventional-commit style title (`feat:`, `fix:`, `docs:`, etc.)
- [ ] No `.env`, tokens, DBs, or `layout_config.json` committed
- [ ] No commented-out code or dead branches left behind
- [ ] New connector fields (if any) include `placeholder`, `helperText`, and `stripUrl: true` where relevant — see [CLAUDE.md](../CLAUDE.md)
