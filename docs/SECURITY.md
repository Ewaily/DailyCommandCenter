# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via GitHub Security Advisories:

👉 **https://github.com/Ewaily/DailyCommandCenter/security/advisories/new**

Include as much of the following as you can:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- Affected versions / commits.
- Any suggested mitigation.

You will receive an acknowledgement within **72 hours**. We aim to provide a triage assessment within **7 days** and a fix or mitigation timeline within **14 days**, depending on severity.

## Scope

In scope:
- The Node/Express server (`src/server/`)
- The Vite frontend (`src/frontend/`)
- OAuth flows (`src/server/auth/`)
- SQLite storage layer (`src/server/db.ts`, cache, identities)
- Documented integrations (Google Calendar, Microsoft Outlook, Slack, Jira, GitHub, Notion, ClickUp)

Out of scope:
- Vulnerabilities in third-party providers (report to the provider directly).
- Issues that require physical access to a user's already-unlocked machine — this app is single-user, single-machine by design and trusts the local OS user boundary.
- Self-XSS that requires the user to paste attacker-controlled scripts into their own browser console.

## Supported versions

While the project is pre-1.0, only the latest commit on the `prod` branch is supported. After 1.0 we will publish a support matrix here.

## Hardening guidelines for users

- Never share your `.env` file or screenshot it. It contains long-lived tokens.
- Run the app on `localhost` only. Do not expose port 3000 to your network without an authenticating reverse proxy.
- Rotate provider tokens periodically (Slack, GitHub, Jira, Notion, ClickUp).
- The SQLite DB at `~/.daily-command-center/db.sqlite` is encrypted only as much as your filesystem encrypts it. On macOS, FileVault should be on. On Linux, use full-disk encryption.

## Disclosure policy

We follow **coordinated disclosure**. Once a fix is released, we will credit the reporter (unless anonymity is requested) in the release notes.
