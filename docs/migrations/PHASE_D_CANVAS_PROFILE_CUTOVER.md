# Phase D / CAN-02 — Live Canvas profile and scratch catalog cutover

**Repository:** `marius-patrik/Wrkbench` · `integration/tri-source-migration-baseline` · draft PR #39  
**Scope:** `migrate/canvas/.github/app` (inert migrated source application). No root, Pages, native release, or standalone source repository modifications.

## Prior behavior and defect

The existing Canvas C01 IndexedDB persistence foundation was implemented and tested, but the running React profile directory still used Zustand `persist` with `localStorage["canvas-profiles-v1"]` as the authoritative writer. Profiles, selected profile, navigation, pinned tools, notes, selected Monaco path and scratch content therefore bypassed C01 transaction acknowledgments and revision CAS. Using the old writer alongside new canonical stores would have introduced competing authorities.

## Implemented source behavior

The active `profiles.ts` Zustand store is now an **in-memory editing projection only**. It does not import or call the `persist` middleware, `createJSONStorage`, `localStorage.setItem` or `localStorage.removeItem`. Instead:

1. `persistence/live-profiles.ts` operates over the accepted C01 `CanvasPersistence` adapter and its `workspaces` object store. A namespaced SHA-256-derived deterministic UUID, **separate from existing user-facing profile IDs**, identifies one catalog record with `kind: canvas-profile-directory-v1`.
2. `ProfilePersistenceGate.tsx` blocks the React application on startup until the directory is hydrated from a validated canonical record or a verified legacy import. No default `Global` profile can overwrite unverified existing data during an asynchronous initial render.
3. On the first import of a legacy Zustand v1 state, C01 `beginLegacyMigration("canvas-profiles-v1")` captures **the exact raw string** as an immutable backup and a migration lease. The parsed profile directory and `imported` marker commit in the **same C01 transaction**. Original localStorage bytes remain unchanged, including notes and scratch drafts. Unknown versions, malformed JSON, duplicate identities or invalid records halt import and show an actionable recovery error rather than silently discarding data.
4. Normal profile operations — create, rename, delete, select, pin, navigate, notes and Monaco scratch `setDraft` — update the in-memory Zustand projection synchronously, then enqueue **serialized C01 revision-checked writes**. Each write is acknowledged only on IndexedDB transaction completion; no alternate localStorage fallback exists.
5. On storage abort, quota denial or cross-window revision conflict, the current in-memory snapshot remains available, an explicit `Retry durable save` control appears, and `beforeunload` warns about unacknowledged data. The UI does **not** call a failed mutation durable, and a stale second tab is prohibited from overwriting the first tab's newer catalog revision.

## Active executable acceptance

The migrated-source PR-only `.github/workflows/migration-source-verification.yml` runs `.github/tests/live-profiles-browser.mjs`, a real Playwright/Chromium test against the **compiled live Canvas UI**, covering:

- Create and select a new profile, verify the canonical IndexedDB record and deterministic UUID, confirm no old `canvas-profiles-v1` writer and restore actual selection after page reload.
- Import realistic legacy v1 profiles with original notes and Monaco scratch bytes, confirm the exact raw legacy string remains untouched, its immutable backup is recorded and the `imported` marker commits atomically; reopen without rerunning backup.
- Supply malformed legacy JSON and require an explicit blocking recovery UI, with no fabricated default catalog or lost source bytes.
- Inject `QuotaExceededError` into the real IndexedDB `workspaces` writer. Confirm that the active UI warns, durable revision does not advance and no localStorage fallback occurs. Remove the failure and require a real successful retry.
- Open two same-origin browser windows on one canonical catalog, publish from window A, then attempt stale mutation from B. The second window must receive a visible CAS conflict and **must not overwrite A's acknowledged directory**.

These are not unit-only mocks and do not waive the independent original C01 browser suite or CAN-03 Dockview acceptance. **Acceptance requires an exact-head green source workflow and manifest-pinned tree SHA.**

## Explicit remaining integration boundaries

**CAN-04 document lifecycle is not yet accepted.** The catalog currently stores notes and local scratch drafts as validated fields in one transactional C01 workspace record, matching the legacy application semantics. It does **not** yet give each Monaco draft an independently revisioned `EditableDocument` record, an authoritative resource/Monaco model registry, per-document CAS or recovered-draft cross-service disposal contract. Those are required before merging GHCode's separately principal-scoped document service into a unified successor app.

**Preferences and hotkeys still have separate legacy localStorage writers** (`config.ts`, `main.tsx`). They do not write profile/catalog or Dockview layout keys, but must receive their own single-writer migration before claiming total Canvas persistence cutover.

A browser closing during an unacknowledged async write cannot magically recover bytes that never committed; the unload guard mitigates accidental loss but browser termination is not recoverable without a previously committed checkpoint. Cross-window conflicts currently preserve the local in-memory snapshot and require explicit user reconciliation; do not claim an automatic merge or export workflow.

This cutover does **not** compose GHCode, RSCode and Canvas into one running shell. Source DAG preservation, source acceptance and unified root runtime activation remain distinct gates. No original GHCode repository should be recreated.
