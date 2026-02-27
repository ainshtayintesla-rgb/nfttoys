# Changelog

## [0.2.2] - 2026-02-27

### Fixed
- Transfer NFT drawer: removed redundant "Comment" label above the input.
- Transfer NFT drawer: moved live character counter inside the comment field to the bottom-right corner.

## [0.2.1] - 2026-02-27

### Fixed
- Update service now normalizes legacy local branch master to main, preventing git fetch origin master failures in the Updates tab.

## [0.2.0] - 2026-02-27

### Added
- Wallet page (`/wallet`) with UZS balance card and wallet address copy action.
- Wallet actions: `Top up` (bottom drawer flow) and `Withdraw` with server-side endpoints.
- Profile UI update: `Wallet` and `Referrals` grouped into a single action card.
- New locale strings for wallet and updates screens (RU/EN/UZ).

### Changed
- Admin `Updates` tab now renders changelog content as Markdown instead of plain preformatted text.
- Updates preview is limited to the latest changelog release section.

### Fixed
- Update API/client integration and admin routes needed for update status/check/apply flows.

## [0.1.0] - 2026-02-27

### Added
- Admin panel tab `Updates` with commit-based update checks.
- Manual update flow from admin panel with one-click apply.
- Auto-update scheduler for production mode with configurable interval.
- Update status API with current/remote commit, version, and changelog preview.

### Changed
- Admin server routes expanded with update-control endpoints.
- Version/changelog data is now surfaced in admin UI.
