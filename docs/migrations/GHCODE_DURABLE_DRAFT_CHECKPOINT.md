# GHCode W05 — transactional private draft recovery checkpoint

## Code-level reconciliation

The canonical GHCode source remains inert at `migrate/ghcode`; this is NOT a new competing application. The actual existing `DocumentService` is wired to a new `drafts` object store in the **same** `darkfactory-workbench` IndexedDB database, incremented from structural version **3 to 4**. The existing principal-bound `overlays` store and `compareAndSetOverlay` remain the authoritative working-tree writer.

Every document draft operation proves a persisted owned workspace inside the same IndexedDB transaction; the document identifier must exactly match the stored account, repository ID, session, ref, immutable source SHA and canonical path. A cross-account user, stale A→B→A authority, forged repository/ref, or corrupt draft is rejected. A checkpoint is acknowledged only when the full transaction completes, not on request success. Writes with an already-newer revision or identical revision but different content are rejected. Cleanup uses exact revision plus content, so delayed old editors cannot delete more recent checkpoints.

## Actual application binding

- Editing first attempts a durable draft checkpoint, then the existing overlay CAS writer.
- Failed/aborted/quota-denied checkpoints leave edits visibly dirty and block working-tree write acknowledgment.
- When a browser reloads or the same principal signs back in, the live repository editor retrieves the last *committed* checkpoint after workspace authorization.
- Recovered bytes are displayed with an explicit warning; they are **not silently uploaded or pushed**. The user selects **Retry save** to write through the original authoritative working-tree API.
- If a committed working-tree overlay already has the same bytes, recovery safely discards the redundant checkpoint.
- Previously uncommitted keystrokes remain unrecoverable after process termination. Such recovery cannot be promised.
- No separate database authority, model weights, remote credentials, external backend, or PR publication was introduced.

## Evidence status

The following tests are added and must pass at the new integration HEAD: Bun DocumentService tests for checkpoint-before-ack, cross-principal restart, safe acknowledged draft cleanup, quota failure and A→B→A stale read; real Chromium storage tests for IDB v4, browser reload, denied other principal, forged ref and stale journal discard.

**Incomplete:** non-destructive ambiguous legacy v2 migration, all-record transactional CAS, native Dockview tab/group/move guards, account-safe export/import and complete source-to-successor-application activation. The existence of this journal is not approval to merge or ship the full unified application.
