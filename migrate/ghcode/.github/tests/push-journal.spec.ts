import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Test the actual storage module in Chromium, not a mocked IDB transaction.
// Bundle the production TS module as a standalone ES module and serve it only
// through Playwright's route intercept; no test entry is shipped in the app.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = mkdtempSync(join(tmpdir(), "ghcode-idb-"));
let moduleSource = "";
try {
  const output = join(directory, "storage.mjs");
  execFileSync(
    "bun",
    ["build", "./src/workspace/storage.ts", "--target", "browser", "--format", "esm", "--outfile", output],
    { cwd: root, encoding: "utf8" },
  );
  moduleSource = readFileSync(output, "utf8");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const sourceUrl = "/__ghcode_real_idb_test__.js";

test.beforeEach(async ({ page }) => {
  await page.route(`**${sourceUrl}`, (route) => route.fulfill({
    status: 200, contentType: "application/javascript", body: moduleSource,
  }));
  await page.goto("/");
});

test("real IndexedDB v5 denies cross-principal reads, blobs and push preparation", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const a = "gh:github.com:1001";
    const b = "gh:github.com:2002";
    const sessionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(a)}:${sessionId}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: a, workspace: { id: workspaceId, principalKey: a },
        session: { id: sessionId, workspaceId, principalKey: a,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    storage.bindStoragePrincipal(a);
    await storage.saveWorkspace(workspace);
    await storage.saveBlob(id, "3".repeat(40), "A-only secret");
    const owned = await storage.loadWorkspace(id, a);
    storage.bindStoragePrincipal(b);
    const denied: Record<string, boolean> = {};
    for (const [key, action] of [
      ["workspace", () => storage.loadWorkspace(id, a)],
      ["blob", () => storage.loadBlob(id, "3".repeat(40))],
      ["push", () => storage.beginPushOperation(workspace, [`${id}:local:1:one`])],
    ] as const) {
      try { await action(); denied[key] = false; }
      catch { denied[key] = true; }
    }
    storage.bindStoragePrincipal(`anon:${crypto.randomUUID()}`);
    try { await storage.loadWorkspace(id, a); denied.anonymous = false; }
    catch { denied.anonymous = true; }
    try { storage.bindStoragePrincipal("invalid-principal"); denied.invalidPrincipal = false; }
    catch { denied.invalidPrincipal = true; }
    return { owned: owned?.id === id, denied };
  }, sourceUrl);
  expect(result.owned).toBe(true);
  expect(result.denied).toEqual({
    workspace: true, blob: true, push: true, anonymous: true, invalidPrincipal: true,
  });
});

test("discarding renamed or staged work is one principal-authorized CAS transaction", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const sessionId = crypto.randomUUID();
    const localWorkspaceId = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal, workspace: { id: localWorkspaceId, principalKey: principal },
        session: { id: sessionId, workspaceId: localWorkspaceId, principalKey: principal,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    storage.bindStoragePrincipal(principal);
    await storage.saveWorkspace(workspace);
    const overlay = {
      key: id + ":README.md", workspaceId: id, path: "README.md",
      status: "modified", content: "ORIGINAL_PRIVATE_EDIT", updatedAt: 10,
    };
    const staged = { ...overlay, stagedAt: 11 };
    await storage.saveOverlay(overlay);
    await storage.saveStaged(staged);

    // Simulate IndexedDB throwing after the overlay deletion was enqueued.
    // Every record must remain intact when this single transaction aborts.
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === "staged")
        throw new DOMException("Injected staged-store failure", "AbortError");
      return originalDelete.apply(this, args as Parameters<IDBObjectStore["delete"]>);
    };
    let aborted = false;
    try {
      await storage.compareAndDiscardLocalPaths(id, [overlay], [staged], ["README.md"]);
    } catch { aborted = true; }
    finally { IDBObjectStore.prototype.delete = originalDelete; }
    const retainedOverlay = (await storage.loadOverlays(id))[0]?.content;
    const retainedStaged = (await storage.loadStaged(id))[0]?.content;

    // A stale tab cannot discard another tab's newer working file.
    const newer = { ...overlay, content: "NEWER_PRIVATE_EDIT", updatedAt: 12 };
    await storage.saveOverlay(newer);
    let conflict = false;
    try {
      await storage.compareAndDiscardLocalPaths(id, [overlay], [staged], ["README.md"]);
    } catch { conflict = true; }
    const afterConflict = (await storage.loadOverlays(id))[0]?.content;

    // No other account can initiate a discard of the same resource.
    storage.bindStoragePrincipal("gh:github.com:2002");
    let unauthorized = false;
    try {
      await storage.compareAndDiscardLocalPaths(id, [newer], [staged], ["README.md"]);
    } catch { unauthorized = true; }
    storage.bindStoragePrincipal(principal);

    await storage.compareAndDiscardLocalPaths(id, [newer], [staged], ["README.md"]);
    return {
      aborted, retainedOverlay, retainedStaged, conflict,
      afterConflict, unauthorized,
      emptyOverlay: (await storage.loadOverlays(id)).length === 0,
      emptyStaged: (await storage.loadStaged(id)).length === 0,
    };
  }, sourceUrl);
  expect(result).toEqual({
    aborted: true,
    retainedOverlay: "ORIGINAL_PRIVATE_EDIT",
    retainedStaged: "ORIGINAL_PRIVATE_EDIT",
    conflict: true,
    afterConflict: "NEWER_PRIVATE_EDIT",
    unauthorized: true,
    emptyOverlay: true,
    emptyStaged: true,
  });
});

test("branch fork copies owned local state atomically and rejects partial or foreign revisions", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const a = "gh:github.com:1001";
    const b = "gh:github.com:2002";
    const sourceSession = crypto.randomUUID();
    const branchSession = crypto.randomUUID();
    const sourceId = `ghcode-owned-v2:${encodeURIComponent(a)}:${sourceSession}`;
    const targetId = `ghcode-owned-v2:${encodeURIComponent(a)}:${branchSession}`;
    const source = {
      version: 2, id: sourceId, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: a, workspace: { id: crypto.randomUUID(), principalKey: a },
        session: { id: sourceSession, workspaceId: "PLACEHOLDER",
          principalKey: a, repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    source.ownership.session.workspaceId = source.ownership.workspace.id;
    const target = {
      ...source, id: targetId, ref: "feature", updatedAt: 2,
      ownership: {
        principalKey: a, workspace: { id: crypto.randomUUID(), principalKey: a },
        session: { id: branchSession, workspaceId: "PLACEHOLDER",
          principalKey: a, repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/feature" },
      },
    };
    target.ownership.session.workspaceId = target.ownership.workspace.id;
    const overlay = {
      key: sourceId + ":README.md", workspaceId: sourceId, path: "README.md",
      status: "modified", content: "BRANCH_PRIVATE_BYTES", updatedAt: 1,
    };
    const staged = { ...overlay, stagedAt: 2 };
    const committed = {
      key: sourceId + ":archived.txt", workspaceId: sourceId, path: "archived.txt",
      content: "COMMITTED_A", deleted: false, updatedAt: 1,
    };
    const localCommit = {
      id: sourceId + ":local:1:one", workspaceId: sourceId,
      message: "original", createdAt: 1, files: [overlay],
    };
    storage.bindStoragePrincipal(a);
    await storage.saveWorkspace(source);
    await storage.saveBlob(sourceId, "3".repeat(40), "BLOB_A");
    await storage.saveOverlay(overlay);
    await storage.saveStaged(staged);
    await storage.saveCommittedFile(committed);
    await storage.saveLocalCommit(localCommit);

    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "staged")
        throw new DOMException("Injected staged clone abort", "AbortError");
      return originalAdd.apply(this, args as Parameters<IDBObjectStore["add"]>);
    };
    let aborted = false;
    try { await storage.forkOwnedWorkspaceState(source, target); }
    catch { aborted = true; }
    finally { IDBObjectStore.prototype.add = originalAdd; }

    const afterAbort = await storage.loadWorkspace(targetId, a);
    const sourceIntact = (await storage.loadOverlays(sourceId))[0]?.content;
    await storage.forkOwnedWorkspaceState(source, target);

    const branchWorkspace = await storage.loadWorkspace(targetId, a);
    const copiedOverlay = (await storage.loadOverlays(targetId))[0];
    const copiedStaged = (await storage.loadStaged(targetId))[0];
    const copiedCommitted = (await storage.loadCommittedFiles(targetId))[0];
    const copiedCommit = (await storage.loadLocalCommits(targetId))[0];
    const copiedBlob = await storage.loadBlob(targetId, "3".repeat(40));
    let duplicateRejected = false;
    try { await storage.forkOwnedWorkspaceState(source, target); }
    catch { duplicateRejected = true; }

    storage.bindStoragePrincipal(b);
    let foreignRejected = false;
    try { await storage.forkOwnedWorkspaceState(source, target); }
    catch { foreignRejected = true; }
    storage.bindStoragePrincipal(a);

    return {
      aborted, targetAbsentOnFailure: !afterAbort,
      sourceIntact, branchReady: branchWorkspace?.id === targetId,
      copiedOverlay: copiedOverlay?.content,
      copiedStaged: copiedStaged?.content,
      copiedCommitted: copiedCommitted?.content,
      copiedCommit: copiedCommit?.files[0]?.workspaceId === targetId &&
        copiedCommit?.id.startsWith(targetId + ":local:"),
      copiedBlob, duplicateRejected, foreignRejected,
    };
  }, sourceUrl);
  expect(result).toEqual({
    aborted: true, targetAbsentOnFailure: true,
    sourceIntact: "BRANCH_PRIVATE_BYTES", branchReady: true,
    copiedOverlay: "BRANCH_PRIVATE_BYTES",
    copiedStaged: "BRANCH_PRIVATE_BYTES",
    copiedCommitted: "COMMITTED_A",
    copiedCommit: true, copiedBlob: "BLOB_A",
    duplicateRejected: true, foreignRejected: true,
  });
});

test("prepared push survives browser reload and confirmed push finalizes atomically", async ({ page }) => {
  const seeded = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const sessionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal, workspace: { id: workspaceId, principalKey: principal },
        session: { id: sessionId, workspaceId, principalKey: principal,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    storage.bindStoragePrincipal(principal);
    await storage.saveWorkspace(workspace);
    const commitId = `${id}:local:1:one`;
    await storage.saveLocalCommit({
      id: commitId, workspaceId: id, message: "draft", createdAt: 1, files: [],
    });
    const pending = await storage.beginPushOperation(workspace, [commitId]);
    return { workspace, pendingId: pending.id };
  }, sourceUrl);
  await page.reload();
  const recovered = await page.evaluate(async ({ url, workspace, pendingId }) => {
    const storage = await import(url);
    storage.bindStoragePrincipal("gh:github.com:1001");
    let pending = await storage.loadPendingPushOperation(workspace);
    if (!pending || pending.id !== pendingId || pending.phase !== "prepared")
      return { error: "Journal did not survive reload" };
    const deniedEarly = await storage.finalizeConfirmedPush(
      workspace, { ...workspace, baseSha: "3".repeat(40) }, pending,
    ).then(() => false, () => true);
    pending = await storage.advancePushOperation(
      workspace, pending.id, "prepared", "ready", "3".repeat(40),
    );
    const deniedConcurrent = await storage.advancePushOperation(
      workspace, pending.id, "prepared", "ready", "4".repeat(40),
    ).then(() => false, () => true);
    pending = await storage.advancePushOperation(
      workspace, pending.id, "ready", "remote-confirmed", "3".repeat(40),
    );
    const next = { ...workspace, baseSha: "3".repeat(40), treeSha: "4".repeat(40) };
    await storage.finalizeConfirmedPush(workspace, next, pending);
    const reloaded = await storage.loadWorkspace(workspace.id, "gh:github.com:1001");
    const commits = await storage.loadLocalCommits(workspace.id);
    const unfinished = await storage.loadPendingPushOperation(workspace);
    return { deniedEarly, deniedConcurrent, newHead: reloaded?.baseSha, count: commits.length,
      unfinished: unfinished !== null };
  }, { url: sourceUrl, ...seeded });
  expect(recovered).toEqual({
    deniedEarly: true, deniedConcurrent: true,
    newHead: "3".repeat(40), count: 0, unfinished: false,
  });
});

test("real concurrent staged commits cannot both consume the same staging snapshot", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const sessionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;
    storage.bindStoragePrincipal(principal);
    await storage.saveWorkspace({
      version: 2, id, updatedAt: 1, ref: "main", baseSha: "1".repeat(40),
      treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal,
        workspace: { id: workspaceId, principalKey: principal },
        session: { id: sessionId, principalKey: principal, workspaceId,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    });
    const staged = {
      key: `${id}:README.md`, workspaceId: id, path: "README.md",
      content: "updated", status: "modified", updatedAt: 1, stagedAt: 2,
    };
    await storage.saveStaged(staged);
    const make = (n: number) => ({
      id: `${id}:local:${n}:uuid`, workspaceId: id,
      createdAt: n, message: "commit", files: [{ ...staged }],
    });
    const results = await Promise.allSettled([
      storage.commitLocalChanges(make(1), [staged]),
      storage.commitLocalChanges(make(2), [staged]),
    ]);
    const commits = await storage.loadLocalCommits(id);
    const remaining = await storage.loadStaged(id);
    return { successful: results.filter((r) => r.status === "fulfilled").length,
      failures: results.filter((r) => r.status === "rejected").length,
      commits: commits.length, staged: remaining.length };
  }, sourceUrl);
  expect(result).toEqual({ successful: 1, failures: 1, commits: 1, staged: 0 });
});

test("real storage quota exception aborts and does not acknowledge a write", async ({ page }) => {
  const outcome = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const sessionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal, workspace: { id: workspaceId, principalKey: principal },
        session: { id: sessionId, workspaceId, principalKey: principal,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    storage.bindStoragePrincipal(principal);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Injected capacity exhaustion", "QuotaExceededError");
    };
    let rejected = false;
    try { await storage.saveWorkspace(workspace); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.put = original; }
    const snapshot = await storage.loadWorkspace(id, principal);
    return { rejected, persisted: snapshot !== undefined };
  }, sourceUrl);
  expect(outcome).toEqual({ rejected: true, persisted: false });
});


test("real overlay revision CAS prevents lost updates, stale deletes and cross-account writes", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const id = "ghcode-owned-v2:" + encodeURIComponent(principal) + ":" + crypto.randomUUID();
    const path = "src/document.ts";
    const initial = {
      key: id + ":" + path, workspaceId: id, path, status: "modified",
      content: "baseline", updatedAt: 1,
    };
    storage.bindStoragePrincipal(principal);
    const sessionId = id.split(":").at(-1);
    const workspaceUuid = crypto.randomUUID();
    await storage.saveWorkspace({
      version: 2, id, updatedAt: 1, ref: "main", baseSha: "1".repeat(40),
      treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal,
        workspace: { id: workspaceUuid, principalKey: principal },
        session: { id: sessionId, workspaceId: workspaceUuid,
          principalKey: principal, repositoryKey: "gh:github.com:repo:42",
          ref: "refs/heads/main" },
      },
    });
    const left = { ...initial, content: "left", updatedAt: 2 };
    const right = { ...initial, content: "right", updatedAt: 3 };
    const outcomes = await Promise.allSettled([
      storage.compareAndSetOverlay(id, path, null, left),
      storage.compareAndSetOverlay(id, path, null, right),
    ]);
    const after = (await storage.loadOverlays(id))[0];
    const stale = await storage.compareAndSetOverlay(id, path, initial, null)
      .then(() => false, () => true);
    const updated = { ...after, content: "resolved", updatedAt: 4 };
    await storage.compareAndSetOverlay(id, path, after, updated);
    storage.bindStoragePrincipal("gh:github.com:2002");
    const crossPrincipalDenied = await storage.compareAndSetOverlay(id, path, updated, null)
      .then(() => false, () => true);
    storage.bindStoragePrincipal(principal);
    const preserved = (await storage.loadOverlays(id))[0];
    return {
      completed: outcomes.filter(item => item.status === "fulfilled").length,
      conflicted: outcomes.filter(item => item.status === "rejected").length,
      original: after?.content,
      stale, crossPrincipalDenied,
      preserved: preserved?.content,
    };
  }, sourceUrl);
  expect(result.completed).toBe(1);
  expect(result.conflicted).toBe(1);
  expect(["left", "right"]).toContain(result.original);
  expect(result.stale).toBe(true);
  expect(result.crossPrincipalDenied).toBe(true);
  expect(result.preserved).toBe("resolved");
});


test("real storage rejects forged same-principal workspace IDs with no persisted repository proof", async ({ page }) => {
  const state = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    storage.bindStoragePrincipal(principal);
    const orphan = "ghcode-owned-v2:" + encodeURIComponent(principal) + ":" + crypto.randomUUID();
    const file = {
      key: orphan + ":private.txt", workspaceId: orphan, path: "private.txt",
      status: "added", content: "forged", updatedAt: 1,
    };
    const rejection: Record<string, boolean> = {};
    const cases = {
      read: () => storage.loadOverlays(orphan),
      blob: () => storage.saveBlob(orphan, "3".repeat(40), "private"),
      stage: () => storage.saveStaged({ ...file, stagedAt: 2 }),
      overlay: () => storage.saveOverlay(file),
      cas: () => storage.compareAndSetOverlay(orphan, file.path, null, file),
    };
    for (const [key, operation] of Object.entries(cases)) {
      try { await operation(); rejection[key] = false; }
      catch { rejection[key] = true; }
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("darkfactory-workbench", 5);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const persisted = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(["overlays", "staged", "blobs"], "readonly");
      let pending = 3;
      let any = false;
      for (const name of ["overlays", "staged", "blobs"]) {
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => {
          any = any || req.result.some((record) => record.workspaceId === orphan);
          if (--pending === 0) resolve(any);
        };
        req.onerror = () => reject(req.error);
      }
      tx.oncomplete = () => db.close();
    });
    return { rejection, persisted };
  }, sourceUrl);
  expect(state).toEqual({
    rejection: { read: true, blob: true, stage: true, overlay: true, cas: true },
    persisted: false,
  });
});


test("real IndexedDB rejects forged cross-workspace primary keys and immutable repository reassignment", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const otherPrincipal = "gh:github.com:2002";
    const make = (owner: string, repositoryId: number) => {
      const session = crypto.randomUUID();
      const workspaceUuid = crypto.randomUUID();
      const id = "ghcode-owned-v2:" + encodeURIComponent(owner) + ":" + session;
      return {
        version: 2, id, ref: "main", updatedAt: 1, baseSha: "1".repeat(40),
        treeSha: "2".repeat(40), tree: [],
        repository: {
          id: repositoryId, name: "identical-name", owner: "acme",
          fullName: "acme/identical-name", private: true,
          defaultBranch: "main", htmlUrl: "", canPush: true,
        },
        ownership: {
          principalKey: owner, workspace: { id: workspaceUuid, principalKey: owner },
          session: { id: session, principalKey: owner, workspaceId: workspaceUuid,
            repositoryKey: "gh:github.com:repo:" + repositoryId, ref: "refs/heads/main" },
        },
      };
    };
    const a = make(principal, 42);
    const b = make(otherPrincipal, 43);
    storage.bindStoragePrincipal(principal);
    await storage.saveWorkspace(a);
    storage.bindStoragePrincipal(otherPrincipal);
    await storage.saveWorkspace(b);
    storage.bindStoragePrincipal(principal);
    const forgedFile = {
      workspaceId: a.id, key: b.id + ":README.md", path: "README.md",
      status: "modified", content: "poisoned", updatedAt: 2,
    };
    const forgedOverlay = await storage.saveOverlay(forgedFile)
      .then(() => false, () => true);
    const forgedStage = await storage.saveStaged({ ...forgedFile, stagedAt: 2 })
      .then(() => false, () => true);
    const forgedCommit = await storage.saveLocalCommit({
      id: a.id + ":local:2:test", workspaceId: a.id, createdAt: 2,
      message: "malicious", files: [forgedFile],
    }).then(() => false, () => true);
    const forgedRepository = await storage.saveWorkspace({
      ...a, repository: { ...a.repository, id: 43 },
      ownership: { ...a.ownership, session: {
        ...a.ownership.session, repositoryKey: "gh:github.com:repo:43",
      } }, updatedAt: 3,
    }).then(() => false, () => true);
    const traversal = await storage.removeOverlay(a.id, "../README.md")
      .then(() => false, () => true);
    storage.bindStoragePrincipal(otherPrincipal);
    const overlays = await storage.loadOverlays(b.id);
    const stored = await storage.loadWorkspace(b.id, otherPrincipal);
    storage.bindStoragePrincipal(principal);
    const stillA = await storage.loadWorkspace(a.id, principal);
    return { forgedOverlay, forgedStage, forgedCommit, forgedRepository, traversal,
      unchangedB: overlays.length === 0 && stored?.repository.id === 43,
      unchangedA: stillA?.repository.id === 42 };
  }, sourceUrl);
  expect(result).toEqual({
    forgedOverlay: true, forgedStage: true, forgedCommit: true,
    forgedRepository: true, traversal: true, unchangedB: true, unchangedA: true,
  });
});


test("real staged snapshot CAS serializes competing writers and atomically stages rename pairs", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const owner = "gh:github.com:1001";
    const session = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const id = "ghcode-owned-v2:" + encodeURIComponent(owner) + ":" + session;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1, baseSha: "1".repeat(40),
      treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: owner, workspace: { id: workspaceId, principalKey: owner },
        session: { id: session, principalKey: owner, workspaceId,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    storage.bindStoragePrincipal(owner);
    await storage.saveWorkspace(workspace);
    const file = (path: string, content: string, stagedAt: number) => ({
      key: id + ":" + path, workspaceId: id, path,
      status: "modified", content, baseSha: "1".repeat(40),
      updatedAt: stagedAt, stagedAt,
    });
    const left = file("README.md", "from A", 11);
    const right = file("README.md", "from B", 12);
    const races = await Promise.allSettled([
      storage.compareAndApplyStaged(id, [], [{ path: left.path, next: left }]),
      storage.compareAndApplyStaged(id, [], [{ path: right.path, next: right }]),
    ]);
    const stored = await storage.loadStaged(id);
    const staleRemovalDenied = await storage.compareAndApplyStaged(
      id, [], [{ path: "README.md", next: null }],
    ).then(() => false, () => true);
    const rename = file("renamed.md", "new name", 20);
    const sourceDelete = { ...file("old.md", "", 20), status: "deleted" };
    await storage.compareAndApplyStaged(id, stored, [
      { path: rename.path, next: rename },
      { path: sourceDelete.path, next: sourceDelete },
    ]);
    const after = await storage.loadStaged(id);
    const invalidBatchDenied = await storage.compareAndApplyStaged(id, after, [
      { path: "../escape", next: file("../escape", "bad", 25) },
      { path: "unused.md", next: file("unused.md", "new", 25) },
    ]).then(() => false, () => true);
    storage.bindStoragePrincipal("gh:github.com:2002");
    const otherPrincipalDenied = await storage.compareAndApplyStaged(
      id, after, [{ path: "old.md", next: null }],
    ).then(() => false, () => true);
    storage.bindStoragePrincipal(owner);
    return {
      accepted: races.filter(x => x.status === "fulfilled").length,
      rejected: races.filter(x => x.status === "rejected").length,
      staleRemovalDenied, invalidBatchDenied, otherPrincipalDenied,
      finalPaths: (await storage.loadStaged(id)).map(x => x.path).sort(),
    };
  }, sourceUrl);
  expect(result).toEqual({
    accepted: 1, rejected: 1,
    staleRemovalDenied: true, invalidBatchDenied: true, otherPrincipalDenied: true,
    finalPaths: ["README.md", "old.md", "renamed.md"],
  });
});


test("real IndexedDB durable private draft survives reload, rejects account and ref forgery, and CAS-clears", async ({ page }) => {
  const original = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const sessionId = crypto.randomUUID();
    const workspaceUuid = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal, workspace: { id: workspaceUuid, principalKey: principal },
        session: { id: sessionId, workspaceId: workspaceUuid, principalKey: principal,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    const parts = [principal, id, sessionId, "gh:github.com:repo:42",
      "refs/heads/main", workspace.baseSha, "README.md"];
    const documentId = `ghcode-document-v1:${parts.map(encodeURIComponent).join(":")}`;
    storage.bindStoragePrincipal(principal);
    await storage.saveWorkspace(workspace);
    const saved = await storage.checkpointDocumentDraft(documentId, "secret crash draft", 1);
    const dbVersion = await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("darkfactory-workbench");
      req.onsuccess = () => { resolve(req.result.version); req.result.close(); };
      req.onerror = () => reject(req.error);
    });
    return { documentId, principal, dbVersion, record: saved };
  }, sourceUrl);
  expect(original.dbVersion).toBe(5);
  expect(original.record.content).toBe("secret crash draft");

  // Destroy all JS module state while retaining the real browser database.
  await page.reload();
  const result = await page.evaluate(async ({ url, documentId, principal }) => {
    const storage = await import(url);
    storage.bindStoragePrincipal("gh:github.com:2002");
    const crossPrincipalDenied = await storage.loadDocumentDraft(documentId)
      .then(() => false, () => true);
    storage.bindStoragePrincipal(principal);
    const restored = await storage.loadDocumentDraft(documentId);
    const forgedRef = documentId.replace(encodeURIComponent("refs/heads/main"), encodeURIComponent("refs/heads/other"));
    const forgedRefDenied = await storage.checkpointDocumentDraft(forgedRef, "forgery", 2)
      .then(() => false, () => true);
    await storage.checkpointDocumentDraft(documentId, "newer secret draft", 2);
    const staleClear = await storage.discardDocumentDraft(documentId, "secret crash draft", 1);
    const stillStored = await storage.loadDocumentDraft(documentId);
    const clearNewest = await storage.discardDocumentDraft(documentId, "newer secret draft", 2);
    const afterClear = await storage.loadDocumentDraft(documentId);
    return { crossPrincipalDenied, restoredContent: restored?.content, restoredRevision: restored?.revision,
      forgedRefDenied, staleClear, stillStoredContent: stillStored?.content, clearNewest, empty: afterClear === null };
  }, { url: sourceUrl, documentId: original.documentId, principal: original.principal });
  expect(result).toEqual({
    crossPrincipalDenied: true, restoredContent: "secret crash draft", restoredRevision: 1,
    forgedRefDenied: true, staleClear: false, stillStoredContent: "newer secret draft",
    clearNewest: true, empty: true,
  });
});


test("real IndexedDB rename CAS updates source and destination atomically and rejects concurrent edits", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const principal = "gh:github.com:1001";
    const sessionId = crypto.randomUUID();
    const workspaceUuid = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(principal)}:${sessionId}`;
    storage.bindStoragePrincipal(principal);
    await storage.saveWorkspace({
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: principal, workspace: { id: workspaceUuid, principalKey: principal },
        session: {
          id: sessionId, principalKey: principal, workspaceId: workspaceUuid,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main",
        },
      },
    });
    const source = {
      key: `${id}:original.md`, workspaceId: id, path: "original.md",
      status: "added", content: "data that must survive", updatedAt: 1,
    };
    const dest = {
      ...source, key: `${id}:renamed.md`, path: "renamed.md", updatedAt: 2,
    };
    await storage.saveOverlay(source);
    const changes = [
      { path: "original.md", expected: source, next: null },
      { path: "renamed.md", expected: null, next: dest },
    ];
    // One invalid expected revision aborts BOTH writes.
    const stale = { ...source, updatedAt: 0 };
    const deniedStale = await storage.compareAndApplyOverlays(id, [
      { path: "original.md", expected: stale, next: null },
      changes[1],
    ]).then(() => false, () => true);
    const unchanged = await storage.loadOverlays(id);
    if (!deniedStale || unchanged.length !== 1 ||
        unchanged[0].path !== "original.md") return { error: "Stale rename was not atomic" };
    await storage.compareAndApplyOverlays(id, changes);
    const renamed = await storage.loadOverlays(id);
    const deniedReplay = await storage.compareAndApplyOverlays(id, changes)
      .then(() => false, () => true);
    return {
      deniedStale, deniedReplay, count: renamed.length,
      path: renamed[0]?.path, content: renamed[0]?.content,
    };
  }, sourceUrl);
  expect(result).toEqual({
    deniedStale: true, deniedReplay: true,
    count: 1, path: "renamed.md", content: "data that must survive",
  });
});


test("real authorized workspace export excludes foreign owners and snapshots persisted files atomically", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const a = "gh:github.com:1001";
    const b = "gh:github.com:2002";
    const session = crypto.randomUUID();
    const workspaceUuid = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(a)}:${session}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "1".repeat(40), treeSha: "2".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: a, workspace: { id: workspaceUuid, principalKey: a },
        session: { id: session, principalKey: a, workspaceId: workspaceUuid,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    storage.bindStoragePrincipal(a);
    await storage.saveWorkspace(workspace);
    await storage.saveOverlay({
      key: id + ":README.md", workspaceId: id, path: "README.md",
      status: "modified", content: "PRIVATE_A_ONLY", updatedAt: 1,
    });
    // The export uses only persisted records rather than cached UI state.
    const authorized = await storage.exportOwnedWorkspaceSnapshot(id);
    storage.bindStoragePrincipal(b);
    const crossPrincipalRejected = await storage.exportOwnedWorkspaceSnapshot(id)
      .then(() => false, () => true);
    const forgedId = `ghcode-owned-v2:${encodeURIComponent(b)}:${session}`;
    const forgedRejected = await storage.exportOwnedWorkspaceSnapshot(forgedId)
      .then(() => false, () => true);
    storage.bindStoragePrincipal(a);
    const retry = await storage.exportOwnedWorkspaceSnapshot(id);
    return {
      sameOwner: authorized.workspace.ownership?.principalKey === a,
      overlays: authorized.overlays.map((entry: {content: string}) => entry.content),
      crossPrincipalRejected, forgedRejected,
      retryContent: retry.overlays[0]?.content,
    };
  }, sourceUrl);
  expect(result).toEqual({
    sameOwner: true, overlays: ["PRIVATE_A_ONLY"],
    crossPrincipalRejected: true, forgedRejected: true,
    retryContent: "PRIVATE_A_ONLY",
  });
});


test("real IndexedDB v5 quarantines every unattributed legacy record atomically without assigning its owner", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const a = "gh:github.com:1001";
    storage.bindStoragePrincipal(a);
    const legacyId = "acme/private@main";
    // Construct a genuine v2 database before calling the v5 storage module.
    // Opening a brand-new database directly at version 5 bypasses the storage
    // module's onupgradeneeded handler, creating NO object stores at all.
    // This fixture must exercise the actual v2 -> v5 structural upgrade.
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("darkfactory-workbench", 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const [name, keyPath] of [
          ["workspaces", "id"], ["blobs", "key"], ["overlays", "key"],
          ["staged", "key"], ["committed", "key"], ["commits", "id"],
        ] as const) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rawWorkspace = {
      version: 2, id: legacyId, updatedAt: 1, ref: "main",
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      baseSha: "a".repeat(40), treeSha: "b".repeat(40), tree: [],
    };
    const rawOverlay = {
      key: legacyId + ":README.md", workspaceId: legacyId, path: "README.md",
      status: "modified", content: "LEGACY_PRIVATE_SECRET", updatedAt: 1,
    };
    const written = database.transaction(["workspaces", "overlays"], "readwrite");
    written.objectStore("workspaces").put(rawWorkspace);
    written.objectStore("overlays").put(rawOverlay);
    await new Promise<void>((resolve, reject) => {
      written.oncomplete = () => resolve();
      written.onabort = () => reject(written.error);
    });
    database.close();
    const first = await storage.quarantineUnattributedLegacyRecords();
    const second = await storage.quarantineUnattributedLegacyRecords();
    const deniedOwned = await storage.loadWorkspace(legacyId, a).then(
      () => false, () => true,
    );
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("darkfactory-workbench", 5);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction(["legacyBackups", "workspaces", "overlays", "migrationState"], "readonly");
    const get = (name: string, key: string) => new Promise<unknown>((resolve, reject) => {
      const req = tx.objectStore(name).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const [workspaceBackup, overlayBackup, originalWorkspace, originalOverlay, state] = await Promise.all([
      get("legacyBackups", "workspaces:" + legacyId),
      get("legacyBackups", "overlays:" + legacyId + ":README.md"),
      get("workspaces", legacyId),
      get("overlays", legacyId + ":README.md"),
      get("migrationState", "legacy-unattributed-v2"),
    ]);
    db.close();
    const backup = overlayBackup as { raw?: { content?: string } } | undefined;
    const preserved = originalOverlay as { content?: string } | undefined;
    const migration = state as { stage?: string } | undefined;
    // An edited legacy record must NOT overwrite the first raw backup.
    const changedDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("darkfactory-workbench", 5);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const update = changedDb.transaction("overlays", "readwrite");
    update.objectStore("overlays").put({ ...rawOverlay, content: "LATER_UNATTRIBUTED_CHANGE" });
    await new Promise<void>((resolve, reject) => {
      update.oncomplete = () => resolve();
      update.onabort = () => reject(update.error);
    });
    changedDb.close();
    const deniedOverwrite = await storage.quarantineUnattributedLegacyRecords()
      .then(() => false, () => true);
    const finalDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("darkfactory-workbench", 5);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const inspect = finalDb.transaction(["legacyBackups", "overlays"], "readonly");
    const backedUp = inspect.objectStore("legacyBackups").get("overlays:" + legacyId + ":README.md");
    const originalChanged = inspect.objectStore("overlays").get(legacyId + ":README.md");
    await new Promise<void>((resolve, reject) => {
      inspect.oncomplete = () => resolve();
      inspect.onabort = () => reject(inspect.error);
    });
    finalDb.close();
    return {
      first, second, deniedOwned, deniedOverwrite,
      backup: backup?.raw?.content,
      preserved: preserved?.content,
      workspaceRetained: !!originalWorkspace,
      workspaceBackedUp: !!workspaceBackup,
      quarantineStage: migration?.stage,
      firstBackupUnchanged: backedUp.result?.raw?.content === "LEGACY_PRIVATE_SECRET",
      laterOriginalUnchanged: originalChanged.result?.content === "LATER_UNATTRIBUTED_CHANGE",
    };
  }, sourceUrl);
  expect(result).toEqual({
    first: { preservedRecords: 2, existingBackups: 0 },
    second: { preservedRecords: 0, existingBackups: 2 },
    deniedOwned: true, deniedOverwrite: true,
    backup: "LEGACY_PRIVATE_SECRET", preserved: "LEGACY_PRIVATE_SECRET",
    workspaceRetained: true, workspaceBackedUp: true,
    quarantineStage: "quarantined-not-attributed",
    firstBackupUnchanged: true, laterOriginalUnchanged: true,
  });
});


test("real owned-workspace import rejects foreign principals, invalid paths and overwrites atomically", async ({ page }) => {
  const result = await page.evaluate(async (url) => {
    const storage = await import(url);
    const a = "gh:github.com:1001";
    const b = "gh:github.com:2002";
    const session = crypto.randomUUID();
    const workspaceUuid = crypto.randomUUID();
    const id = `ghcode-owned-v2:${encodeURIComponent(a)}:${session}`;
    const workspace = {
      version: 2, id, ref: "main", updatedAt: 1,
      baseSha: "a".repeat(40), treeSha: "b".repeat(40), tree: [],
      repository: {
        id: 42, name: "private", owner: "acme", fullName: "acme/private",
        private: true, defaultBranch: "main", htmlUrl: "", canPush: true,
      },
      ownership: {
        principalKey: a, workspace: { id: workspaceUuid, principalKey: a },
        session: { id: session, principalKey: a, workspaceId: workspaceUuid,
          repositoryKey: "gh:github.com:repo:42", ref: "refs/heads/main" },
      },
    };
    const file = {
      key: id + ":README.md", workspaceId: id, path: "README.md",
      status: "modified", content: "RESTORED_A_SECRET", updatedAt: 5,
    };
    const backup = {
      workspace, overlays: [file],
      staged: [{ ...file, stagedAt: 5 }],
      committedFiles: [], commits: [],
    };
    storage.bindStoragePrincipal(a);
    await storage.saveWorkspace(workspace);
    const rejectedPath = await storage.importOwnedWorkspaceSnapshot({
      ...backup, overlays: [{ ...file, path: "../private", key: id + ":../private" }],
    }).then(() => false, () => true);
    const stillEmpty = (await storage.loadOverlays(id)).length === 0;
    storage.bindStoragePrincipal(b);
    const rejectedOwner = await storage.importOwnedWorkspaceSnapshot(backup)
      .then(() => false, () => true);
    storage.bindStoragePrincipal(a);
    await storage.importOwnedWorkspaceSnapshot(backup);
    const exported = await storage.exportOwnedWorkspaceSnapshot(id);
    const rejectedOverwrite = await storage.importOwnedWorkspaceSnapshot(backup)
      .then(() => false, () => true);
    const overlays = await storage.loadOverlays(id);
    const staged = await storage.loadStaged(id);
    return {
      rejectedPath, stillEmpty, rejectedOwner, rejectedOverwrite,
      overlays: overlays.map((item: {content?: string}) => item.content),
      staged: staged.map((item: {content?: string}) => item.content),
      persistedSnapshot: exported.overlays[0]?.content,
    };
  }, sourceUrl);
  expect(result).toEqual({
    rejectedPath: true, stillEmpty: true,
    rejectedOwner: true, rejectedOverwrite: true,
    overlays: ["RESTORED_A_SECRET"], staged: ["RESTORED_A_SECRET"],
    persistedSnapshot: "RESTORED_A_SECRET",
  });
});
