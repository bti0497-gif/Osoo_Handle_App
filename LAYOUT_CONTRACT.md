# Layout Contract

This app has a fixed shell layout contract. Feature work must not break it.

## Non-Negotiable Rules

- `Header`, `Sidebar`, `main-content-workspace`, and `StatusBar` must remain visible even if an individual feature view fails.
- The left sidebar is fixed by `--sidebar-width`; only the right workspace grows or shrinks with the monitor resolution.
- A feature view root must fill the workspace with `width: 100%`, `height: 100%`, `min-width: 0`, and `min-height: 0`.
- Do not set a feature root width from calculated table/grid width. Put wide grids inside an internal scroll container.
- Before API/settings data is loaded, arrays must default to `[]` or a safe fallback list.
- Feature views must not throw during initial render. A broken feature should be contained by `WorkspaceErrorBoundary`, not collapse the app shell.

## Development Gate (Mandatory)

Before starting any UI or feature change, confirm all items below.

1. The app shell remains fixed: Header, Sidebar, Workspace, StatusBar.
2. The feature is mounted as a workspace widget, not as a full-screen override.
3. The feature root uses `width: 100%`, `height: 100%`, `min-width: 0`, `min-height: 0`.
4. Long tables/grids/webviews get their own internal scroll container.
5. No feature root uses viewport-based or calculated-width hacks to force its own layout.
6. ViewModel data has safe defaults before `.filter`, `.map`, `.length`, or grid rendering.
7. After the change, run `npm run validate` and confirm the result.

## Review During Development

- At the start of a task, check this contract first.
- During implementation, verify that the change only affects the feature widget and its internal modules.
- Before finishing, re-check the contract to ensure no shell or workspace layout regression was introduced.

## New Screen Checklist

1. Keep the top-level app shell unchanged.
2. Put long tables, grids, previews, and webviews inside their own scrollable area.
3. Make the feature root responsive to the workspace, not to its content width.
4. Add safe defaults for ViewModel data before rendering `.filter`, `.map`, or `.length`.
5. Run `npm run validate` after the change.
