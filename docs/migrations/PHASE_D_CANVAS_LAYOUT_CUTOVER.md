# Phase D / CAN-03 — Real Dockview layout IndexedDB cutover

**Status:** source implementation committed, exact-head Chromium acceptance pending. Scope is exclusively `migrate/canvas/.github/app` on draft PR #39; no root or independent Pages publishing.

## Previous correctness defect

The C01 transactional adapter existed and passed isolated IndexedDB tests, but the running Canvas app continued to save Dockview geometry into `localStorage.setItem("canvas-dockview-layout-v2-" + profileId)`. This left C01 entirely inert for live layouts; no durable CAS, no all-or-nothing migration, and no real storage-failure signal.

## Active implementation

- **One writer:** `DockCanvas.tsx` no longer calls `localStorage.setItem` or `localStorage.removeItem` for layout. It loads/saves through `persistence/live-layouts.ts`, which in turn uses the existing `CanvasPersistence` C01 adapter. Old v2/v1 localStorage layout keys are retained strictly as recovery inputs.
- **Immutable identity:** A namespaced SHA-256-derived UUID (v5 variant bits) addresses the canonical `workspaces` record. Existing `global`, `study` and other non-UUID profile IDs are never cast into UUIDs.
- **Fail-closed bootstrap:** Before Dockview becomes writable, the adapter must initialize and either read a validated existing canonical workspace or establish a backup/import. A corrupt legacy JSON or failed transaction results in a visible blocking storage warning and **no automatic empty replacement**.
- **Lossless legacy:** `beginLegacyMigration` saves the original raw localStorage bytes as an immutable `backups` record plus `started` lease; valid layout conversion and `imported` marker commit atomically with `createWorkspace`. No accepted layout is reported before IndexedDB transaction completion.
- **CAS:** `updateWorkspace` uses the persisted revision and serializes writes from one window. Concurrent other-window updates fail visibly on revision conflict, not overwritten by unconditional puts. A failed write never silently retries into the legacy localStorage writer.
- **UI:** Real layout restoration awaits C01 before route-driven tab initialization. The Reset Layout success notification fires only after the durable transaction is acknowledged. Storage failures present a visible warning with a functional reload action; profile deletion cannot delete old backup bytes.

## Required real Chromium acceptance

`.github/tests/live-layouts-browser.mjs` exercises the actual compiled client, not a standalone fake adapter:

1. Create a Dockview Editor through UI; assert the real layout is in the C01 IndexedDB workspace with a deterministic UUID and **no new v2 localStorage writer**.
2. Reload; assert the real Editor panel restores from the same durable record and its revision survives.
3. Open an isolated fresh browser profile seeded with authentic prior UI layout JSON; assert restored editor, raw source unchanged, one immutable exact-byte backup, and `imported` lease committed. Reload and prove the migration is not re-run.
4. Seed malformed legacy bytes; assert no new canonical record, the exact raw bytes/backup survive, and an actual visible recovery warning appears.
5. Inject `QuotaExceededError` into the real IndexedDB workspace writer; assert UI warning, no revision advancement, and **no localStorage fallback**.

The test is a mandatory step in PR-only `.github/workflows/migration-source-verification.yml`. Failures must remain red until fixed; no bypass by dropping tests or asserting request success instead of transaction acknowledgment.

## Explicitly *not* done

The app still has separate legacy localStorage writers for **profile directory, notes and editor drafts** in `profiles.ts`, **appearance/preferences** in `config.ts`, and **hotkeys** in `main.tsx`. They are separate domains and not yet migrated. This change does not convert their IDs or promise a coherent cross-domain atomic snapshot. It also does **not** make Canvas, GHCode and RSCode into a unified runtime: the GHCode principal-scoped document authority and RSCode native service need a deliberate single shell/storage adapter and production cutover.

The old source histories, GPL obligations, active branch restrictions and all non-publishing acceptance gates remain in force.
