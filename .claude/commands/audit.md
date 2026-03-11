Perform a security and code quality audit of the nfttoys-dev project.

Audit areas:

### Security
- Authentication and authorization checks on all routes (walletV2Auth, ownership checks)
- Input validation — user-supplied strings used in DB queries or responses
- SQL/Prisma injection vectors
- Rate limiting — is it applied on sensitive endpoints?
- Secrets — any hardcoded tokens, keys, or credentials in source files
- CORS, headers, and cookie settings

### API correctness
- All endpoints return consistent error shapes
- BigInt serialization (must use `.toString()`, never raw JSON)
- Missing null checks on optional fields

### Database
- Unindexed fields used in WHERE clauses
- Missing transactions where atomicity is needed
- N+1 query patterns

### Frontend
- Sensitive data exposed in client-side state or localStorage
- API error messages leaked to the UI verbatim
- Missing loading/error states

Report format:
- List each finding with: file path + line number, severity (critical / high / medium / low), description, recommended fix.
- Do not auto-fix. Report only, unless the user asks to apply fixes.
