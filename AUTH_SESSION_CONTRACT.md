# Auth And Attendance Contract

This file protects login, session restore, and attendance behavior. Do not change these rules as part of unrelated fixes.

## Login Sources

- Admin users (`admin`, `group_admin`, or name `admin`) must authenticate through remote discovery only.
- Admin users must not be saved into the local `members` table as a reusable login cache.
- Field workers try local login first, then remote discovery fallback.
- Remote discovery must read Google Sheets first and use Drive JSON backup if Sheets is unavailable or empty.

## Session Rules

- App startup shows the existing branded animation while server discovery and session restore run; intermediate connection/session messages stay hidden.
- After manual login, the workspace opens immediately. Record-grid preloading continues in the background and must not block the dashboard.
- Field worker sessions may be saved to `localStorage` only for the same local calendar day.
- Admin sessions must not be persisted in `localStorage`.
- Saved field worker sessions must be revalidated through local login before restore.
- An app update must preserve a same-day field worker session. After restart, the branded intro remains visible while the local server starts and the saved credentials are revalidated, then the workspace opens directly without showing the login screen.
- A version-change marker is diagnostic state only. It must be acknowledged and cleared without deleting the saved field worker session.
- Local authentication and session revalidation must enter the workspace without waiting for location lookup or attendance recording.

## Attendance Rules

- Field worker login creates or reuses one open attendance row for the same member and date.
- Field worker attendance must not request or compare PC coordinates. Site identity already comes from the locally selected site.
- Remote attendance classification must depend only on confirmed remote-session evidence, never on missing or mismatched coordinates.
- A running tray/service process is recorded as supporting evidence only and must not by itself classify the login as remote.
- Confirmed remote sessions store the connection method or program name in `remote_session_type`.
- Attendance write failure must not block a successful field worker login.
- Location lookup and attendance recording run in the background after workspace entry, and their state must be shown in the existing status bar.
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

## Login Server Startup Rules

- Development startup must rebuild native modules for the exact Electron version before launching Electron.
- `/api/ping` alone must never be treated as proof that login is ready.
- Startup is ready only after `/api/auth/login-hint` responds successfully.
- If database or auth route initialization fails, the server must exit instead of remaining as a ping-only partial server.
- Electron packaging must rebuild and smoke-test `better-sqlite3` before an installer or release is accepted.
- Uploaded diagnostics must include `machine` and `runtime` so development PCs cannot be mistaken for field installations.
