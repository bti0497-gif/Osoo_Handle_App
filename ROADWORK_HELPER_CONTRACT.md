# Roadwork Input Helper Contract

This file protects the working roadwork input helper. Do not change these rules as part of unrelated fixes.

## Purpose And Boundaries

- The `공사입력 도우미` menu embeds the roadwork site and is an assistive input screen; it must not replace the roadwork site's own save workflow.
- Auto-fill may populate only an editable daily-log screen, including an existing unapproved daily log. It must never invoke the roadwork site's save action.
- The helper must keep the roadwork site's current daily-log date synchronized with its local data date. A date mismatch must disable auto-fill.

## Data Contract

- `GET /api/roadwork-helper/all?date=YYYY-MM-DD` returns `flow`, `electricity`, `medicine`, and `kit` for the configured site scope.
- The helper restores operational data for the requested date before building those rows; restore failure is logged but must not prevent a local-data response.
- Flow excludes power types, electricity includes only power types, and medicine is limited to the roadwork-required medicine names.
- The local helper view must retain safe empty-array fallbacks and provide tab-separated copy for each section and for all sections.

## Auto-fill Safety Rules

- The embedded page must keep `nodeintegration` and `enableremotemodule` disabled.
- The primary/single-site window must retain the existing `persist:osoo-roadwork` session partition. A secondary bidirectional site window must use a site-specific persistent partition so its roadwork login session cannot overwrite or reuse the other direction's session.
- Auto-fill is enabled only when the roadwork daily-log screen is visible, its own save action is enabled, the page date equals the helper date, and there is local data to fill. Date-picker availability is not an editability signal.
- Immediately before auto-fill, the helper must reload the latest payload through `RoadworkHelperModel.fetchAll(roadworkStatus.date)`.
- The user must review the populated roadwork form and save it directly in the roadwork site.
- When photo upload support is used for an editable daily log, each of the four photo boards must be inspected first. A board that already contains a photo must be preserved and skipped; only an empty board with a matching local QnTECH photo may receive one new photo. Missing local photos must leave the board empty.
- Local photo paths must not be exposed through diagnostics. Electron may hand the renderer only a short-lived opaque token, must verify the requesting host and roadwork webview origin again, and must record only per-item outcomes (`existing`, `missing`, `added`, or `failed`).
- Only the separate popup titled `도로통합플랫폼 안내` whose body contains `[안전한 PC 사용을 위한 공지]` and `오늘 하루 그만보기` may be dismissed automatically.
- Login forms and verification dialogs for SMS confirmation codes, OTP, or two-step verification must never be dismissed automatically.
- App startup, update restart, or a missing app login session must not clear a roadwork persistent partition. Roadwork cookies and storage may be cleared only by the explicit app logout lifecycle.
- Registering session keep-alive must immediately verify the existing direction-scoped session. Keep-alive diagnostics may contain only the trigger/source, success or safe error type, HTTP status, origin/path, redirect-to-login result, and check time; URL queries, cookies, and credentials must never be recorded.
- An unexpected return to the roadwork login page must probe the last non-login path and record that safe keep-alive result before asking the user to sign in again. It must not clear the persistent partition automatically.

## Change Discipline

- Any change to `src/features/roadwork-helper/*`, `server/routes/roadworkHelperRoutes.cjs`, or the roadwork preload/IPC integration must be intentional and verified with `npm run validate`.
- Until field evidence confirms the photo workflow is stable, `photo-stage-started`, every per-item outcome, and `photo-stage-completed` must remain explicit diagnostics and must not be removed by generic successful-API log suppression.
- Successful, existing-photo, and missing-photo outcomes are delivered in the normal 30-minute diagnostic bundle. File-injection failure, missing board, row timeout, discovery failure, and a completed stage with failures must request immediate diagnostic upload.
- Photo diagnostics may contain only the date, logical item key, counts, and result. They must never contain a local path, opaque file token, file contents, or roadwork credentials.
- Do not mix roadwork helper changes with unrelated UI, authentication, mapping, report, or updater fixes.
- Opening the roadwork helper must read its URL and direction-scoped credentials only from the local database through the roadwork IPC handlers.
- Opening the roadwork helper must never wait for Google Sheets, `SettingsModel`, `/api/settings`, or another network configuration request.
- A violation of this local-only page-open contract must fail `scripts/validate-directional-web-credentials.cjs` and therefore block the release validation.
