# Availability planning

Apply `supabase/migrations/20260911_feasible_availability_approval.sql` in
Supabase SQL Editor after the existing availability pair-queue migration.
Deploy the app build with this migration. Existing data is not rewritten when
the migration is applied.

For upcoming periods, **Approve** now searches for a complete valid team
arrangement before saving. Approved choices and the employee's submitted choices
stay fixed during this check. Other employees' drafts are preferences; they may
need to change them to complete the period. The check includes exactly five OFF
days, six of each shift, daily capacity, and no Night immediately followed by Day
within the selected period.

If approval is blocked, **Find a correction** first tries adjusting that
employee's choices while preserving earlier approvals. If that is impossible,
it searches with earlier choices available to change. **Resolve blocked choices**
also works before the stuck employee has completed their choices. It first checks
whether the existing approvals can be kept.

The manager reviews changed dates and employees before applying a correction.
The search prefers existing choices but does not guarantee the smallest possible
number of changes. The full proposed arrangement can be expanded in the preview.
Only the employee being approved and already scheduled/approved employees are
saved; other employees keep their drafts and submission state.

The search runs in a Web Worker with a time limit. A timeout is not treated as
proof that the schedule is impossible, and cannot approve the schedule. A
rest-day pattern may itself be impossible; the app reports this without relaxing
the shift or rest-day constraints.

The database independently validates the full proposed arrangement. It compares
the current data with the preview snapshot under short table write locks, then
updates approval and assignments in one transaction. If someone changed the
data during the check or preview, the manager must check again. Assignment IDs
are preserved. Corrections to shifts linked to pending swaps or open-shift
records are blocked. This workflow is available with the Supabase provider.

Run `npm test` for solver regressions and isolated PostgreSQL tests (PGlite).
These tests do not connect to the live Supabase database. Run `npm run build`
to check TypeScript and the production worker bundle.
