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
