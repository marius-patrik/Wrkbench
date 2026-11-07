# Wrkbench browser client — architecture ownership

The Pages branch provides a real React 19/Cordis/Dockview build. This architecture branch corrects registration and layout ownership. **Phase 1 acceptance remains separate from successful compilation.**

- **Cordis:** feature package lifecycle, service contributions, one tool registry and view factories. Disposing a plugin reversibly unregisters its tool and view; tabs remain as recoverable placeholders.
- **Feature packages:** one independently imported lazy View entrypoint per feature. Shell no longer contains a switch over feature implementations. Presentational helpers are currently shared under `packages/client/src/views`; splitting business services further is future work.
- **Dockview:** exclusive authority for tab ordering, groups, drag/drop, splits, floating windows, active tab and serialized layouts. `closeEmptyGroups={false}` preserves empty groups as drop targets. No competing layout tree.
- **Cross-workbench:** journal tab ID/title/params/source/target *before* removing source. Persist destination Dockview snapshot before acknowledging handoff; retry pending records on navigation/reload. If storage fails, original tab is not removed.
- **Filesystem:** IndexedDB transactions for revision-CAS saves and atomic rename. OPFS mirror is best effort, never canonical. Dirty buffers live in client state. Save completion does not clear newer unsaved content.
- **Commands and context:** ToolRegistry validates Zod input/output and permission gates; ViewActionService routes feature-open actions to the active window manager, not window CustomEvents.
- **Routing:** hash-based Wouter routing, compatible with the `/Wrkbench/` GitHub Pages project base path.
- **External adapters:** agent inference, remote processes, Docker, Tailscale, trading, native monitor control and MCP server remain unconnected. A UI label does not imply a backend exists.

**Verification:** `cd next && bun install && bun run typecheck && bun run test:core && bun run build && bun run test:e2e`. Tests must use an HTTP origin. The branch's CI is the authority for actual dependency compilation.
