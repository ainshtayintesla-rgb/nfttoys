# Changelog

## [0.2.6] - 2026-02-28

### Added
- Wallet send drawer now resolves recipient profile for `@username` and `LV-...` wallet lookups, including avatar preview.
- New backend endpoint `GET /wallet/recipient/search` and client API method `api.wallet.findRecipient(...)`.

### Changed
- Wallet send drawer UI cleanup: removed helper subtitle, removed recipient/amount labels, and removed quick amount chips.
- Amount input formatting now uses spaced thousands (`1000 -> 1 000`) in wallet drawers.
- Username send field now swaps `@` prefix to recipient avatar when an exact user is found.
- Global input zoom fix: all `input/textarea/select` fields enforce `16px` to prevent focus zoom in mobile webview.

## [0.2.5] - 2026-02-28

### Added
- Wallet balance card now has a new Send action with a dedicated bottom drawer.
- UZS send flow supports recipient by @username or LV- wallet address and applies fixed fee 71 UZS.
- Backend endpoint POST /wallet/send with fee routing to admin/system wallet and sender/recipient operation history entries.

### Changed
- Wallet page removed standalone address card; actions are now 4 icon-first buttons in one horizontal row with labels below.
- Wallet action drawer now includes send recipient tabs and fee/total debit summary block.
- Wallet history now supports Send and Receive operation labels.

## [0.2.4] - 2026-02-27

### Added
- Wallet balance card now includes a new `Receive` action with a dedicated bottom drawer.
- Receive drawer now includes QR rendering, short `LV-...XXXXXX` address preview, and icon-only copy/share controls.

### Changed
- Wallet transactions list is now rendered as standalone cards (no outer wrapper card), matching NFT history layout.
- Wallet history section title was removed for a cleaner stream layout under the wallet address card.

## [0.2.3] - 2026-02-27

### Added
- Wallet operations history block on `/wallet` with lazy loading (cursor pagination).
- Backend `wallet_transactions` storage and new endpoint `GET /wallet/operations`.

### Changed
- Wallet page layout: removed top title/subtitle and moved focus to cards.
- Wallet history cards now match NFT transactions history visual style (date headers and card layout).
- Profile wallet action card now hides wallet address subtitle.

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
