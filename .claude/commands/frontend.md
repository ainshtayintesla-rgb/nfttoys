You are making a frontend change in this project. Follow these rules strictly before writing any code.

## Before touching any component

1. Read the full `.tsx` file, not just the section you plan to change.
2. Read the corresponding `.module.css` file to understand existing style classes.
3. Check what props/data the component receives and from where.
4. Search for all places this component or function is used (`Grep`).

## UI/UX rules

- Do not add, remove, or rename CSS classes without checking if they are defined in the `.module.css` file.
- Do not change layout structure (flex/grid, padding, margin) unless explicitly asked.
- Do not change font sizes, colors, or spacing values without being asked.
- Keep the visual hierarchy consistent — new elements should match the style of siblings.
- Never remove loading states, error states, or empty states — they are intentional.
- If adding a new UI element, reuse existing components (`Button`, `BottomDrawer`, etc.) from `@/components/ui/`.

## Data flow rules

- Trace where the data comes from: API response → type in `api.ts` → prop → render.
- If you add a new field to the UI, make sure it exists in the type (`WalletV2NftStakingPositionRow`, etc.) and is returned by the backend.
- Never display raw API error strings directly in the UI — use `safeErrorMessage()` or a mapped message.

## After making changes

- Re-read the modified JSX to confirm indentation and structure is consistent.
- Confirm no existing elements were accidentally removed or reordered.
- Check that TypeScript types are satisfied (no implicit `any`, no missing fields).
