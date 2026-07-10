# Roadwork Input Helper Contract

This file protects the working roadwork input helper. Do not change these rules as part of unrelated fixes.

## Purpose And Boundaries

- The `공사입력 도우미` menu embeds the roadwork site and is an assistive input screen; it must not replace the roadwork site's own save workflow.
- Auto-fill may populate only a newly editable daily-log screen. It must never invoke the roadwork site's save action.
- The helper must keep the roadwork site's current daily-log date synchronized with its local data date. A date mismatch must disable auto-fill.

## Data Contract

- `GET /api/roadwork-helper/all?date=YYYY-MM-DD` returns `flow`, `electricity`, `medicine`, and `kit` for the configured site scope.
- The helper restores operational data for the requested date before building those rows; restore failure is logged but must not prevent a local-data response.
- Flow excludes power types, electricity includes only power types, and medicine is limited to the roadwork-required medicine names.
- The local helper view must retain safe empty-array fallbacks and provide tab-separated copy for each section and for all sections.

## Auto-fill Safety Rules

- The embedded page must keep `nodeintegration` and `enableremotemodule` disabled.
- Auto-fill is enabled only when the roadwork daily-log screen is visible, its date is editable, the page date equals the helper date, and there is local data to fill.
- Immediately before auto-fill, the helper must reload the latest payload through `RoadworkHelperModel.fetchAll(roadworkStatus.date)`.
- The user must review the populated roadwork form and save it directly in the roadwork site.

## Change Discipline

- Any change to `src/features/roadwork-helper/*`, `server/routes/roadworkHelperRoutes.cjs`, or the roadwork preload/IPC integration must be intentional and verified with `npm run validate`.
- Do not mix roadwork helper changes with unrelated UI, authentication, mapping, report, or updater fixes.
