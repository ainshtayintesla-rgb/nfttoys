# NFTToys — Project Rules for Claude

## Working scope

- **Primary workspace: `/root/my-works/nfttoys-dev`** — all new features and fixes go here (`dev` branch).
- **`/root/my-works/nfttoys-pro`** — touch ONLY when there is a deployment failure, k3s/CI error, or a bug that only manifests on `main`. Never push features there directly.
- Push only to `dev` branch. `main` is updated automatically from `dev` via CI/CD. Never `git push origin main`.

## Before every git push

1. Bump patch version in `client/package.json` (e.g. `0.3.2` → `0.3.3`).
2. Add a new entry at the top of `CHANGELOG.md` with today's date and a clear summary.
3. Commit all changed files with a descriptive conventional commit message.
4. Push only: `git push origin dev` from `/root/my-works/nfttoys-dev`.

## Code quality rules

- **Read before touching.** Always read the file fully before editing. Understand the existing patterns.
- **Do not break UI/UX.** Check surrounding components, styles, and data flow before changing anything visual.
- **Minimal changes.** Only change what was asked. No cleanup, refactoring, or "improvements" beyond the task.
- **No new files** unless strictly necessary.
- **No speculative error handling** — only handle what can actually fail.
- **Follow existing code style** in every file (indentation, naming, structure).

## Stack

- Backend: Node.js + Express + Prisma + TypeScript — `server/src/`
- Frontend: Next.js + React + TypeScript — `client/src/`
- Database: PostgreSQL (Prisma ORM)
- Deployment: Docker + k3s
- Git remote: `https://github.com/ainshtayintesla-rgb/nfttoys.git`

## Branch model

| Local directory      | Remote branch | Purpose                        |
|----------------------|---------------|--------------------------------|
| `nfttoys-dev`        | `dev`         | Active development (edit here) |
| `nfttoys-pro`        | `main`        | Production (CI auto-syncs)     |

## Merging / CI conflicts

If CI reports "non fast-forward path detected" on `main`:
1. `cd /root/my-works/nfttoys-dev`
2. `git fetch origin && git merge origin/main --no-edit`
3. `git push origin dev`
Never push directly to `main` to fix conflicts.
