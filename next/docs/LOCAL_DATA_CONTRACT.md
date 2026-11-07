# Browser-local data ownership

- IndexedDB `files` records are authoritative and serialized by readwrite transactions.
- All file writes, renames, and deletes use optional revision preconditions. Explorer supplies the revision it displayed, rejecting stale destructive operations.
- A `BroadcastChannel` invalidates other open tabs only **after commit**; it never replicates document content or bypasses IndexedDB.
- Clean cached documents refresh from IndexedDB after remote saves. Dirty buffers are retained and the user is warned of concurrent updates, renames, or deletions.
- The Monaco editor saves with revision compare-and-set and a stale save raises `FileConflictError`.
- OPFS is best-effort cache and must never be used as an authority in conflicts or recovery.
- Pending architectural gap: full crash-consistent cross-tab layout journal and an application-level document conflict resolution UI.

Validation: run `bun run test:core`, `bun run typecheck`, and `bun run test:e2e` against real dependencies.
