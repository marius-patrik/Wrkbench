# Phase C1 — GHCode local commit immutability and recoverable push intent

**Location:** `migrate/ghcode` inside the retained three-source migration, draft PR #39. Original standalone GHCode repository remains deleted and must not be recreated.

## Functional defect

The prior preservation pass kept Git history and created a durable `pushOperations` journal, but several operational contracts remained weaker than real Git ancestry:

1. `saveLocalCommit` used IndexedDB `put()`, allowing a local commit ID's message/files to be silently overwritten **after** a `prepared` push journal recorded that ID.
2. `beginPushOperation` verified only *set membership*, not ordered local commit ancestry. The React push entrypoint also compared only membership; identical IDs in a different order could publish a different Git commit chain.
3. `removeLocalCommit` allowed deletion of a commit referenced by an unresolved journal; `clearLocalGitState` could remove **all** staged/committed/local data without inspecting pending pushes. A failed network response after a successful remote update would leave no safe local recovery.

## Committed source corrections

- `src/workspace/storage.ts`: local commit write uses `IDBObjectStore.add` to make its identity immutable; a duplicate ID now fails transactionally instead of rewriting history.
- `loadLocalCommits` and `samePushCommitOrder`: deterministic ordering by `createdAt` then ID; require the **exact ordered unique sequence**. The same contract is checked in `beginPushOperation` and `context.tsx > pushLocalCommits` before the first remote request.
- `removeLocalCommit`: one principal-authorized transaction reads the persisted workspace, targeted commit, and push journal, then refuses to delete an ID protected by an unfinished push. No read-then-delete race between tabs.
- `clearLocalGitState`: one transaction includes the `pushOperations` store and rejects destructive cleanup if **any** push for that workspace remains unresolved. Both reads and mutations are scoped to the persisted verified owner; authorization is rechecked at commit acknowledgment.
- `.github/unit/storage-unit.test.ts`: explicit order/tie/duplicate tests; mocked transaction must preserve data with an unresolved pending push.
- `.github/tests/push-journal.spec.ts`: **real Chromium IndexedDB** scenario writes two commits with reversed timestamps; verifies immutable storage, wrong-order rejection, valid ordered journal, no deletion/cleanup during pending push and foreign-account denial.

**Invariants:** no force push, no duplicate ref mutation, no account-B adoption of account-A commits, no silent discard of uncertain publication, and no automatic adoption of v2 unattributed legacy bytes.

## Phase C1 additional privacy correction: source-scoped Dockview

The active historical GHC-00 repository-switch regression exposed a **separate, actual UI confidentiality defect**: switching from an authenticated private repository to another repository under the same principal left the old private README Monaco content visible in the shared Dockview tree. Commit history, byte-preserving source import and account-scoped IndexedDB alone could not prevent it.

The implementation now enforces two independent boundaries:

- `app.tsx` remounts `WorkbenchShell` whenever the verified principal epoch **or the immutable workspace ID** changes. The old repository's editor groups and tab titles no longer share a live Dockview surface with the new repository.
- `workbench/persistence.ts` stores layouts under `ghcode-layout-workspace-v2:<principal>:<workspaceId>`. Legacy principal-wide `ghcode-layout-owned-v1` and unattributed layout values remain byte-preserved, but cannot be auto-loaded in a different repository session.
- `workbench/shell.tsx` binds every newly opened resource tab to `resourceWorkspaceId`. A file path is not a global resource identity: opening README.md in B never reuses A's tab.
- `tabs/editor-tab.tsx` verifies `resourceWorkspaceId === activeWorkspace.id` **before reading, rendering or mounting a private Monaco model**. Unauthorized/stale tabs show a neutral state; in-flight resource reads are fenced by the full `documentId`, not a path-only loaded flag.

The active `workbench.spec.ts` test now exercises private draft → failed switch while dirty → Retry save → successful public workspace → public same-path README → no private sentinel → reload → reopen original private workspace and recover its exact sentinel. The historical private content and layouts remain recoverable only in the original authorized workspace.

**No claim of acceptance until the exact-head browser and source CI pass**. These are source-only corrections, not a root runtime or public Pages deployment.

## Phase C1 source rehydration race fixed

The active repository-switch/reload test uncovered another **data-recovery defect**: the old verified private workspace's overlay existed in IndexedDB, but reopening it could mount Monaco against the base Git README before the asynchronous `loadLocalState()` finished. EditorTab's resource-aware effect would not retry when `overlays` eventually arrived, making the acknowledged private edit appear lost even though its durable bytes remained.

`context.tsx > openRepository` now reads the old workspace's overlays, staging, committed files and local commits before publishing the next workspace to React, then sets all slices with the workspace identity in one synchronous React turn. It does not overwrite them with a second async read. `createBranch` similarly reads the atomically forked data and refs before activating the new branch; no intermediate render pairs source A with destination B's files.

The new active GHC-00 Chromium regression verifies **failed save blocks switch → retry is acknowledged → public repository opens without private text → reload → reopen original private repository → original edit is restored in Monaco**. No test bypasses the authenticated repository flow or changes the owner ID.

## Exact-source acceptance — 2026-11-08

[Migration source verification run 42460733067](https://github.com/marius-patrik/Wrkbench/actions/runs/42460733067) completed **SUCCESS (8/8 jobs)** at integration head `962e23e93d69dc4091392891d15412342778d1d8`. GHCode source tree `64bcbd414284d8a5f919cd405e74d6541fd40453` passed TypeScript, Biome and build checks; **27 Bun unit regressions** including ordered commit/IDB cleanup and identity/CAS contracts; and **49 real Chromium Playwright acceptance tests** including the promoted GHC-00 dirty Dockview move, private→public repository switch, same-path confidentiality check, reload/reopen and restored private editor content. All 49 passed.

**Validated defect fix:** `openRepository` and `createBranch` now await the authorized persisted overlay/stage/commit snapshot **before** publishing the new workspace to React. A previously passing underlying IndexedDB write could appear lost to Monaco when an editor mounted against the base Git tree first; that source-level false recovery is now covered by the live GHC-00 reopened-private-README acceptance. No cross-principal legacy v2 data is automatically attributed or downloaded.

**Scope:** GHCode is still a migrated source application inside `migrate/ghcode`, **not** the unified root runtime. This result accepts the tested source contracts, not the separate Pages deployment, native shell composition or untested live GitHub OAuth permission scenarios.

## What this does not accept

This is a behavioral improvement in the **inert GHCode source tree**, not a production root implementation or a substitute for the remaining work:

- v2 unattributed private localStorage/IndexedDB content must remain quarantined. A repository name or signed-in current user does not prove original data ownership, so automatic v2 adoption into another principal would be unsafe. Existing opt-in quarantine and the original raw records remain preserved.
- Complete Monaco/Dockview removal, account switching, browser unload, multi-tab race matrix and durable draft recovery still require independent full browser acceptance.
- Remote GitHub `beforeOid` GraphQL CAS and uncertain push retry need provider-backed conflict/permission/network acceptance before publication.
- The unified successor shell must consume these contracts through **one** authoritative storage/service adapter; copying separate indexedDB stores into production without a cutover plan creates competing writers.

## Verification gate

Required exact-head checks:

```sh
cd migrate/ghcode
bun install --frozen-lockfile
bun run check
bun test ./.github/unit/storage-unit.test.ts ./.github/unit/document-service.test.ts ./.github/unit/resource-identity.test.ts ./.github/unit/github-cas.test.ts
bun run acceptance
```

The PR-only read-only `.github/workflows/migration-source-verification.yml` runs these steps in hosted Chromium. **The current source change is not accepted until that job passes and `migrate/manifest.json` pins its exact source tree hash.** Keep PR #39 draft; do not recreate GHCode, alter `main`, publish production releases or change the independent Pages React 19 branch.
