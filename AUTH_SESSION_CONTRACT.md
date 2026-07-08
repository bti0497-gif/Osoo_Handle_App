# Auth And Attendance Contract

This file protects login, session restore, and attendance behavior. Do not change these rules as part of unrelated fixes.

## Login Sources

- Admin users (`admin`, `group_admin`, or name `admin`) must authenticate through remote discovery only.
- Admin users must not be saved into the local `members` table as a reusable login cache.
- Field workers try local login first, then remote discovery fallback.
- Remote discovery must read Google Sheets first and use Drive JSON backup if Sheets is unavailable or empty.

## Session Rules

- Field worker sessions may be saved to `localStorage` only for the same local calendar day.
- Admin sessions must not be persisted in `localStorage`.
- Saved field worker sessions must be revalidated through local login before restore.
- If the app version changed, stored sessions must be cleared before automatic restore.

## Attendance Rules

- Field worker login creates or reuses one open attendance row for the same member and date.
- Attendance write failure must not block a successful field worker login.
- Logout closes only the current open attendance row and marks it unsynced.
- End-of-day auto logout closes stale field worker sessions and marks them unsynced.
- Attendance BigQuery sync may mark local rows synced only after BigQuery succeeds.

## Active User Rules

- Successful local or discovery login must update the server-side active user.
- Logout and logout-current must clear the server-side active user.
- Admin-only behaviors must be based on the active user role/name, not on a UI flag.

## Change Discipline

- Any change to `server/routes/authRoutes.cjs`, `src/features/auth/*`, `activeUserSessionService.cjs`, or attendance sync must be intentional and tested with `npm run validate`.
- Do not mix auth/session/attendance changes with unrelated UI, mapping, report, or updater fixes.
