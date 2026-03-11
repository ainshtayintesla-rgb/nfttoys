Perform a proper versioned git push for the nfttoys-dev project. Follow these steps exactly:

1. Read `client/package.json` and get the current version.
2. Increment the patch number (e.g. `0.3.2` → `0.3.3`).
3. Update `client/package.json` with the new version.
4. Read `CHANGELOG.md` and prepend a new entry at the top (after `# Changelog`) with:
   - `## [NEW_VERSION] - YYYY-MM-DD` (use today's date)
   - A `### Changed` / `### Fixed` / `### Added` section summarizing all changes since the last version.
5. Stage all modified files: `git add` only the relevant files (not `.env`, secrets, build artifacts).
6. Commit with a conventional commit message ending with:
   `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
7. Run: `git push origin dev`
8. Confirm the push succeeded and print the new version and commit hash.

Working directory: `/root/my-works/nfttoys-dev`
Never push to `main` directly.
