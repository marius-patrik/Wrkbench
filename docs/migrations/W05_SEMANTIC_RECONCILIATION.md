# W05 — Semantic implementation reconciliation (not ancestry-only)

## Canonical source

This implementation builds upon the source-preservation merge in `marius-patrik/Wrkbench`. It does **not** replace the existing root runtime. All modifications are inside `migrate/ghcode` and `migrate/canvas` plus migration evidence files.

## GHCode actually implemented

1. **IndexedDB structural version 5** now has the original transactional workspaces, blobs, overlays, staging, commits and push journal, plus the new crash-durable `drafts`, immutable raw `legacyBackups` and `migrationState` object stores. This is an actual browser structural upgrade, not a TypeScript type rename.
2. **Private document crash recovery**: `DocumentService` persists a checkpoint before the original working-tree CAS write; a different principal cannot read it. A reopened editor displays only the last committed checkpoint for explicit Retry save, with A→B→A revocation fencing; it never auto-pushes a recovered private draft. Stale same-content checkpoints are discarded only by exact revision + content.
3. **Atomic working tree rename**: `compareAndApplyOverlays` validates persisted ownership and exact expected source and destination file snapshots in ONE IndexedDB transaction. A conflicting or interrupted rename cannot leave only one half of the rename. The actual React `renamePath` and ordinary `commitOverlay` are wired through CAS, replacing the previous blind sequential `saveOverlay` / `removeOverlay` paths.
4. **Explicit lossless legacy quarantine**: the repository dialog offers a user-triggered action. `quarantineUnattributedLegacyRecords` retains every unattributed v2 original in its original object store and makes an independent local raw backup inside one transaction; on a changed source record, a retry fails rather than overwriting the prior backup. It never silently assigns old private bytes to the current account or exposes ambiguous bytes through the account UI. This deliberately does not claim verified ownership attribution or replay of every legacy feature.
5. **Principal-locked local backup export/import**: `exportOwnedWorkspaceSnapshot` reads the verified current workspace, overlays, staged, committed and local commits in one read-only transaction rather than cached React arrays. `importOwnedWorkspaceSnapshot` validates immutable identity and record keys and imports all collections in one write transaction only into an **already existing empty authorized** workspace, never overwriting local work. The repository dialog exposes explicit JSON export/import. Neither operation supports importing unverified legacy data.
6. **Dockview native middle-click**: native tab mouse events are intercepted before Dockview's non-cancellable removal handlers and redirected to the existing `documentService.assertSafeToNavigate()` guarded close path; a real-browser dirty-close regression was added. Other native group and popout routes remain to be accepted independently.
7. **Canvas sidebar resize correctness**: persists the final pointer-up position even when Chromium coalesces intermediate pointer moves, with existing keyboard and screen-reader behavior preserved.

## Evidence

Existing independent CI suite runs TypeScript, Biome, builds, Bun unit tests, real Chromium Playwright, the full source history/isolation verifier, and 4-platform installed native acceptance. Migration manifest pins exact subtree SHAs. The candidate's final SHA must be checked against fresh CI before acceptance is claimed.

The latest previously accepted RSCode source remains unchanged with four-platform Windows/Linux/macOS **PASS** native installed acceptance and previously verified security PR #25 native distribution PR #28.

## Unresolved contractual gates

- Historical v2 provenance cannot by itself prove which modern GitHub account owns unattributed edits. These are quarantined and untouched, not automatically re-attributed, and offline/operator recovery still needs verified ownership evidence.
- Full model of all legacy v2 write paths, browser quota pressure, native Dockview group close / popout, independent two-browser profile conflicts, branch-protected remote permissions, and root Chromium stress require independent acceptance.
- The three migrated source applications are preserved and tested independently; they are **not** yet one new React shell with a single runtime/persistence authority.
- The separate `agent/wrkbench-client-architecture` and `agent/wrkbench-native-client-architecture` new-application branches are not declared functionally integrated merely because they exist. The user's `pmarius/wrkbench-pages-react19` branch remains untouched.
- Production `main` remains unchanged. PR #39 must remain draft if any P0 integrity gate is unaccepted.
