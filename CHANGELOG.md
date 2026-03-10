# Changelog

## [0.3.2] - 2026-03-10

### Changed
- NFT staking: reward per hour is now returned for available (unstaked) NFTs in the state endpoint, so users see the earning rate before staking.
- NFT staking UI: available NFTs now display the reward rate (`+30 UZS/h`, `+60 UZS/h`, `+120 UZS/h`) based on rarity instead of the raw rarity label.
- NFT staking UI: staked positions now show rarity and reward rate (`common · +30 UZS/h`, etc.) alongside the pending reward.

## [0.3.1] - 2026-03-10

### Fixed
- Admin panel Updates tab no longer shows `fatal: not a git repository` error in k3s deployment. `UpdateService` now gracefully falls back to `COMMIT_SHA`, `COMMIT_DATE`, and `COMMIT_SUBJECT` env vars (injected at Docker build time) when `.git` is not present inside the container.
- Correct commit SHA, date, and message are now shown in the admin Updates tab after each deploy.

### Changed
- Telegram Mini App close confirmation dialog removed — the app now closes immediately without asking for user confirmation.
- Deploy pipeline split into two independent workflows: `deploy-app.yml` (API + Web, triggered by changes in `server/`, `client/`, `k8s/`) and `deploy-bots.yml` (Bot + Userbot, triggered by changes in `bot/`, `userbot/`). Bot no longer restarts on every frontend push.

### Added
- `NEXT_PUBLIC_WALLET_NETWORK` and `NEXT_PUBLIC_WALLET_V2_NETWORK` GitHub Actions secrets set to `mainnet`. Previously missing, causing wallet network to be empty string in production bundle.

## [0.2.26] - 2026-03-09

### Fixed
- Staking story boost no longer applies retroactively. Previously, when a story was shared the boost multiplier was applied to all accumulated hours since the last claim, causing the pending reward to inflate immediately (e.g. 300 UZS → 400+ UZS before any verification). Now the boost only applies to whole hours that elapsed **after** `sharedAt`: hours before the share use the base reward rate, hours from the first full tick after the share use the boosted rate.

## [0.2.25] - 2026-03-01

### Changed
- Admin `Top up` tab UI was tightened to match existing drawer standards: removed extra heading/lookup hint card and fixed inner drawer paddings so content is not stretched edge-to-edge.
- Confirm drawer for admin top-up now shows only `Recipient` and `Amount`, without search mode/status rows.
- After successful swipe confirmation, the drawer now stays open, shows a success check icon under the swipe control, and auto-closes after 5 seconds.
- Wallet history details drawer now shows sender as `System` for top-up operations and hides `Comment` and `Status` rows for top-ups.

### Added
- Added server-side idempotency for admin wallet top-up via required unique `transactionId` in `POST /admin/wallet/topup`.
- Added `WalletTransaction.requestId` (unique) with migration `20260301221000_wallet_transaction_request_id` to prevent duplicate balance increments on repeated confirm requests.

## [0.2.24] - 2026-03-01

### Changed
- Reworked `Admin -> Top up` recipient flow from `userId` lookup to shared `Username/Wallet` recipient selector using global `RecipientLookupField`.
- Added wallet suggestion behavior in admin top-up that matches wallet send UX (connected dropdown-up block above wallet input).
- Wallet-mode top-up now allows address-only targets (wallet exists without linked Telegram user), with confirmation drawer showing wallet details and swipe confirmation.
- Admin backend top-up API now supports recipient lookup by `username` or `wallet` via `GET /admin/wallet/recipient/search`.

### Added
- Added migration `20260301195500_wallet_transaction_nullable_userid` and schema update to allow nullable `WalletTransaction.userId` for address-only wallet operations.

## [0.2.23] - 2026-03-01

### Added
- Added a new Admin tab for manual wallet balance top up by Telegram user ID, with debounced user lookup, quick amount presets, and a swipe confirmation drawer.
- Added reusable UI component SwipeConfirmAction (client/src/components/ui/SwipeConfirmAction.tsx) for slider-style confirmation actions.
- Added admin backend endpoints: GET /admin/users/lookup and POST /admin/wallet/topup.
- Added locale strings for the new admin top up flow in en/ru/uz.

### Changed
- Admin page now uses extracted AdminCustomSelect and keeps the new top-up flow in dedicated BalanceTopupTab component to reduce page complexity.
- Added typed client API methods: api.admin.lookupUserById and api.admin.topupUserWallet.

## [0.2.22] - 2026-03-01

### Changed
- Replaced ~50 outline icons across 16 files with filled Ionicons 5 (`react-icons/io5`) for better visual consistency and action semantics.
- Wallet action buttons now use semantically correct filled icons (`IoWallet`, `IoCash`, `IoQrCode`, `IoSend`).
- Profile, settings, transactions, transfer modal, toy card, and navigation icons updated to filled variants.

### Fixed
- Production auto-update no longer kills the API server mid-update. Updates now run as a detached background process (`prod-update-runner.sh`).
- Added build marker tracking (`last-built-commit.txt`) to detect incomplete builds after failed updates.
- Admin panel correctly reports update progress phases (pulling, building, restarting, etc.) via status file polling.
- Old Docker images, deploy backups (keeps last 2), and npm cache are now cleaned after each update to prevent disk bloat.

## [0.2.21] - 2026-03-01

### Added
- Added reusable `RecipientLookupField` UI component (`client/src/components/ui/RecipientLookupField.tsx`) for shared `@username / wallet` recipient input with tab switch and suggestion slot.

### Changed
- Wallet `Send UZS` now uses the shared recipient lookup component while keeping existing username-lookup and wallet-fill behavior.
- NFT `TransferModal` now uses the same shared recipient lookup component for consistent UX and reduced duplicated code.
- Wallet suggestion block (resolved from username) now renders as a connected "open upward dropdown" style above the wallet input field.

## [0.2.20] - 2026-03-01

### Added
- Added reusable `SettingActionItem` UI component (`client/src/components/ui/SettingActionItem.tsx`) with three modes: `toggle`, `disclosure`, and `select`.

### Changed
- Settings rows now use a unified profile-like button style with consistent icon shells and spacing instead of the previous flat line layout.
- Language selector in Settings now uses the shared `select` row pattern (icon + value + dropdown) matching the same visual style as other settings actions.
- Notifications rows in Settings now use the shared setting action component, while preserving existing notification permission and toggle logic.

## [0.2.19] - 2026-03-01

### Added
- Added reusable `ActionLinkList` UI component (`client/src/components/ui/ActionLinkList.tsx`) to render joined or standalone profile/action links via props (`icon`, `label`, `subtitle`, `href`/`onClick`, `external`, `disabled`).

### Changed
- Settings page layout is now flat (no section cards/subheaders): only the main title remains, while language/toggles/notification controls render as standalone rows.
- Profile page social/action blocks now use the shared `ActionLinkList` component instead of local duplicated markup.
- Reordered profile action groups so `Wallet + Referrals` is shown above `Community Chat + Channel News`.

## [0.2.18] - 2026-03-01

### Added
- Added reusable global skeleton UI components: `Skeleton` and `WalletPageSkeleton` under `client/src/components/ui`.

### Changed
- Wallet page loading state now renders detailed skeletons matching the real layout (balance card, action buttons, tabs, and grouped transaction cards) instead of plain `Loading...` text.
- Wallet `Feed` and `NFT` tab loading states now use card-level skeleton groups that mirror actual transaction history blocks.

## [0.2.17] - 2026-02-28

### Added
- Added reusable UI primitives under `client/src/components/ui`: `BottomDrawer`, `SegmentedTabs`, `TxCard`, `DetailsTable`, and `RoundIconButton`.

### Changed
- Wallet page now uses shared UI primitives for history tabs, transaction cards, details tables, action icon shells, and all bottom drawers (receive/send/topup/withdraw + NFT/UZS details).
- Transactions page now uses shared `TxCard`, `DetailsTable`, and `BottomDrawer` for both filter and transfer-details drawers.
- NFT transfer modal now uses shared `SegmentedTabs` (recipient switch) and `DetailsTable` (info table), keeping existing behavior and content.
## [0.2.16] - 2026-02-28

### Added
- Added UZS transaction details drawer in Wallet `Feed` (opened by tapping a UZS history card) with table rows for sender, recipient, amount, optional fee, optional comment, timestamp, and status.

### Changed
- Wallet operations API now returns sender/recipient addresses, memo, and fee metadata so UZS details can render real transfer data.
- UZS details drawer fee row is now shown only to the sender side (`send`), hidden for receiver rows.
- NFT transaction details drawer fee row is now shown only for sender-side transactions, independent from memo presence.

## [0.2.15] - 2026-02-28

### Changed
- Unified recipient tabs style to fully rounded pill shape in both Send UZS drawer and NFT Transfer drawer, while keeping each block's existing sizing.
- Removed hardcoded burn label fallback in transactions and wallet NFT feed by using localized `burned` key fallback.

### Fixed
- Localized burn direction/status labels across RU/EN/UZ (`transactions_direction_burn` + `burned`) to avoid English-only `BURN/Burned` strings.

## [0.2.14] - 2026-02-28

### Added
- Wallet page now includes rounded Feed/NFT tabs under the balance card.
- NFT tab now renders NFT transaction cards and transaction details drawer with the same behavior/style as the transactions page.

### Changed
- Receive drawer subtitle was removed for a cleaner QR-only receive view.
- Wallet balance action icon buttons are now fully circular and slightly larger (icons increased too).
- Localized wallet receive labels for RU/UZ and added tab labels for RU/EN/UZ locales.

## [0.2.13] - 2026-02-28

### Changed
- Allowed sending UZS to your own wallet in POST /wallet/send; transfer now succeeds and only fixed fee is net-debited from sender balance.
- Allowed transferring NFT to your own wallet in POST /nft/transfer; transfer is processed and fee logic remains applied for system revenue.

## [0.2.12] - 2026-02-28

### Changed
- Send UZS confirm step now shows `Amount / Fee / Total debit` as a structured table (same visual format as NFT transfer drawer info table).
- Replaced per-row cards in Send UZS confirm step with table rows and separators for consistent wallet/NFT drawer styling.

## [0.2.11] - 2026-02-28

### Fixed
- Send UZS Continue button in step 1 now uses a dedicated full-width style (no mixed submit class), so it spans the drawer width consistently.
- Send UZS fee/total calculator card now uses the same surface structure as recipient input shell (@username) with aligned border/background/typography.
- Removed conflicting legacy selector .submitButton.continueButton from wallet styles to prevent width regressions.

## [0.2.10] - 2026-02-28

### Fixed
- Send UZS amount input now uses the same input shell style as recipient username/wallet field for consistent visual and focus behavior.
- Continue button in Send UZS step is now forced to full width across the drawer content area.
- Fee/Total summary card in Send UZS now matches username field surface and text weight/contrast.

## [0.2.9] - 2026-02-28

### Fixed
- Wallet send amount input in drawer now keeps text anchored correctly and aligned with recipient field shell.
- Continue button in Send UZS step now spans full drawer width.
- Send amount placeholder was removed and send fee/total card surface now matches recipient input contrast.

## [0.2.8] - 2026-02-28

### Added
- Wallet Send drawer now has 2-step flow: input step with `Continue`, then confirm step with fixed recipient/amount summary, optional comment, and swipe-to-confirm.
- Wallet send API now accepts optional `memo` in request payload.

### Changed
- Send drawer close action now acts as Back on confirm step (same interaction pattern as NFT transfer drawer).
- Send draft values (recipient, amount, comment) are preserved in-memory across close/reopen until successful transfer.

## [0.2.7] - 2026-02-28

### Fixed
- Wallet Send drawer now matches NFT transfer behavior: username tab shows only prefix avatar, with no extra recipient card or inline loader.
- Wallet recommendation card is shown only on the wallet tab and only from an exact username match; tapping it fills the recipient wallet.
- Send drawer fields now persist in memory after close/reopen until a successful send clears the draft.
- Wallet send tab styles were aligned with the profile NFT transfer drawer (`tabs`, input shell, and suggestion card).

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
