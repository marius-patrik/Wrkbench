import type {
  CommittedFile,
  LocalCommit,
  StagedFile,
  WorkspaceSnapshot,
  WorkingFile,
} from "./model";
import { encodeDocumentResourceId, isOwnedWorkspace, parseDocumentResourceId, parseOwnedWorkspaceId, validDocumentPath, type PrincipalKey } from "./identity";

const DATABASE = "darkfactory-workbench";
const VERSION = 5;
// The original workbench-recent-workspaces-v1 is unattributed legacy and stays untouched.
const OWNED_RECENT_PREFIX = "ghcode-recent-owned-v1:";

// Updated synchronously before any React identity transition. Never infer authorization
// from the workspace ID supplied by a caller, an old closure, or an IDB record itself.
let activePrincipal: PrincipalKey | null = null;
// A→B→A must invalidate A's previously captured authority, not just compare strings.
let principalGeneration = 0;
// Any pending readwrite transaction is revoked synchronously on identity changes.
const activeWrites = new Set<IDBTransaction>();

function validPrincipal(principal: unknown): principal is PrincipalKey {
  return typeof principal === "string" && (
    /^gh:github\.com:[1-9][0-9]*$/.test(principal) ||
    /^anon:[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(principal)
  );
}

export function bindStoragePrincipal(principal: PrincipalKey): void {
  if (!validPrincipal(principal)) throw new Error("Invalid storage principal identifier.");
  if (activePrincipal !== principal) {
    principalGeneration++;
    for (const tx of activeWrites) {
      try { tx.abort(); } catch { /* Already completed or inactive. */ }
    }
  }
  activePrincipal = principal;
}

function trackWrite(tx: IDBTransaction) {
  // Browser transactions support addEventListener; isolated unit fakes need not.
  if (typeof tx.addEventListener !== "function") return;
  activeWrites.add(tx);
  const clean = () => activeWrites.delete(tx);
  tx.addEventListener("complete", clean, { once: true });
  tx.addEventListener("abort", clean, { once: true });
}

function requireOwned(id: string) {
  const identity = parseOwnedWorkspaceId(id);
  if (!activePrincipal || !identity || identity.principalKey !== activePrincipal) {
    throw new Error("Workspace does not belong to the currently verified principal; legacy data remains quarantined.");
  }
}

/** Compare only immutable identities. Repository names are aliases, never authority. */
function samePersistedWorkspace(
  stored: WorkspaceSnapshot | undefined,
  candidate: WorkspaceSnapshot,
): boolean {
  const owner = activePrincipal;
  return !!owner && isOwnedWorkspace(stored, owner) &&
    isOwnedWorkspace(candidate, owner) &&
    stored.id === candidate.id &&
    stored.repository.id === candidate.repository.id &&
    stored.ref === candidate.ref &&
    stored.ownership.session.id === candidate.ownership.session.id &&
    stored.ownership.workspace.id === candidate.ownership.workspace.id &&
    stored.ownership.session.ref === candidate.ownership.session.ref &&
    stored.ownership.session.repositoryKey === candidate.ownership.session.repositoryKey;
}

function recentKey(owner: PrincipalKey) {
  return `${OWNED_RECENT_PREFIX}${encodeURIComponent(owner)}`;
}

/** No caller may choose another workspace's primary IDB key through file.key. */
function requireCanonicalFileKey(file: { workspaceId: string; key: string; path: string }): void {
  requireOwned(file.workspaceId);
  if (!validDocumentPath(file.path) ||
      file.key !== file.workspaceId + ":" + file.path)
    throw new Error("Invalid resource path or forged cross-workspace primary key.");
}

type BlobRecord = {
  key: string;
  workspaceId: string;
  sha: string;
  content: string;
  updatedAt: number;
};
type StoreName = "workspaces" | "blobs" | "overlays" | "staged" | "committed" | "commits" | "pushOperations" | "drafts" | "legacyBackups" | "migrationState";

/** String-key prefix query never materializes another workspace's private records. */
function ownedKeyRange(workspaceId: string): IDBKeyRange {
  requireOwned(workspaceId);
  // ':' precedes ';' in IDB's lexicographic string ordering.
  return IDBKeyRange.bound(workspaceId + ":", workspaceId + ";", false, true);
}


function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("workspaces")) {
        database.createObjectStore("workspaces", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("blobs")) {
        database.createObjectStore("blobs", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("overlays")) {
        database.createObjectStore("overlays", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("staged")) {
        database.createObjectStore("staged", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("committed")) {
        database.createObjectStore("committed", { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains("commits")) {
        database.createObjectStore("commits", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("pushOperations")) {
        database.createObjectStore("pushOperations", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("drafts")) {
        database.createObjectStore("drafts", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("legacyBackups")) {
        database.createObjectStore("legacyBackups", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("migrationState")) {
        database.createObjectStore("migrationState", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab."));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    // Preserve a producer's request-success hook. In particular, authorized
    // workspace replacement may enqueue its put after reading the old record.
    const onSuccess = request.onsuccess;
    request.onsuccess = (event) => {
      try {
        if (onSuccess) onSuccess.call(request, event);
        resolve(request.result);
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const boundPrincipal = activePrincipal;
  const boundGeneration = principalGeneration;
  const database = await openDatabase();
  try {
    if (boundPrincipal !== activePrincipal || boundGeneration !== principalGeneration)
      throw new Error("Storage principal changed before transaction began.");
    const transaction = database.transaction(name, mode);
    if (mode === "readwrite") trackWrite(transaction);
    // A successful IDBRequest is not proof that the transaction committed.
    // A later failure (including quota or explicit abort) must reject the API.
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
    // Attach a handler now: an abort may precede the request's error event.
    void committed.catch(() => {});
    let result: IDBRequest<T>;
    try {
      result = action(transaction.objectStore(name));
    } catch (error) {
      try { transaction.abort(); } catch { /* Already inactive. */ }
      throw error;
    }
    let value: T;
    try {
      value = await requestResult(result);
    } catch (error) {
      try { transaction.abort(); } catch { /* Already aborted. */ }
      throw error;
    }
    await committed;
    if (boundPrincipal !== activePrincipal || boundGeneration !== principalGeneration)
      throw new Error("Storage principal changed during transaction.");
    return value;
  } finally {
    database.close();
  }
}

/**
 * Workspace-scoped authoritative data boundary.
 *
 * A correctly encoded workspace ID is NOT evidence of an authorized repository.
 * Every read or mutation must first prove the persisted workspace's principal,
 * immutable repository ID, session, and selected ref inside the SAME IDB
 * transaction as the resource operation. No caller-supplied ownership claim is
 * accepted. Epoch fencing also rejects a revoked A→B→A closure.
 */
async function withOwnedStore<T>(
  name: Exclude<StoreName, "workspaces">,
  mode: IDBTransactionMode,
  workspaceId: string,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  requireOwned(workspaceId);
  const owner = activePrincipal;
  const generation = principalGeneration;
  const db = await openDatabase();
  try {
    if (!owner || owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Storage authorization changed before transaction.");
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(["workspaces", name], mode);
      if (mode === "readwrite") trackWrite(transaction);
      let reason: Error | null = null;
      let result!: T;
      let hasResult = false;
      const abortWith = (error: Error) => {
        reason = error;
        try { transaction.abort(); } catch { reject(error); }
      };
      transaction.oncomplete = () => {
        if (reason) return reject(reason);
        if (!hasResult || activePrincipal !== owner || generation !== principalGeneration)
          return reject(new Error("Storage authority changed or result was not acknowledged."));
        resolve(result);
      };
      transaction.onabort = () => reject(reason ?? transaction.error ??
        new Error("Authorized resource transaction aborted."));
      transaction.onerror = () => reject(reason ?? transaction.error ??
        new Error("Authorized resource transaction failed."));
      const proof = transaction.objectStore("workspaces").get(workspaceId);
      proof.onsuccess = () => {
        try {
          if (activePrincipal !== owner || generation !== principalGeneration)
            throw new Error("Storage authority revoked during transaction.");
          const persisted = proof.result as WorkspaceSnapshot | undefined;
          if (!isOwnedWorkspace(persisted, owner))
            throw new Error("No persisted principal/repository/session ownership proof for resource.");
          const request = action(transaction.objectStore(name));
          request.onsuccess = () => {
            result = request.result;
            hasResult = true;
          };
          request.onerror = () => abortWith(request.error ??
            new Error("Authorized resource operation failed."));
        } catch (error) {
          abortWith(error instanceof Error ? error : new Error(String(error)));
        }
      };
      proof.onerror = () => abortWith(proof.error ??
        new Error("Workspace ownership lookup failed."));
    });
  } finally {
    db.close();
  }
}

async function allForWorkspace<T extends { workspaceId: string }>(
  name: StoreName,
  workspaceId: string,
) {
  requireOwned(workspaceId);
  if (name === "workspaces") throw new Error("Workspace-scoped resource store required.");
  const all = await withOwnedStore<T[]>(name, "readonly", workspaceId, (store) =>
    store.getAll(ownedKeyRange(workspaceId)),
  );
  requireOwned(workspaceId);
  return all.filter((item) => {
    if (item.workspaceId !== workspaceId) return false;
    const record = item as T & { key?: string; id?: string; path?: string };
    const key = name === "commits" ? record.id : record.key;
    if (!key || !key.startsWith(workspaceId + ":") ||
        (name !== "commits" && (!record.path || !validDocumentPath(record.path) ||
          key !== workspaceId + ":" + record.path)))
      throw new Error("Corrupt resource identifier in authorized workspace.");
    return true;
  });
}


/**
 * Recovery journal for a single canonical document resource.
 *
 * This is NOT a competing working-tree writer. It stores only last-durably-
 * acknowledged draft checkpoints before the existing overlay CAS writer runs.
 * If a browser terminates during editing, only completed draft transactions
 * can be recovered. Authentication and immutable session/ref/source identity
 * are re-proven against the persisted workspace on EVERY operation.
 */
export type DocumentDraftRecord = {
  id: string;
  workspaceId: string;
  principalKey: PrincipalKey;
  content: string;
  revision: number;
  updatedAt: number;
};

async function transactAuthorizedDraft<T>(
  id: string,
  mode: IDBTransactionMode,
  mutate: (store: IDBObjectStore, current: DocumentDraftRecord | undefined) => T,
): Promise<T> {
  const identity = parseDocumentResourceId(id);
  const owner = activePrincipal;
  const generation = principalGeneration;
  if (!identity || !owner || identity.principalKey !== owner)
    throw new Error("Document draft is not owned by the verified principal.");
  requireOwned(identity.workspaceId);
  const db = await openDatabase();
  try {
    if (owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Draft authorization changed before transaction.");
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "drafts"], mode);
      if (mode === "readwrite") trackWrite(tx);
      const drafts = tx.objectStore("drafts");
      let output!: T;
      let ready = false;
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (!ready || owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Draft transaction was not acknowledged for this principal."));
        resolve(output);
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Draft transaction aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Draft transaction failed."));
      const workspace = tx.objectStore("workspaces").get(identity.workspaceId);
      workspace.onsuccess = () => {
        try {
          if (owner !== activePrincipal || generation !== principalGeneration ||
              !isOwnedWorkspace(workspace.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("No persisted principal/session ownership for draft.");
          // The parsed document's immutable repo, session, ref, SHA and path
          // must match the verified workspace, not just its user-shaped ID.
          if (encodeDocumentResourceId(workspace.result as WorkspaceSnapshot, identity.path) !== id)
            throw new Error("Draft resource revision or repository identity changed.");
          const reading = drafts.get(id);
          reading.onsuccess = () => {
            try {
              const current = reading.result as DocumentDraftRecord | undefined;
              if (current && (current.id !== id ||
                  current.workspaceId !== identity.workspaceId ||
                  current.principalKey !== owner ||
                  !Number.isSafeInteger(current.revision) || current.revision < 1 ||
                  typeof current.content !== "string"))
                throw new Error("Corrupt or cross-principal draft checkpoint.");
              output = mutate(drafts, current);
              ready = true;
            } catch (error) { abort(error); }
          };
          reading.onerror = () => abort(reading.error ?? new Error("Draft read failed."));
        } catch (error) { abort(error); }
      };
      workspace.onerror = () => abort(workspace.error ?? new Error("Draft ownership lookup failed."));
    });
  } finally {
    db.close();
  }
}

/** Return only a fully committed draft from the currently authorized session. */
export function loadDocumentDraft(id: string): Promise<DocumentDraftRecord | null> {
  return transactAuthorizedDraft(id, "readonly", (_store, current) => current ?? null);
}

/** Acknowledges draft durability only after its IDB transaction commits. */
export function checkpointDocumentDraft(
  id: string,
  content: string,
  revision: number,
): Promise<DocumentDraftRecord> {
  if (typeof content !== "string" || !Number.isSafeInteger(revision) || revision < 1)
    return Promise.reject(new Error("Invalid document draft revision or content."));
  const identity = parseDocumentResourceId(id);
  if (!identity) return Promise.reject(new Error("Invalid document draft identity."));
  return transactAuthorizedDraft(id, "readwrite", (store, current) => {
    if (current && (current.revision > revision ||
        (current.revision === revision && current.content !== content)))
      throw new Error("Document draft conflict: newer checkpoint already exists.");
    const next: DocumentDraftRecord = {
      id, workspaceId: identity.workspaceId, principalKey: identity.principalKey,
      content, revision, updatedAt: Date.now(),
    };
    store.put(next);
    return next;
  });
}

/** Never remove a newer checkpoint when a concurrent edit/save completes. */
export function discardDocumentDraft(
  id: string,
  content: string,
  revision: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(revision) || revision < 1)
    return Promise.reject(new Error("Invalid acknowledged draft revision."));
  return transactAuthorizedDraft(id, "readwrite", (store, current) => {
    if (!current || current.revision !== revision || current.content !== content)
      return false;
    store.delete(id);
    return true;
  });
}

export function saveWorkspace(snapshot: WorkspaceSnapshot) {
  requireOwned(snapshot.id);
  if (!snapshot.ownership || !activePrincipal || !isOwnedWorkspace(snapshot, activePrincipal))
    throw new Error("Refusing to overwrite unattributed legacy v2 workspace.");
  return withStore("workspaces", "readwrite", (store) => {
    const request = store.get(snapshot.id);
    request.onsuccess = () => {
      const previous = request.result as WorkspaceSnapshot | undefined;
      if (previous && (!samePersistedWorkspace(previous, snapshot) ||
          previous.updatedAt > snapshot.updatedAt)) {
        // The only safe path after an identity or revision conflict is explicit
        // reconciliation; never replace an existing unrelated owner/session.
        store.transaction.abort();
      } else if (!activePrincipal || !isOwnedWorkspace(snapshot, activePrincipal)) {
        store.transaction.abort();
      } else {
        store.put(snapshot);
      }
    };
    return request;
  });
}

export async function loadWorkspace(id: string, owner: PrincipalKey) {
  requireOwned(id);
  if (owner !== activePrincipal) throw new Error("Storage principal changed during workspace read.");
  const snapshot = await withStore<WorkspaceSnapshot | undefined>(
    "workspaces",
    "readonly",
    (store) => store.get(id),
  );
  requireOwned(id);
  return isOwnedWorkspace(snapshot, owner) ? snapshot : undefined;
}

/**
 * Branch-local state fork. Unlike saveWorkspace() followed by individual
 * saveOverlay/saveStaged/saveCommittedFile/saveLocalCommit calls, this copies
 * the entire authorized source workspace in ONE IndexedDB transaction.
 *
 * The remote ref may have been created immediately before this operation;
 * on failure no partially cloned local destination becomes visible.
 * Pending push journals are deliberately not cloned to a different ref.
 */
export async function forkOwnedWorkspaceState(
  source: WorkspaceSnapshot,
  target: WorkspaceSnapshot,
): Promise<void> {
  requireOwned(source.id);
  requireOwned(target.id);
  const owner = activePrincipal;
  const generation = principalGeneration;
  if (!owner || !isOwnedWorkspace(source, owner) || !isOwnedWorkspace(target, owner) ||
      source.id === target.id ||
      source.repository.id !== target.repository.id ||
      source.repository.fullName !== target.repository.fullName ||
      source.ownership?.session.repositoryKey !== target.ownership?.session.repositoryKey ||
      source.ref === target.ref ||
      source.baseSha !== target.baseSha || source.treeSha !== target.treeSha)
    throw new Error("Branch fork requires two distinct verified refs of the same immutable repository and base.");

  const db = await openDatabase();
  try {
    if (owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Branch fork authority revoked before transaction.");
    await new Promise<void>((resolve, reject) => {
      const stores = ["workspaces", "blobs", "overlays", "staged",
        "committed", "commits", "pushOperations"] as const;
      const tx = db.transaction([...stores], "readwrite");
      trackWrite(tx);
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Branch fork authority revoked before commit acknowledgment."));
        resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Branch fork transaction aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Branch fork transaction failed."));

      const workspaces = tx.objectStore("workspaces");
      const original = workspaces.get(source.id);
      const destination = workspaces.get(target.id);
      const groups = (["blobs", "overlays", "staged",
        "committed", "commits", "pushOperations"] as const).map((name) => ({
        name, request: tx.objectStore(name).getAll(ownedKeyRange(source.id)),
      }));
      let pending = groups.length + 2;
      const assemble = () => {
        if (--pending !== 0) return;
        try {
          if (owner !== activePrincipal || generation !== principalGeneration ||
              !samePersistedWorkspace(original.result as WorkspaceSnapshot | undefined, source) ||
              (original.result as WorkspaceSnapshot).updatedAt !== source.updatedAt ||
              (original.result as WorkspaceSnapshot).baseSha !== source.baseSha ||
              (original.result as WorkspaceSnapshot).treeSha !== source.treeSha)
            throw new Error("Branch fork source identity or base changed; reopen and retry.");
          if (destination.result !== undefined)
            throw new Error("Branch fork would overwrite an existing local workspace.");
          const lookup = new Map(groups.map((group) => [group.name, group.request.result as unknown[]]));
          const pendingPush = lookup.get("pushOperations") as PushOperation[];
          if (pendingPush.length)
            throw new Error("Resolve pending source-branch push operations before creating a new branch.");
          let count = 0;
          for (const records of lookup.values()) count += records.length;
          if (count > 10_000)
            throw new Error("Branch fork exceeds the safe local record count.");
          const fileClone = <T extends { key: string; workspaceId: string; path: string }>(file: T): T => {
            requireCanonicalFileKey(file);
            if (file.workspaceId !== source.id)
              throw new Error("Source file does not belong to verified branch.");
            return {
              ...file, key: target.id + ":" + file.path, workspaceId: target.id,
            };
          };
          const blobs = lookup.get("blobs") as BlobRecord[];
          const overlays = lookup.get("overlays") as WorkingFile[];
          const staged = lookup.get("staged") as StagedFile[];
          const committed = lookup.get("committed") as CommittedFile[];
          const commits = lookup.get("commits") as LocalCommit[];
          // Validate every source record before writing any target record.
          for (const blob of blobs) {
            if (blob.workspaceId !== source.id || blob.key !== source.id + ":" + blob.sha ||
                !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(blob.sha) ||
                typeof blob.content !== "string")
              throw new Error("Branch fork found a malformed or foreign-owned blob.");
          }
          for (const file of [...overlays, ...staged, ...committed]) fileClone(file);
          for (const commit of commits) {
            if (commit.workspaceId !== source.id ||
                !commit.id.startsWith(source.id + ":local:") ||
                !Array.isArray(commit.files) || typeof commit.message !== "string")
              throw new Error("Branch fork found a malformed local commit.");
            for (const file of commit.files) fileClone(file);
          }
          workspaces.add(target);
          for (const blob of blobs) tx.objectStore("blobs").add({
            ...blob, workspaceId: target.id, key: target.id + ":" + blob.sha,
          } satisfies BlobRecord);
          for (const file of overlays) tx.objectStore("overlays").add(fileClone(file));
          for (const file of staged) tx.objectStore("staged").add(fileClone(file));
          for (const file of committed) tx.objectStore("committed").add(fileClone(file));
          for (const commit of commits) tx.objectStore("commits").add({
            ...commit,
            id: target.id + ":local:" + commit.createdAt + ":" + crypto.randomUUID(),
            workspaceId: target.id,
            files: commit.files.map(fileClone),
          } satisfies LocalCommit);
        } catch (error) { abort(error); }
      };
      for (const request of [original, destination, ...groups.map((group) => group.request)]) {
        request.onsuccess = assemble;
        request.onerror = () => abort(request.error ?? new Error("Branch fork source read failed."));
      }
    });
  } finally {
    db.close();
  }
}

/**
 * Git blobs are content-addressed immutable objects. A source cache must not
 * overwrite a previously stored SHA with different bytes: doing so silently
 * corrupts the working tree, diff and commit base under that hash. The
 * persisted workspace ownership proof, existing-blob comparison and optional
 * insertion execute in ONE IndexedDB readwrite transaction.
 */
export async function saveBlob(workspaceId: string, sha: string, content: string): Promise<void> {
  requireOwned(workspaceId);
  if (!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
    throw new Error("Blob SHA must be an immutable full object hash.");
  if (typeof content !== "string") throw new Error("Blob content must be text.");
  const record: BlobRecord = {
    key: `${workspaceId}:${sha}`,
    workspaceId,
    sha,
    content,
    updatedAt: Date.now(),
  };
  const owner = activePrincipal;
  const generation = principalGeneration;
  const db = await openDatabase();
  try {
    requireOwned(workspaceId);
    if (!owner || owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Blob authority changed before transaction.");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "blobs"], "readwrite");
      trackWrite(tx);
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Blob authority revoked before transaction acknowledgment."));
        resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Blob transaction aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Blob transaction failed."));
      const proof = tx.objectStore("workspaces").get(workspaceId);
      proof.onsuccess = () => {
        try {
          if (owner !== activePrincipal || generation !== principalGeneration ||
              !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("Blob write lacks persisted workspace ownership.");
          const blobs = tx.objectStore("blobs");
          const previous = blobs.get(record.key);
          previous.onsuccess = () => {
            try {
              if (owner !== activePrincipal || generation !== principalGeneration)
                throw new Error("Blob authority changed before write.");
              const current = previous.result as BlobRecord | undefined;
              if (current) {
                if (current.key !== record.key || current.workspaceId !== workspaceId ||
                    current.sha !== sha || current.content !== content)
                  throw new Error("Immutable Git blob conflict: existing SHA has different bytes.");
                return; // Identical content is idempotent; preserve its timestamp.
              }
              blobs.add(record);
            } catch (error) { abort(error); }
          };
          previous.onerror = () => abort(previous.error ?? new Error("Blob lookup failed."));
        } catch (error) { abort(error); }
      };
      proof.onerror = () => abort(proof.error ?? new Error("Blob workspace lookup failed."));
    });
  } finally { db.close(); }
}

export async function loadBlob(workspaceId: string, sha: string) {
  requireOwned(workspaceId);
  if (!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
    throw new Error("Blob SHA must be an immutable full object hash.");
  const record = await withOwnedStore<BlobRecord | undefined>("blobs", "readonly", workspaceId, (store) =>
    store.get(`${workspaceId}:${sha}`),
  );
  requireOwned(workspaceId);
  if (record && (record.workspaceId !== workspaceId ||
      record.key !== workspaceId + ":" + sha || record.sha !== sha))
    throw new Error("Corrupt or foreign-owned blob record.");
  return record?.content ?? null;
}

export async function saveOverlay(file: WorkingFile) {
  requireCanonicalFileKey(file);
  await withOwnedStore("overlays", "readwrite", file.workspaceId, (store) => store.put(file));
}

export async function removeOverlay(workspaceId: string, path: string) {
  requireOwned(workspaceId);
  if (!validDocumentPath(path)) throw new Error("Invalid resource path.");
  await withOwnedStore("overlays", "readwrite", workspaceId, (store) => store.delete(`${workspaceId}:${path}`));
}


/**
 * Document-edit compare-and-swap. The expected overlay is the caller's last
 * observed durable value; a stale editor/tab must never overwrite a newer
 * edit or remove a concurrent overlay. Compare and mutation live in the same
 * serializable IndexedDB readwrite transaction, and completion is the sole
 * success acknowledgment.
 *
 * Legacy UI actions still using saveOverlay/removeOverlay are NOT covered by
 * this primitive; broad resource-level CAS remains an acceptance requirement.
 */
export async function compareAndSetOverlay(
  workspaceId: string,
  path: string,
  expected: WorkingFile | null,
  next: WorkingFile | null,
): Promise<void> {
  requireOwned(workspaceId);
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(
    segment => !segment || segment === "." || segment === "..",
  )) throw new Error("Invalid overlay document path.");
  const key = workspaceId + ":" + path;
  for (const value of [expected, next]) {
    if (value) requireCanonicalFileKey(value);
    if (value && (value.key !== key || value.workspaceId !== workspaceId ||
        value.path !== path)) throw new Error("Overlay resource identity mismatch.");
  }
  const owner = activePrincipal;
  const generation = principalGeneration;
  const db = await openDatabase();
  try {
    requireOwned(workspaceId);
    if (activePrincipal !== owner || generation !== principalGeneration)
      throw new Error("Document authority changed before CAS.");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "overlays"], "readwrite");
      trackWrite(tx);
      const store = tx.objectStore("overlays");
      let reason: Error | undefined;
      const abort = (error: Error) => {
        reason = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => {
        if (activePrincipal !== owner || generation !== principalGeneration)
          reject(new Error("Document authority changed during CAS."));
        else resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Overlay CAS transaction aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Overlay CAS transaction failed."));
      const proof = tx.objectStore("workspaces").get(workspaceId);
      proof.onsuccess = () => {
        try {
          requireOwned(workspaceId);
          if (activePrincipal !== owner || generation !== principalGeneration ||
              !owner || !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("Document CAS lacks persisted principal/repository/session authorization.");
          const read = store.get(key);
          read.onsuccess = () => {
            try {
              requireOwned(workspaceId);
              if (activePrincipal !== owner || generation !== principalGeneration)
                throw new Error("Document authority revoked before mutation.");
              const current = read.result as WorkingFile | undefined;
              const matches = expected === null
                ? current === undefined
                : current !== undefined && current.key === expected.key &&
                  current.workspaceId === expected.workspaceId &&
                  current.updatedAt === expected.updatedAt &&
                  sameWorking(current, expected);
              if (!matches)
                throw new Error("Document conflict: stored overlay changed since this editor last loaded it.");
              if (next) store.put(next);
              else store.delete(key);
            } catch (error) {
              abort(error instanceof Error ? error : new Error(String(error)));
            }
          };
        } catch (error) {
          abort(error instanceof Error ? error : new Error(String(error)));
        }
      };
      proof.onerror = () => abort(proof.error ??
        new Error("Document ownership lookup failed."));
    });
  } finally {
    db.close();
  }
}


/**
 * Apply a multi-path overlay transition atomically.
 * Examples include a source deletion and destination creation during rename.
 * Every affected path requires its caller-observed durable predecessor.
 * No partial rename is committed if another tab writes either path first.
 */
export async function compareAndApplyOverlays(
  workspaceId: string,
  changes: Array<{ path: string; expected: WorkingFile | null; next: WorkingFile | null }>,
): Promise<void> {
  requireOwned(workspaceId);
  if (!changes.length) throw new Error("Overlay transaction requires at least one change.");
  const paths = new Set<string>();
  for (const change of changes) {
    if (!validDocumentPath(change.path) || paths.has(change.path))
      throw new Error("Invalid or duplicate overlay mutation path.");
    paths.add(change.path);
    for (const file of [change.expected, change.next]) {
      if (!file) continue;
      requireCanonicalFileKey(file);
      if (file.workspaceId !== workspaceId || file.path !== change.path)
        throw new Error("Overlay mutation resource identity mismatch.");
    }
  }
  const owner = activePrincipal;
  const generation = principalGeneration;
  const db = await openDatabase();
  try {
    requireOwned(workspaceId);
    if (!owner || owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Overlay authority changed before group transaction.");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "overlays"], "readwrite");
      trackWrite(tx);
      const store = tx.objectStore("overlays");
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Overlay authority revoked before transaction acknowledgment."));
        resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Overlay group CAS aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Overlay group CAS failed."));
      const proof = tx.objectStore("workspaces").get(workspaceId);
      proof.onsuccess = () => {
        try {
          if (owner !== activePrincipal || generation !== principalGeneration ||
              !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("Overlay group CAS lacks persisted workspace ownership.");
          // Requests must be enqueued before IndexedDB's transaction becomes idle.
          for (const change of changes) {
            const req = store.get(workspaceId + ":" + change.path);
            req.onsuccess = () => {
              try {
                if (owner !== activePrincipal || generation !== principalGeneration)
                  throw new Error("Overlay authority revoked while validating transition.");
                const current = req.result as WorkingFile | undefined;
                const expected = change.expected;
                const matches = expected === null ? current === undefined :
                  !!current && current.key === expected.key &&
                  current.workspaceId === expected.workspaceId &&
                  current.updatedAt === expected.updatedAt &&
                  sameWorking(current, expected);
                if (!matches)
                  throw new Error("Overlay conflict: file changed since multi-path operation began.");
                if (change.next) store.put(change.next);
                else store.delete(workspaceId + ":" + change.path);
              } catch (error) { abort(error); }
            };
            req.onerror = () => abort(req.error ?? new Error("Overlay snapshot read failed."));
          }
        } catch (error) { abort(error); }
      };
      proof.onerror = () => abort(proof.error ?? new Error("Workspace ownership read failed."));
    });
  } finally {
    db.close();
  }
}

export function loadOverlays(workspaceId: string) {
  return allForWorkspace<WorkingFile>("overlays", workspaceId);
}

export async function saveStaged(file: StagedFile) {
  requireCanonicalFileKey(file);
  await withOwnedStore("staged", "readwrite", file.workspaceId, (store) => store.put(file));
}

export async function removeStaged(workspaceId: string, path: string) {
  requireOwned(workspaceId);
  if (!validDocumentPath(path)) throw new Error("Invalid resource path.");
  await withOwnedStore("staged", "readwrite", workspaceId, (store) => store.delete(`${workspaceId}:${path}`));
}

export function loadStaged(workspaceId: string) {
  return allForWorkspace<StagedFile>("staged", workspaceId);
}

export async function saveCommittedFile(file: CommittedFile) {
  requireCanonicalFileKey(file);
  await withOwnedStore("committed", "readwrite", file.workspaceId, (store) => store.put(file));
}

export async function removeCommittedFile(workspaceId: string, path: string) {
  requireOwned(workspaceId);
  if (!validDocumentPath(path)) throw new Error("Invalid resource path.");
  await withOwnedStore("committed", "readwrite", workspaceId, (store) => store.delete(`${workspaceId}:${path}`));
}

export function loadCommittedFiles(workspaceId: string) {
  return allForWorkspace<CommittedFile>("committed", workspaceId);
}

export async function saveLocalCommit(commit: LocalCommit) {
  requireOwned(commit.workspaceId);
  if (!commit.id.startsWith(commit.workspaceId + ":local:") ||
      !commit.files.every((file) => file.workspaceId === commit.workspaceId))
    throw new Error("Invalid local commit resource identity.");
  for (const file of commit.files) requireCanonicalFileKey(file);
  await withOwnedStore("commits", "readwrite", commit.workspaceId, (store) => store.put(commit));
}

export async function removeLocalCommit(id: string) {
  const workspaceId = id.split(":local:")[0];
  requireOwned(workspaceId);
  await withOwnedStore("commits", "readwrite", workspaceId, (store) => store.delete(id));
}

export async function loadLocalCommits(workspaceId: string) {
  const commits = await allForWorkspace<LocalCommit>("commits", workspaceId);
  return commits.sort((left, right) => left.createdAt - right.createdAt);
}

async function clearStoreForWorkspace<T extends { key?: string; id?: string; workspaceId: string }>(
  name: StoreName,
  workspaceId: string,
) {
  const items = await allForWorkspace<T>(name, workspaceId);
  const owner = activePrincipal;
  const generation = principalGeneration;
  const database = await openDatabase();
  try {
    requireOwned(workspaceId);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["workspaces", name], "readwrite");
      trackWrite(transaction);
      const store = transaction.objectStore(name);
      let reason: Error | null = null;
      const abortWith = (error: Error) => {
        reason = error;
        try { transaction.abort(); } catch { reject(error); }
      };
      transaction.oncomplete = () =>
        activePrincipal === owner && principalGeneration === generation
          ? resolve()
          : reject(new Error("Workspace authority changed during destructive cleanup."));
      transaction.onerror = () => reject(reason ?? transaction.error ??
        new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(reason ?? transaction.error ??
        new Error("IndexedDB transaction aborted"));
      const proof = transaction.objectStore("workspaces").get(workspaceId);
      proof.onsuccess = () => {
        try {
          if (!owner || activePrincipal !== owner || principalGeneration !== generation ||
              !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("No persisted workspace proof for destructive cleanup.");
          for (const item of items) {
            const key = item.key ?? item.id;
            if (!key || item.workspaceId !== workspaceId || !key.startsWith(workspaceId + ":"))
              throw new Error("Corrupt workspace resource key; refusing cleanup.");
            store.delete(key);
          }
        } catch (error) {
          abortWith(error instanceof Error ? error : new Error(String(error)));
        }
      };
      proof.onerror = () => abortWith(proof.error ??
        new Error("Workspace ownership lookup failed."));
    });
  } finally {
    database.close();
  }
}


function sameStaged(left: StagedFile, right: StagedFile) {
  return left.workspaceId === right.workspaceId &&
    left.key === right.key &&
    left.path === right.path &&
    left.status === right.status &&
    left.content === right.content &&
    left.baseSha === right.baseSha &&
    left.renamedFrom === right.renamedFrom &&
    left.stagedAt === right.stagedAt &&
    left.updatedAt === right.updatedAt;
}

/**
 * Atomic multi-file staging with an exact durable stage-set CAS.
 * Every edit to the staged set is applied as a single IDB transaction,
 * including rename/source-delete pairs and "unstage all". A concurrent
 * tab must reload instead of losing another editor's staged state.
 */
export async function compareAndApplyStaged(
  workspaceId: string,
  expected: StagedFile[],
  changes: Array<{ path: string; next: StagedFile | null }>,
): Promise<void> {
  requireOwned(workspaceId);
  const owner = activePrincipal;
  const generation = principalGeneration;
  const expectedKeys = new Set<string>();
  for (const file of expected) {
    requireCanonicalFileKey(file);
    if (file.workspaceId !== workspaceId || expectedKeys.has(file.key))
      throw new Error("Malformed or duplicate expected staged state.");
    expectedKeys.add(file.key);
  }
  const updates = new Set<string>();
  for (const change of changes) {
    if (!validDocumentPath(change.path) || updates.has(change.path))
      throw new Error("Duplicate or invalid staged mutation path.");
    updates.add(change.path);
    if (change.next) {
      requireCanonicalFileKey(change.next);
      if (change.next.workspaceId !== workspaceId || change.next.path !== change.path)
        throw new Error("Staged mutation targets another repository resource.");
    }
  }
  const db = await openDatabase();
  try {
    requireOwned(workspaceId);
    if (activePrincipal !== owner || principalGeneration !== generation)
      throw new Error("Staging authority was revoked before the transaction.");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "staged"], "readwrite");
      trackWrite(tx);
      let reason: Error | null = null;
      const abortWith = (error: Error) => {
        reason = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => {
        if (activePrincipal !== owner || principalGeneration !== generation)
          reject(new Error("Staging authority was revoked before acknowledgment."));
        else resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Staging CAS aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Staging CAS failed."));
      const proof = tx.objectStore("workspaces").get(workspaceId);
      const stored = tx.objectStore("staged").getAll(ownedKeyRange(workspaceId));
      let proofReady = false;
      let stagedReady = false;
      const apply = () => {
        if (!proofReady || !stagedReady) return;
        try {
          if (!owner || activePrincipal !== owner || principalGeneration !== generation ||
              !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("Staging CAS lacks persisted repository/session authority.");
          const current = stored.result as StagedFile[];
          for (const file of current) {
            requireCanonicalFileKey(file);
            if (file.workspaceId !== workspaceId)
              throw new Error("Staging record belongs to another workspace.");
          }
          if (current.length !== expected.length ||
              expected.some((file) => !current.some((actual) => sameStaged(actual, file))))
            throw new Error("Staged state changed concurrently; reload before staging.");
          const store = tx.objectStore("staged");
          for (const change of changes) {
            if (change.next) store.put(change.next);
            else store.delete(workspaceId + ":" + change.path);
          }
        } catch (error) {
          abortWith(error instanceof Error ? error : new Error(String(error)));
        }
      };
      proof.onsuccess = () => { proofReady = true; apply(); };
      stored.onsuccess = () => { stagedReady = true; apply(); };
      proof.onerror = () => abortWith(proof.error ?? new Error("Staging workspace lookup failed."));
      stored.onerror = () => abortWith(stored.error ?? new Error("Staging state read failed."));
    });
  } finally {
    db.close();
  }
}

/**
 * Transactional discard for an entire local change/rename group.
 *
 * A traditional sequence of removeOverlay() then removeStaged() can leave
 * half a rename or permanently delete working bytes if a second operation
 * aborts. Compare the caller's ENTIRE observed working and staged snapshots
 * against one serialized IndexedDB transaction before deleting anything.
 */
export async function compareAndDiscardLocalPaths(
  workspaceId: string,
  expectedOverlays: WorkingFile[],
  expectedStaged: StagedFile[],
  paths: string[],
): Promise<void> {
  requireOwned(workspaceId);
  if (!paths.length || paths.length > 10_000)
    throw new Error("Discard requires a bounded nonempty resource set.");
  const discarded = new Set(paths);
  if (discarded.size !== paths.length || paths.some((path) => !validDocumentPath(path)))
    throw new Error("Invalid or duplicated discard resource path.");

  const overlayKeys = new Set<string>();
  for (const file of expectedOverlays) {
    requireCanonicalFileKey(file);
    if (file.workspaceId !== workspaceId || overlayKeys.has(file.key))
      throw new Error("Invalid expected working-tree snapshot.");
    overlayKeys.add(file.key);
  }
  const stagedKeys = new Set<string>();
  for (const file of expectedStaged) {
    requireCanonicalFileKey(file);
    if (file.workspaceId !== workspaceId || stagedKeys.has(file.key))
      throw new Error("Invalid expected staged-tree snapshot.");
    stagedKeys.add(file.key);
  }
  if (paths.some((path) =>
    !overlayKeys.has(workspaceId + ":" + path) &&
    !stagedKeys.has(workspaceId + ":" + path)
  )) throw new Error("Cannot discard a path missing from the observed local state.");

  const owner = activePrincipal;
  const generation = principalGeneration;
  const db = await openDatabase();
  try {
    requireOwned(workspaceId);
    if (!owner || owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Discard authority changed before transaction.");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "overlays", "staged"], "readwrite");
      trackWrite(tx);
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Discard authority revoked before commit acknowledgement."));
        resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Discard transaction aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Discard transaction failed."));

      const proof = tx.objectStore("workspaces").get(workspaceId);
      const actualOverlays = tx.objectStore("overlays").getAll(ownedKeyRange(workspaceId));
      const actualStaged = tx.objectStore("staged").getAll(ownedKeyRange(workspaceId));
      let pending = 3;
      const apply = () => {
        if (--pending !== 0) return;
        try {
          if (owner !== activePrincipal || generation !== principalGeneration ||
              !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, owner))
            throw new Error("Discard lacks current persisted principal/repository/session authority.");
          const existingOverlays = actualOverlays.result as WorkingFile[];
          const existingStaged = actualStaged.result as StagedFile[];
          if (existingOverlays.length !== expectedOverlays.length ||
              existingStaged.length !== expectedStaged.length)
            throw new Error("Working or staged state changed concurrently; reload before discard.");
          for (const current of existingOverlays) {
            requireCanonicalFileKey(current);
            const expected = expectedOverlays.find((file) => file.key === current.key);
            if (!expected || current.workspaceId !== workspaceId ||
                current.updatedAt !== expected.updatedAt || !sameWorking(current, expected))
              throw new Error("Working overlay changed concurrently; reload before discard.");
          }
          for (const current of existingStaged) {
            requireCanonicalFileKey(current);
            const expected = expectedStaged.find((file) => file.key === current.key);
            if (!expected || current.workspaceId !== workspaceId ||
                !sameStaged(current, expected))
              throw new Error("Staging changed concurrently; reload before discard.");
          }
          for (const path of paths) {
            const key = workspaceId + ":" + path;
            tx.objectStore("overlays").delete(key);
            tx.objectStore("staged").delete(key);
          }
        } catch (error) { abort(error); }
      };
      for (const request of [proof, actualOverlays, actualStaged]) {
        request.onsuccess = apply;
        request.onerror = () => abort(request.error ?? new Error("Discard source read failed."));
      }
    });
  } finally {
    db.close();
  }
}

function sameWorking(left: WorkingFile, right: WorkingFile) {
  return left.path === right.path && left.status === right.status &&
    left.content === right.content && left.baseSha === right.baseSha &&
    left.renamedFrom === right.renamedFrom;
}

/**
 * A single IndexedDB transaction owns the entire local-commit transition:
 * committed-file state, durable commit, staged removals, and overlay reconciliation.
 * Stale staged inputs abort instead of committing an incomplete snapshot.
 * Other principals' records and unattributed v2 records are never mutated.
 */
export async function commitLocalChanges(commit: LocalCommit, expectedStaged: StagedFile[]) {
  requireOwned(commit.workspaceId);
  if (!expectedStaged.length || expectedStaged.length !== commit.files.length ||
      !commit.id.startsWith(`${commit.workspaceId}:local:`)) {
    throw new Error("Invalid local commit or empty staged snapshot.");
  }
  const keys = new Set<string>();
  for (const file of expectedStaged) {
    requireOwned(file.workspaceId);
    if (file.workspaceId !== commit.workspaceId ||
        !validDocumentPath(file.path) ||
        file.key !== `${commit.workspaceId}:${file.path}` || keys.has(file.key)) {
      throw new Error("Invalid staged ownership, key, or duplicate path.");
    }
    keys.add(file.key);
    const matching = commit.files.find(candidate => candidate.key === file.key);
    if (!matching || !sameWorking(matching, file)) {
      throw new Error("Local commit does not match staged files.");
    }
  }
  const db = await openDatabase();
  try {
    requireOwned(commit.workspaceId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "staged", "overlays", "committed", "commits"], "readwrite");
      trackWrite(tx);
      let abortReason: Error | null = null;
      const abortWith = (error: Error) => {
        abortReason = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(abortReason ?? tx.error ?? new Error("Local commit transaction aborted"));
      tx.onerror = () => reject(abortReason ?? tx.error ?? new Error("Local commit transaction failed"));
      const proof = tx.objectStore("workspaces").get(commit.workspaceId);
      const stagedRequest = tx.objectStore("staged").getAll();
      const overlaysRequest = tx.objectStore("overlays").getAll();
      let storedWorkspace: WorkspaceSnapshot | undefined;
      let proofReady = false;
      let storedStaged: StagedFile[] | null = null;
      let storedOverlays: WorkingFile[] | null = null;
      const apply = () => {
        if (!proofReady || !storedStaged || !storedOverlays) return;
        try {
          requireOwned(commit.workspaceId);
          if (!activePrincipal || !isOwnedWorkspace(storedWorkspace, activePrincipal))
            throw new Error("Missing persisted repository/session proof for local commit.");
          const current = storedStaged.filter(file => file.workspaceId === commit.workspaceId);
          if (current.length !== expectedStaged.length ||
              expectedStaged.some(file => !current.some(actual => sameStaged(actual, file)))) {
            throw new Error("Staged state changed concurrently; reload before committing.");
          }
          const overlayStore = tx.objectStore("overlays");
          const stagedStore = tx.objectStore("staged");
          const committedStore = tx.objectStore("committed");
          const now = Date.now();
          for (const file of expectedStaged) {
            committedStore.put({
              key: file.key, workspaceId: commit.workspaceId, path: file.path,
              content: file.status === "deleted" ? undefined : file.content,
              deleted: file.status === "deleted", baseSha: file.baseSha, updatedAt: now,
            } satisfies CommittedFile);
            stagedStore.delete(file.key);
            const overlay = storedOverlays.find(candidate =>
              candidate.workspaceId === commit.workspaceId && candidate.key === file.key);
            if (overlay && sameWorking(overlay, file)) {
              overlayStore.delete(file.key);
            } else if (overlay && file.status !== "deleted" &&
                       (overlay.status === "added" || overlay.status === "renamed")) {
              overlayStore.put({
                ...overlay, status: "modified", renamedFrom: undefined, updatedAt: now,
              } satisfies WorkingFile);
            }
          }
          // add(), not put(): an operation ID is immutable and cannot overwrite a prior commit.
          tx.objectStore("commits").add(commit);
        } catch (reason) {
          abortWith(reason instanceof Error ? reason : new Error(String(reason)));
        }
      };
      proof.onsuccess = () => {
        storedWorkspace = proof.result as WorkspaceSnapshot | undefined;
        proofReady = true;
        apply();
      };
      proof.onerror = () => abortWith(proof.error ??
        new Error("Local commit workspace lookup failed."));
      stagedRequest.onsuccess = () => { storedStaged = stagedRequest.result as StagedFile[]; apply(); };
      overlaysRequest.onsuccess = () => { storedOverlays = overlaysRequest.result as WorkingFile[]; apply(); };
    });
  } finally {
    db.close();
  }
}

export async function clearStaged(workspaceId: string) {
  await clearStoreForWorkspace<StagedFile>("staged", workspaceId);
}

/** Clear the complete local Git state in one atomic transaction after confirmed remote push. */
export async function clearLocalGitState(workspaceId: string) {
  requireOwned(workspaceId);
  const db = await openDatabase();
  try {
    requireOwned(workspaceId);
    await new Promise<void>((resolve, reject) => {
      const names: Array<"staged" | "committed" | "commits"> = ["staged", "committed", "commits"];
      const tx = db.transaction(["workspaces", ...names], "readwrite");
      trackWrite(tx);
      let abortReason: Error | null = null;
      const abortWith = (reason: Error) => {
        abortReason = reason;
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(abortReason ?? tx.error ?? new Error("Git state cleanup aborted"));
      tx.onerror = () => reject(abortReason ?? tx.error ?? new Error("Git state cleanup failed"));
      const proof = tx.objectStore("workspaces").get(workspaceId);
      proof.onsuccess = () => {
        try {
          requireOwned(workspaceId);
          if (!activePrincipal ||
              !isOwnedWorkspace(proof.result as WorkspaceSnapshot | undefined, activePrincipal))
            throw new Error("No persisted repository/session proof for Git cleanup.");
          for (const name of names) {
            const store = tx.objectStore(name);
            const request = store.getAll();
            request.onsuccess = () => {
              try {
                requireOwned(workspaceId);
                for (const item of request.result as Array<{ workspaceId: string; key?: string; id?: string }>) {
                  if (item.workspaceId !== workspaceId) continue;
                  const key = item.key ?? item.id;
                  if (!key || !key.startsWith(`${workspaceId}:`))
                    throw new Error("Corrupt Git state key; refusing destructive cleanup.");
                  store.delete(key);
                }
              } catch (reason) {
                abortWith(reason instanceof Error ? reason : new Error(String(reason)));
              }
            };
          }
        } catch (reason) {
          abortWith(reason instanceof Error ? reason : new Error(String(reason)));
        }
      };
      proof.onerror = () => abortWith(proof.error ??
        new Error("Git cleanup workspace lookup failed."));
    });
  } finally {
    db.close();
  }
}


/**
 * Durable, principal-scoped remote-push journal. A GitHub ref update and an
 * IndexedDB commit cannot be atomic: persist "ready" with the exact proposed
 * commit SHA BEFORE attempting the network ref update, then reconcile by
 * reading the remote ref after any uncertain outcome.
 *
 * An interrupted operation never authorizes deleting unpublished local commits.
 */
export type PushOperation = {
  id: string;
  workspaceId: string;
  principalKey: PrincipalKey;
  repositoryId: number;
  ref: string;
  expectedRemoteSha: string;
  commitIds: string[];
  phase: "prepared" | "ready" | "remote-confirmed" | "completed";
  targetSha?: string;
  createdAt: number;
  updatedAt: number;
};

function assertPushOwner(operation: PushOperation, workspace: WorkspaceSnapshot) {
  requireOwned(operation.workspaceId);
  if (!activePrincipal || operation.principalKey !== activePrincipal ||
      operation.workspaceId !== workspace.id || operation.repositoryId !== workspace.repository.id ||
      operation.ref !== workspace.ref || !isOwnedWorkspace(workspace, activePrincipal)) {
    throw new Error("Push journal identity does not match the authorized workspace.");
  }
}

function shaIsValid(sha: string) {
  return /^[a-f0-9]{40}$/i.test(sha);
}

function sameCommitSet(actual: LocalCommit[], expected: string[]) {
  const ids = actual.map((item) => item.id);
  return ids.length === expected.length &&
    new Set(ids).size === ids.length &&
    expected.every((id) => ids.includes(id));
}

/** Establish an immutable push intent atomically with validation of local commit IDs. */
export async function beginPushOperation(
  workspace: WorkspaceSnapshot,
  expectedCommitIds: string[],
): Promise<PushOperation> {
  requireOwned(workspace.id);
  if (!activePrincipal || !isOwnedWorkspace(workspace, activePrincipal) ||
      !shaIsValid(workspace.baseSha) || !expectedCommitIds.length ||
      new Set(expectedCommitIds).size !== expectedCommitIds.length ||
      expectedCommitIds.some((id) => !id.startsWith(`${workspace.id}:local:`))) {
    throw new Error("Invalid push identity, base SHA or commit snapshot.");
  }
  const owner = activePrincipal;
  const db = await openDatabase();
  try {
    requireOwned(workspace.id);
    return await new Promise<PushOperation>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "commits", "pushOperations"], "readwrite");
      trackWrite(tx);
      const workspaceRequest = tx.objectStore("workspaces").get(workspace.id);
      const commitsRequest = tx.objectStore("commits").getAll();
      const operationsRequest = tx.objectStore("pushOperations").getAll();
      let storedWorkspace: WorkspaceSnapshot | undefined;
      let proofReady = false;
      let commits: LocalCommit[] | undefined;
      let operations: PushOperation[] | undefined;
      let result: PushOperation | undefined;
      let reason: Error | undefined;
      const abortWith = (error: Error) => {
        reason = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => {
        if (result) resolve(result);
        else reject(new Error("Push intent transaction produced no record."));
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Push intent aborted"));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Push intent failed"));
      const apply = () => {
        if (!proofReady || !commits || !operations) return;
        try {
          requireOwned(workspace.id);
          if (activePrincipal !== owner || !samePersistedWorkspace(storedWorkspace, workspace) ||
              storedWorkspace?.baseSha !== workspace.baseSha ||
              storedWorkspace?.treeSha !== workspace.treeSha)
            throw new Error("Persisted workspace revision/identity changed during push preparation.");
          const existing = operations.filter((op) => op.workspaceId === workspace.id &&
            op.phase !== "completed");
          if (existing.length > 1) throw new Error("Multiple unresolved push operations.");
          if (existing.length === 1) {
            assertPushOwner(existing[0], workspace);
            result = existing[0];
            return;
          }
          const local = commits.filter((item) => item.workspaceId === workspace.id);
          if (!sameCommitSet(local, expectedCommitIds))
            throw new Error("Local commits changed while preparing push; reload and retry.");
          for (const item of local) {
            if (!item.id.startsWith(workspace.id + ":local:") ||
                !Array.isArray(item.files) ||
                item.files.some((file) =>
                  file.workspaceId !== workspace.id ||
                  !validDocumentPath(file.path) ||
                  file.key !== workspace.id + ":" + file.path))
              throw new Error("Malformed or foreign local commit cannot be pushed.");
          }
          result = {
            id: `${workspace.id}:push:${crypto.randomUUID()}`,
            workspaceId: workspace.id, principalKey: owner,
            repositoryId: workspace.repository.id, ref: workspace.ref,
            expectedRemoteSha: workspace.baseSha, commitIds: [...expectedCommitIds],
            phase: "prepared", createdAt: Date.now(), updatedAt: Date.now(),
          };
          tx.objectStore("pushOperations").add(result);
        } catch (error) {
          abortWith(error instanceof Error ? error : new Error(String(error)));
        }
      };
      workspaceRequest.onsuccess = () => {
        storedWorkspace = workspaceRequest.result as WorkspaceSnapshot | undefined;
        proofReady = true;
        apply();
      };
      workspaceRequest.onerror = () => abortWith(workspaceRequest.error ??
        new Error("Push workspace lookup failed."));
      commitsRequest.onsuccess = () => {
        commits = commitsRequest.result as LocalCommit[];
        apply();
      };
      operationsRequest.onsuccess = () => {
        operations = operationsRequest.result as PushOperation[];
        apply();
      };
    });
  } finally {
    db.close();
  }
}

export async function loadPendingPushOperation(
  workspace: WorkspaceSnapshot,
): Promise<PushOperation | null> {
  requireOwned(workspace.id);
  const all = await withOwnedStore<PushOperation[]>(
    "pushOperations", "readonly", workspace.id,
    (store) => store.getAll(ownedKeyRange(workspace.id)),
  );
  requireOwned(workspace.id);
  const pending = all.filter((item) => item.workspaceId === workspace.id && item.phase !== "completed");
  if (pending.length > 1) throw new Error("Multiple unresolved push operations.");
  if (!pending.length) return null;
  assertPushOwner(pending[0], workspace);
  return pending[0];
}

/** CAS phase transition; never overwrite a different tab's publication target. */
export async function advancePushOperation(
  workspace: WorkspaceSnapshot,
  id: string,
  from: PushOperation["phase"],
  to: "ready" | "remote-confirmed",
  targetSha?: string,
): Promise<PushOperation> {
  requireOwned(workspace.id);
  const db = await openDatabase();
  try {
    requireOwned(workspace.id);
    return await new Promise<PushOperation>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "pushOperations"], "readwrite");
      trackWrite(tx);
      let result: PushOperation | undefined;
      let reason: Error | undefined;
      const abortWith = (err: Error) => {
        reason = err;
        try { tx.abort(); } catch { reject(err); }
      };
      tx.oncomplete = () => result
        ? resolve(result)
        : reject(new Error("Push journal was not updated."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Push transition failed"));
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Push transition aborted"));
      const proof = tx.objectStore("workspaces").get(workspace.id);
      const req = tx.objectStore("pushOperations").get(id);
      let proofReady = false;
      let journalReady = false;
      const apply = () => {
        if (!proofReady || !journalReady) return;
        try {
          if (!samePersistedWorkspace(proof.result as WorkspaceSnapshot | undefined, workspace) ||
              (proof.result as WorkspaceSnapshot).baseSha !== workspace.baseSha)
            throw new Error("Push phase transition lacks matching persisted workspace identity.");
          const current = req.result as PushOperation | undefined;
          if (!current) throw new Error("Push operation not found.");
          assertPushOwner(current, workspace);
          if (current.phase !== from) throw new Error("Concurrent push phase change; reload and reconcile.");
          if ((from === "prepared" && to !== "ready") ||
              (from === "ready" && to !== "remote-confirmed") ||
              (from !== "prepared" && from !== "ready")) {
            throw new Error("Invalid push journal transition.");
          }
          if (to === "ready" && (!targetSha || !shaIsValid(targetSha)))
            throw new Error("Push target SHA must be a real Git commit hash.");
          if (to === "remote-confirmed" && (!current.targetSha || targetSha &&
              current.targetSha !== targetSha)) throw new Error("Unverified remote target.");
          result = { ...current, phase: to,
            targetSha: to === "ready" ? targetSha : current.targetSha,
            updatedAt: Date.now() };
          tx.objectStore("pushOperations").put(result);
        } catch (error) {
          abortWith(error instanceof Error ? error : new Error(String(error)));
        }
      };
      proof.onsuccess = () => { proofReady = true; apply(); };
      req.onsuccess = () => { journalReady = true; apply(); };
      proof.onerror = () => abortWith(proof.error ??
        new Error("Push phase workspace lookup failed."));
    });
  } finally { db.close(); }
}

/**
 * Confirmed remote ref is already at the journaled target. Complete local
 * cleanup + workspace advancement in ONE transaction. Refuse cleanup if a
 * second tab has committed more data since preparation; retain the journal
 * and all local objects for explicit reconciliation.
 */
export async function finalizeConfirmedPush(
  previous: WorkspaceSnapshot,
  next: WorkspaceSnapshot,
  operation: PushOperation,
): Promise<void> {
  requireOwned(previous.id);
  assertPushOwner(operation, previous);
  if (operation.phase !== "remote-confirmed" || !operation.targetSha ||
      next.baseSha !== operation.targetSha || next.id !== previous.id ||
      next.repository.id !== previous.repository.id || next.ref !== previous.ref ||
      !activePrincipal || !isOwnedWorkspace(next, activePrincipal)) {
    throw new Error("Cannot finalize a push without the confirmed ref and owned workspace.");
  }
  const db = await openDatabase();
  try {
    requireOwned(previous.id);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        ["workspaces", "commits", "committed", "overlays", "pushOperations"], "readwrite",
      );
      trackWrite(tx);
      let reason: Error | undefined;
      const abortWith = (error: Error) => {
        reason = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Push cleanup aborted"));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Push cleanup failed"));
      const reqs = {
        previous: tx.objectStore("workspaces").get(previous.id),
        commits: tx.objectStore("commits").getAll(),
        committed: tx.objectStore("committed").getAll(),
        overlays: tx.objectStore("overlays").getAll(),
        journal: tx.objectStore("pushOperations").get(operation.id),
      };
      let count = 0;
      const apply = () => {
        if (++count !== 5) return;
        try {
          requireOwned(previous.id);
          const storedWorkspace = reqs.previous.result as WorkspaceSnapshot | undefined;
          const currentJournal = reqs.journal.result as PushOperation | undefined;
          if (!storedWorkspace || !activePrincipal ||
              !isOwnedWorkspace(storedWorkspace, activePrincipal) ||
              !samePersistedWorkspace(storedWorkspace, previous) ||
              storedWorkspace.baseSha !== operation.expectedRemoteSha ||
              storedWorkspace.treeSha !== previous.treeSha ||
              !currentJournal || currentJournal.phase !== "remote-confirmed" ||
              currentJournal.targetSha !== operation.targetSha) {
            throw new Error("Push cleanup conflicts with local workspace or journal.");
          }
          assertPushOwner(currentJournal, previous);
          const local = (reqs.commits.result as LocalCommit[])
            .filter((item) => item.workspaceId === previous.id);
          if (!sameCommitSet(local, operation.commitIds))
            throw new Error("New local commits exist; confirmed remote push needs reconciliation.");
          for (const item of local) {
            if (!item.id.startsWith(previous.id + ":local:") ||
                !Array.isArray(item.files) ||
                item.files.some((file) =>
                  file.workspaceId !== previous.id ||
                  !validDocumentPath(file.path) ||
                  file.key !== previous.id + ":" + file.path))
              throw new Error("Corrupt local commit; refusing remote-push cleanup.");
          }
          const committedStore = tx.objectStore("committed");
          for (const file of reqs.committed.result as CommittedFile[]) {
            if (file.workspaceId !== previous.id) continue;
            if (file.key !== `${previous.id}:${file.path}`)
              throw new Error("Corrupt committed-file key; cleanup aborted.");
            committedStore.delete(file.key);
          }
          const commitStore = tx.objectStore("commits");
          for (const commit of local) commitStore.delete(commit.id);
          const overlayStore = tx.objectStore("overlays");
          for (const overlay of reqs.overlays.result as WorkingFile[]) {
            if (overlay.workspaceId !== previous.id) continue;
            if (overlay.key !== `${previous.id}:${overlay.path}`)
              throw new Error("Corrupt overlay key; cleanup aborted.");
            const remote = next.tree.find((item) => item.type === "blob" &&
              item.path === overlay.path);
            if (overlay.status === "deleted" && !remote) overlayStore.delete(overlay.key);
            else if (remote && (overlay.status === "added" || overlay.status === "renamed"))
              overlayStore.put({ ...overlay, status: "modified", renamedFrom: undefined,
                baseSha: remote.sha, updatedAt: Date.now() } satisfies WorkingFile);
          }
          tx.objectStore("workspaces").put(next);
          tx.objectStore("pushOperations").put({
            ...currentJournal, phase: "completed", updatedAt: Date.now(),
          } satisfies PushOperation);
        } catch (error) {
          abortWith(error instanceof Error ? error : new Error(String(error)));
        }
      };
      for (const request of Object.values(reqs)) request.onsuccess = apply;
    });
  } finally { db.close(); }
}


export type AuthorizedWorkspaceExport = {
  workspace: WorkspaceSnapshot;
  overlays: WorkingFile[];
  staged: StagedFile[];
  committedFiles: CommittedFile[];
  commits: LocalCommit[];
};

/**
 * One read-only IndexedDB snapshot for an explicit export action.
 * Never consult cached React arrays or unattributed v2 records for private
 * exports. A principal change between query and transaction acknowledgment
 * rejects the entire result; all stores share the SAME MVCC transaction.
 */
export async function exportOwnedWorkspaceSnapshot(workspaceId: string): Promise<AuthorizedWorkspaceExport> {
  requireOwned(workspaceId);
  const owner = activePrincipal;
  const generation = principalGeneration;
  const db = await openDatabase();
  try {
    if (!owner || owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Workspace export authority changed before transaction.");
    return await new Promise<AuthorizedWorkspaceExport>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "overlays", "staged", "committed", "commits"], "readonly");
      const proof = tx.objectStore("workspaces").get(workspaceId);
      const range = ownedKeyRange(workspaceId);
      const overlays = tx.objectStore("overlays").getAll(range);
      const staged = tx.objectStore("staged").getAll(range);
      const committed = tx.objectStore("committed").getAll(range);
      const commits = tx.objectStore("commits").getAll(range);
      tx.oncomplete = () => {
        try {
          if (owner !== activePrincipal || generation !== principalGeneration)
            throw new Error("Workspace export revoked before transaction committed.");
          const workspace = proof.result as WorkspaceSnapshot | undefined;
          if (!workspace || !isOwnedWorkspace(workspace, owner))
            throw new Error("Workspace export requires persisted immutable owner/session proof.");
          const lists = [
            ["overlays", overlays.result],
            ["staged", staged.result],
            ["committed", committed.result],
          ] as const;
          for (const [_store, files] of lists) {
            for (const file of files as Array<{ workspaceId: string; key: string; path: string }>) {
              if (file.workspaceId !== workspaceId ||
                  file.key !== workspaceId + ":" + file.path ||
                  !validDocumentPath(file.path))
                throw new Error("Export includes corrupt or cross-principal resource.");
            }
          }
          for (const commit of commits.result as LocalCommit[]) {
            if (commit.workspaceId !== workspaceId ||
                !commit.id.startsWith(workspaceId + ":local:") ||
                !Array.isArray(commit.files) || commit.files.some((file) =>
                  file.workspaceId !== workspaceId ||
                  !validDocumentPath(file.path) ||
                  file.key !== workspaceId + ":" + file.path))
              throw new Error("Export includes a corrupt or cross-principal local commit.");
          }
          resolve({
            workspace, overlays: overlays.result as WorkingFile[],
            staged: staged.result as StagedFile[],
            committedFiles: committed.result as CommittedFile[],
            commits: commits.result as LocalCommit[],
          });
        } catch (error) { reject(error); }
      };
      tx.onabort = () => reject(tx.error ?? new Error("Authorized workspace export transaction aborted."));
      tx.onerror = () => reject(tx.error ?? new Error("Authorized workspace export transaction failed."));
    });
  } finally {
    db.close();
  }
}


/**
 * Lossless, opt-in local quarantine for unattributed v2 records.
 *
 * This deliberately does NOT import, adopt or expose ambiguous private records
 * to the currently signed-in principal. The originals remain byte-for-byte
 * untouched in their original stores. All raw structured-clone backups and the
 * migration checkpoint commit in one transaction, or none do.
 *
 * There is no user-data export API for this quarantine. Recovery requires an
 * independent proof of original ownership; a repository name is not proof.
 */
export type LegacyQuarantineSummary = {
  preservedRecords: number;
  existingBackups: number;
};

type LegacyStoreName = "workspaces" | "blobs" | "overlays" | "staged" | "committed" |
  "commits" | "pushOperations" | "drafts";

const LEGACY_SOURCE_STORES: LegacyStoreName[] = [
  "workspaces", "blobs", "overlays", "staged", "committed",
  "commits", "pushOperations", "drafts",
];

type LegacyBackup = {
  id: string;
  sourceStore: LegacyStoreName;
  sourceKey: string;
  raw: unknown;
  preservedAt: number;
};

function validLegacyParent(record: unknown): record is WorkspaceSnapshot {
  if (!record || typeof record !== "object") return false;
  const snapshot = record as WorkspaceSnapshot;
  const parsed = typeof snapshot.id === "string" ? parseOwnedWorkspaceId(snapshot.id) : null;
  return !!parsed && isOwnedWorkspace(snapshot, parsed.principalKey);
}

function validResourceForParent(
  name: LegacyStoreName,
  record: unknown,
  owned: Map<string, WorkspaceSnapshot>,
): boolean {
  if (name === "workspaces") return validLegacyParent(record);
  if (!record || typeof record !== "object") return false;
  const item = record as { workspaceId?: unknown; key?: unknown; id?: unknown; path?: unknown; principalKey?: unknown };
  if (typeof item.workspaceId !== "string") return false;
  const snapshot = owned.get(item.workspaceId);
  if (!snapshot) return false;
  if (name === "commits")
    return typeof item.id === "string" && item.id.startsWith(item.workspaceId + ":local:");
  if (name === "pushOperations")
    return typeof item.id === "string" && item.id.startsWith(item.workspaceId + ":push:") &&
      item.principalKey === snapshot.ownership?.principalKey;
  if (name === "drafts") {
    if (typeof item.id !== "string") return false;
    const parsed = parseDocumentResourceId(item.id);
    if (!parsed || parsed.workspaceId !== item.workspaceId ||
        parsed.principalKey !== snapshot.ownership?.principalKey)
      return false;
    try { return encodeDocumentResourceId(snapshot, parsed.path) === item.id; }
    catch { return false; }
  }
  if (name === "blobs")
    return typeof item.key === "string" && item.key.startsWith(item.workspaceId + ":") &&
      typeof (record as { sha?: unknown }).sha === "string" &&
      item.key === item.workspaceId + ":" + (record as { sha: string }).sha;
  return typeof item.path === "string" && validDocumentPath(item.path) &&
    item.key === item.workspaceId + ":" + item.path;
}

/** Back up ambiguous local source records; never infer or grant ownership. */
export async function quarantineUnattributedLegacyRecords(): Promise<LegacyQuarantineSummary> {
  const owner = activePrincipal;
  const generation = principalGeneration;
  if (!owner) throw new Error("A verified storage principal is required for local quarantine.");
  const db = await openDatabase();
  try {
    if (owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Quarantine authority changed before opening transaction.");
    return await new Promise<LegacyQuarantineSummary>((resolve, reject) => {
      const tx = db.transaction(
        [...LEGACY_SOURCE_STORES, "legacyBackups", "migrationState"], "readwrite",
      );
      trackWrite(tx);
      const requests = LEGACY_SOURCE_STORES.map((name) => ({
        name, request: tx.objectStore(name).getAll(),
      }));
      const quarantine = tx.objectStore("legacyBackups");
      let pending = requests.length;
      let preservedRecords = 0;
      let existingBackups = 0;
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Quarantine was revoked before transaction acknowledgment."));
        resolve({ preservedRecords, existingBackups });
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Legacy quarantine transaction aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Legacy quarantine transaction failed."));

      const assemble = () => {
        if (--pending !== 0) return;
        try {
          if (owner !== activePrincipal || generation !== principalGeneration)
            throw new Error("Quarantine authority changed while examining local records.");
          const rawWorkspaces = requests.find((item) => item.name === "workspaces")?.request.result ?? [];
          const validOwners = new Map<string, WorkspaceSnapshot>();
          for (const raw of rawWorkspaces) {
            if (validLegacyParent(raw)) validOwners.set(raw.id, raw);
          }
          const now = Date.now();
          for (const { name, request } of requests) {
            for (const raw of request.result as unknown[]) {
              if (validResourceForParent(name, raw, validOwners)) continue;
              const item = raw as { id?: unknown; key?: unknown };
              const sourceKey = name === "workspaces" || name === "commits" ||
                name === "pushOperations" || name === "drafts" ? item.id : item.key;
              if (typeof sourceKey !== "string" || !sourceKey)
                throw new Error("Legacy record has no stable primary key; preserve original and abort.");
              const id = name + ":" + sourceKey;
              const previous = quarantine.get(id);
              previous.onsuccess = () => {
                try {
                  const existing = previous.result as LegacyBackup | undefined;
                  if (existing) {
                    if (existing.sourceStore !== name || existing.sourceKey !== sourceKey ||
                        JSON.stringify(existing.raw) !== JSON.stringify(raw))
                      throw new Error("Legacy source changed since backup; refusing to overwrite original backup.");
                    existingBackups += 1;
                  } else {
                    quarantine.add({
                      id, sourceStore: name, sourceKey, raw, preservedAt: now,
                    } satisfies LegacyBackup);
                    preservedRecords += 1;
                  }
                } catch (error) { abort(error); }
              };
              previous.onerror = () => abort(previous.error ?? new Error("Backup validation failed."));
            }
          }
          tx.objectStore("migrationState").put({
            id: "legacy-unattributed-v2",
            stage: "quarantined-not-attributed",
            updatedAt: now,
            // The summary is intentionally metadata-only; no private bytes
            // or account/repository identifiers are surfaced to UI callers.
          });
        } catch (error) { abort(error); }
      };
      for (const { request } of requests) {
        request.onsuccess = assemble;
        request.onerror = () => abort(request.error ?? new Error("Legacy source scan failed."));
      }
    });
  } finally {
    db.close();
  }
}


/**
 * Safely restore a backup into an EXISTING, verified workspace with empty
 * local state. This is not legacy ownership attribution or a foreign-workspace
 * import: repository/session/ref/base hashes must match exactly. Every state
 * record is verified before one atomic transaction writes anything.
 */
export async function importOwnedWorkspaceSnapshot(input: AuthorizedWorkspaceExport): Promise<void> {
  const owner = activePrincipal;
  const generation = principalGeneration;
  if (!owner || !input || !isOwnedWorkspace(input.workspace, owner))
    throw new Error("Import requires the original verified workspace owner.");
  const id = input.workspace.id;
  requireOwned(id);
  if (!Array.isArray(input.overlays) || !Array.isArray(input.staged) ||
      !Array.isArray(input.committedFiles) || !Array.isArray(input.commits))
    throw new Error("Imported state collections are malformed.");
  if ([input.overlays, input.staged, input.committedFiles, input.commits]
      .reduce((count, group) => count + group.length, 0) > 10_000)
    throw new Error("Imported local state exceeds the safe record count.");
  if (JSON.stringify(input).length > 32_000_000)
    throw new Error("Imported local state exceeds the safe size limit.");

  const validateFiles = (files: Array<{ workspaceId: string; key: string; path: string }>) => {
    const paths = new Set<string>();
    for (const file of files) {
      if (!file || typeof file !== "object") throw new Error("Invalid imported file record.");
      requireCanonicalFileKey(file);
      if (file.workspaceId !== id || paths.has(file.path))
        throw new Error("Duplicate or foreign imported file resource.");
      paths.add(file.path);
    }
  };
  validateFiles(input.overlays);
  validateFiles(input.staged);
  validateFiles(input.committedFiles);
  for (const file of [...input.overlays, ...input.staged]) {
    if (!["modified", "added", "deleted", "renamed"].includes(file.status) ||
        (file.content !== undefined && typeof file.content !== "string") ||
        !Number.isSafeInteger(file.updatedAt) || file.updatedAt < 0)
      throw new Error("Malformed imported working-file content or revision.");
  }
  for (const file of input.committedFiles) {
    if (typeof file.deleted !== "boolean" ||
        (file.content !== undefined && typeof file.content !== "string"))
      throw new Error("Malformed imported committed file.");
  }
  const commitIds = new Set<string>();
  for (const commit of input.commits) {
    if (!commit || commit.workspaceId !== id ||
        typeof commit.id !== "string" || !commit.id.startsWith(id + ":local:") ||
        commitIds.has(commit.id) || !Array.isArray(commit.files) ||
        typeof commit.message !== "string" ||
        !Number.isSafeInteger(commit.createdAt) || commit.createdAt < 0)
      throw new Error("Malformed imported local commit.");
    commitIds.add(commit.id);
    validateFiles(commit.files);
  }

  const db = await openDatabase();
  try {
    if (owner !== activePrincipal || generation !== principalGeneration)
      throw new Error("Import authority changed before transaction.");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workspaces", "overlays", "staged", "committed", "commits"], "readwrite");
      trackWrite(tx);
      const proof = tx.objectStore("workspaces").get(id);
      const overlays = tx.objectStore("overlays").getAll(ownedKeyRange(id));
      const staged = tx.objectStore("staged").getAll(ownedKeyRange(id));
      const committed = tx.objectStore("committed").getAll(ownedKeyRange(id));
      const commits = tx.objectStore("commits").getAll(ownedKeyRange(id));
      let pending = 5;
      let reason: Error | null = null;
      const abort = (error: unknown) => {
        reason = error instanceof Error ? error : new Error(String(error));
        try { tx.abort(); } catch { reject(reason); }
      };
      tx.oncomplete = () => {
        if (reason) return reject(reason);
        if (owner !== activePrincipal || generation !== principalGeneration)
          return reject(new Error("Import authority revoked before acknowledgment."));
        resolve();
      };
      tx.onabort = () => reject(reason ?? tx.error ?? new Error("Authorized workspace import aborted."));
      tx.onerror = () => reject(reason ?? tx.error ?? new Error("Authorized workspace import failed."));

      const apply = () => {
        if (--pending !== 0) return;
        try {
          if (owner !== activePrincipal || generation !== principalGeneration ||
              !samePersistedWorkspace(proof.result as WorkspaceSnapshot | undefined, input.workspace) ||
              (proof.result as WorkspaceSnapshot).baseSha !== input.workspace.baseSha ||
              (proof.result as WorkspaceSnapshot).treeSha !== input.workspace.treeSha)
            throw new Error("Import workspace ownership or base source revision mismatch.");
          if ([overlays, staged, committed, commits].some((request) => request.result.length > 0))
            throw new Error("Import would overwrite existing local work; export it first.");
          for (const file of input.overlays) tx.objectStore("overlays").add(file);
          for (const file of input.staged) tx.objectStore("staged").add(file);
          for (const file of input.committedFiles) tx.objectStore("committed").add(file);
          for (const commit of input.commits) tx.objectStore("commits").add(commit);
        } catch (error) { abort(error); }
      };
      for (const request of [proof, overlays, staged, committed, commits]) {
        request.onsuccess = apply;
        request.onerror = () => abort(request.error ?? new Error("Import conflict query failed."));
      }
    });
  } finally {
    db.close();
  }
}

export function loadRecentWorkspaces(owner: PrincipalKey): WorkspaceSnapshot[] {
  if (!activePrincipal || owner !== activePrincipal) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentKey(owner)) || "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is WorkspaceSnapshot => isOwnedWorkspace(item, owner))
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

export function rememberWorkspace(snapshot: WorkspaceSnapshot): WorkspaceSnapshot[] {
  const owner = snapshot.ownership?.principalKey;
  if (!owner || owner !== activePrincipal || !isOwnedWorkspace(snapshot, owner))
    throw new Error("Unattributed legacy workspace must not be added to owned recent history.");
  const recent = loadRecentWorkspaces(owner).filter((item) => item.id !== snapshot.id);
  recent.unshift(snapshot);
  localStorage.setItem(recentKey(owner), JSON.stringify(recent.slice(0, 12)));
  return recent.slice(0, 12);
}
