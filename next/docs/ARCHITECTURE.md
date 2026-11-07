# Wrkbench client architecture — implementation boundaries

## One Dockview layout owner

`DockviewReact` and `DockviewApi` own the layout graph, all tab groups, active panels, group splits, drag-and-drop and floating/popout windows. The app owns only view state and per-workbench serialized Dockview snapshots. `api.toJSON()` and `api.fromJSON()` are the layout persistence contract. React does not independently reorder panels or hold a parallel BSP tree.

The UI uses tab bars for *every* editor group including currently empty groups (`closeEmptyGroups={false}`). Dragging tab headers across groups uses Dockview's own mechanics. Tab context menus provide close, float, popout and workbench transfer. Transfer to a different workbench stages a view identity/params record and mounts the same panel ID in the destination; this is **a browser-local handoff**, not a transparent remote transfer.

## Cordis plugin host

`createClientHost()` uses `new Context()`, `ctx.plugin()` and `root.fiber.dispose()`. `FeatureCatalog extends Service` exposes feature contributions to the shell; `ToolService extends Service` exposes a single `ToolRegistry`. Each feature package registers through `defineFeature` with `ctx.effect()` for scoped, reversible registration. Each plugin registers both a view descriptor and a `feature.<kind>.open` Zod-validated ToolRegistry contribution; unloading the Cordis fiber disposes both.

Current limitation: 31 packages own **registration descriptors**, while most UI renderers and local state are still hosted in shared `views/Features.tsx`. This is a genuine Cordis lifecycle integration, but not yet fully isolated feature-owned services and renderers. Separating feature-owned view bundles/services is required for full Phase 1 acceptance. External SDK/plugin install and unload UX are not implemented.

## Data persistence

The browser `BrowserFiles` module opens an IndexedDB store keyed by path. Save uses a readwrite transaction that reads current revision, verifies expected revision, then writes content and incremented revision atomically. A conflicting write aborts with `FileConflictError`. OPFS mirrors successful writes as a best-effort cache and is **not** authoritative. Per-tab scratch state, dirty docs, session transcripts and workbench preferences live in Zustand with `localStorage` persistence. Cross-tab collaboration, full migration/recovery, OPFS coherency and durable outbox have not been accepted.

## Tool and context contracts

`ToolRegistry` performs `z.input.parse`, permission gate, then `z.output.parse`. Context includes runtime/account/project/session, active view ID and workbench. Client ToolService registers local UI tools when Cordis host becomes ready. Context switching changes available future routing, but does not invent a connected external provider.

## Security boundary

No network access, external programs, native device control or agent calls are executed through placeholder providers. A runtime must be attached and authorized before any privileged tool is introduced. Shell escape is prohibited: the xterm view offers only a small fixed browser-command grammar.

## Build model

Normal build: Rsbuild + React19. Standalone: one Rsbuild production compilation with script and style inlining, plus validated inline Monaco worker bodies. The standalone pipeline is intentionally strict; it **fails** if assets or workers are not actually self-contained. No handwritten replacement React DOM implementation is acceptable.

## Current verification

Source syntax and structural checks can run offline. Actual dependency resolution, typecheck and Playwright navigation **must** be performed after `bun install`, and acceptance status must remain pending until those pass. See `docs/ACCEPTANCE.md`.

## Feature-owned registration boundary (2026-11-07)

Each Cordis feature package now contributes a lazy view renderer and a validated tool together with its metadata. These contributions register and unregister in the same Cordis fiber lifetime. The application shell no longer has a feature-type switch. `FeatureCatalog` notifies React when a feature is enabled/disabled; existing Dockview tabs retain stable IDs and display recoverable placeholders for disabled features. `ViewActionService` is the typed action boundary for opening views, replacing the untyped DOM feature-open event. The shared first-party presenter implementations have moved from `apps/web` to `packages/client` and are imported by package-owned view entrypoints. Moving individual feature business logic into feature-specific modules and hardening cross-workbench transfer are subsequent acceptance work; this architecture change alone does not complete Phase 1.
