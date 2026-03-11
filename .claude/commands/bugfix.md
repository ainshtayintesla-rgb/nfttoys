Carefully diagnose and fix a bug in the nfttoys-dev project.

Steps:
1. Read the relevant files fully before touching anything.
2. Identify the root cause — do not guess. Trace the code path from the symptom to the source.
3. Check what other code depends on the area you're about to change (search for usages with Grep).
4. Apply the minimal fix. Do not refactor surrounding code.
5. Verify the fix doesn't break:
   - Existing TypeScript types
   - Related routes or components that use the same function/data
   - UI/UX — if a visual component is involved, re-read the JSX and styles
6. Report: what was the bug, where was it, what was changed, and what was NOT changed.

Rules:
- Never change more than what is necessary to fix the bug.
- If the fix requires a schema/migration change, flag it explicitly before proceeding.
- If the root cause is unclear, ask one clarifying question before writing any code.
