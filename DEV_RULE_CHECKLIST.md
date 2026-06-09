# Development Rule Checklist

Use this checklist for every UI, menu, layout, or feature change.

## Before coding
- [ ] I reviewed LAYOUT_CONTRACT.md and understood the shell/workspace rules.
- [ ] The change is a workspace widget/module change, not a full app-shell rewrite.
- [ ] The feature root will keep `width: 100%`, `min-width: 0`, `min-height: 0`.
- [ ] Large grids/tables/webviews will use internal scroll containers.
- [ ] No viewport-based or calculated-width hacks are introduced.

## During implementation
- [ ] The feature stays inside the existing shell structure.
- [ ] Menu wiring only changes the widget entry point, not the whole app layout.
- [ ] API/hook/route logic remains inside the feature folder.

## Before finishing
- [ ] I re-checked the contract against the final change.
- [ ] I ran `npm run validate` and confirmed the result.
