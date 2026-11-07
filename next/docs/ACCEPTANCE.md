# Phase 1 acceptance — verification required

All criteria below are **pending real dependency installation and browser testing**. A source import or mocked control does not establish the acceptance result.

| Acceptance gate | Expected proof | Current status |
|---|---|---|
| React 19 with actual Cordis/Dockview | `bun pm ls` plus production build, source imports | Source integrated; unverified runtime |
| Initial HTTP boot | `bun run dev`; Chromium `page.goto` to real origin; zero JS exceptions | Pending |
| All groups tabbed | Every split/empty/floating group displays a native Dockview tab bar/drop target | Pending |
| Cross-group drag | Drag tab between groups; preserve content, view identity, dirty state | Pending |
| Tiled/floating/popout layouts | Move/resize, serialize/reload and restore exactly | Pending |
| Workbench isolation | Change one layout, switch and return, original remains | Pending |
| File durability | Create/edit/save, reload, reopen; content/revision retained | Pending |
| CAS conflict handling | Two tabs with same base revision; stale save rejected and recoverable | Pending |
| Dirty-state protection | Closing/reloading while unsaved: explicit recovery, no silent loss | Pending — reload only guarded |
| Plugin lifecycle | Load/unload each package; UI/tools removed atomically | Pending — registration lifetime only |
| ToolRegistry | Zod input/permissions/output tests | Pending |
| Context manager | View overrides vs global context with correct inheritance | Pending |
| Display manager | Single status bar entry; popout permission failures handled | Pending |
| Responsive accessibility | 390px and desktop; keyboard and ARIA interaction tests | Pending |
| Offline/unsupported status | No false claims of connected external services | Source present, manual verification pending |
| Standalone compiled HTML | Build from actual packages; inline assets; open in ordinary browser | Pending — cannot compile offline |

Run `bun run verify` on a machine with the real packages installed. Failure of any gate must be recorded; do not claim Phase 1 complete until all acceptance gates that belong to Phase 1 are satisfied.

## New architecture gates

- Real `bun install`, `bun run typecheck`, `bun run test:core`, `bun run build`, and browser boot must pass on the integration branch.
- Disable/re-enable a feature through Extensions; tool and renderer registrations follow the Cordis fiber lifecycle; existing tabs persist as recoverable placeholders.
- No hardcoded feature-kind view switch or `wrkbench:openkind` event bus in the app shell.
- Compile and verify the deployed build before merging into the Pages publishing branch.
