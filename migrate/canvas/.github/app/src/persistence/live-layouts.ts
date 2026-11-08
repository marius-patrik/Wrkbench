import { type JsonObject, type WorkspaceId, type WorkspaceRecord } from "../domain/types";
import { type Result } from "../domain/errors";
import { createCanvasPersistence } from "./indexeddb";
import { asJsonObject, asWorkspaceId } from "./validation";

/**
 * Active CAN-03 bridge. Owns ONLY the Dockview layout domain: no other module
 * writes this workspace record, and the old localStorage layout writer is off.
 * Profile notes, editor drafts and appearance preferences remain outside this
 * cutover until their own single-writer migrations have explicit acceptance.
 */
const storage = createCanvasPersistence();
const legacyV2Key = (profileId: string) => `canvas-dockview-layout-v2-${profileId}`;
const legacyV1Key = "canvas-dockview-layout-v1";
const KIND = "canvas-dockview-layout-v3";

function demand<T>(result: Result<T>, context: string): T {
  if (!result.ok)
    throw new Error(`${context}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function profileName(profileId: string): string {
  if (!profileId || profileId.length > 100 || profileId.includes("\0"))
    throw new Error("Invalid Canvas profile identifier.");
  return profileId;
}

/** Version-5-style deterministic UUID in a dedicated namespace, not a cast
 * of legacy 'global'/'study'/etc. A profile's immutable layout key survives
 * reloads without storing a second writable localStorage ID mapping.
 */
export async function layoutWorkspaceId(profileId: string): Promise<WorkspaceId> {
  const name = profileName(profileId);
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure browser digest unavailable for layout workspace identity.");
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`canvas-dockview-layout-v3:\0${name}`),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return demand(asWorkspaceId(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  ), "Derive immutable Canvas layout identity");
}

function parseRecord(row: WorkspaceRecord, profileId: string): JsonObject | null {
  const data = row.data;
  if (data.kind !== KIND || data.profileId !== profileId)
    throw new Error("A conflicting workspace owns the Canvas layout UUID; refusing to overwrite it.");
  if (data.layout === null) return null;
  return demand(asJsonObject(data.layout), "Corrupt persisted Dockview layout");
}

function parseLegacy(raw: string): JsonObject {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Legacy Dockview layout is malformed; original bytes preserved for recovery."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !("layout" in parsed))
    throw new Error("Unrecognized legacy Dockview layout; original bytes preserved for recovery.");
  const layout = (parsed as { layout: unknown }).layout;
  return demand(asJsonObject(layout), "Unrecognized legacy Dockview layout");
}

class LiveCanvasLayouts {
  private ready: Promise<void> | null = null;
  private writeQueue = new Map<string, Promise<void>>();
  private readonly migrating = new Map<string, Promise<JsonObject | null>>();

  private initialize(): Promise<void> {
    if (!this.ready) {
      this.ready = storage.initialize().then((result) => {
        demand(result, "Initialize canonical Canvas IndexedDB");
      }).catch((error) => {
        this.ready = null; // allow an explicit retry after a transient failure
        throw error;
      });
    }
    return this.ready;
  }

  async load(profileId: string): Promise<JsonObject | null> {
    profileName(profileId);
    const ongoing = this.migrating.get(profileId);
    if (ongoing) return ongoing;
    const pending = this.loadOnce(profileId).finally(() => this.migrating.delete(profileId));
    this.migrating.set(profileId, pending);
    return pending;
  }

  private async loadOnce(profileId: string): Promise<JsonObject | null> {
    await this.initialize();
    const id = await layoutWorkspaceId(profileId);
    const existing = demand(await storage.readWorkspace(id), "Read verified Canvas layout");
    if (existing) return parseRecord(existing, profileId);

    // The v2/v1 localStorage keys become immutable recovery inputs. Do not
    // reset, rewrite or remove them; the first accepted layout write uses IDB.
    const candidates = profileId === "global"
      ? [legacyV2Key(profileId), legacyV1Key]
      : [legacyV2Key(profileId)];
    const raw = demand(storage.readLegacyValues(candidates), "Read raw legacy layouts");
    const found = raw.find((candidate) => candidate.raw !== null);
    if (!found || found.raw === null) return null;

    const prior = demand(await storage.readMigration(found.key), "Inspect layout migration");
    if (prior)
      throw new Error(`Previous layout migration is ${prior.status}; inspect the immutable backup before resuming.`);

    // C01 commits the byte-for-byte backup and a lease in one transaction.
    const lease = demand(await storage.beginLegacyMigration(found.key), "Back up legacy layout");
    const recovered = parseLegacy(found.raw);
    const migrated = await storage.commit({
      mutations: [{
        kind: "createWorkspace", id, expectedRevision: null,
        data: { kind: KIND, profileId, layout: recovered },
      }],
      migration: { key: found.key, expectedRevision: lease.revision },
    });
    if (!migrated.ok) {
      // Another tab may have won the atomic creation. Only an independently
      // validated matching workspace is allowed to resolve that race.
      const winner = demand(await storage.readWorkspace(id), "Verify concurrent layout migration");
      if (winner) return parseRecord(winner, profileId);
      throw new Error(`Legacy layout import not committed: ${migrated.error.code}: ${migrated.error.message}`);
    }
    return recovered;
  }

  /**
   * Acknowledge a layout only after the CAN-C01 transaction completes.
   * Concurrent writes in this tab are serialized; another tab's conflicting
   * revision fails visibly rather than silently overwriting its newer layout.
   */
  save(profileId: string, layout: unknown): Promise<void> {
    profileName(profileId);
    const snapshot = demand(asJsonObject(layout), "Invalid Dockview layout");
    const previous = this.writeQueue.get(profileId) ?? Promise.resolve();
    const attempt = previous.catch(() => {}).then(async () => {
      await this.initialize();
      const id = await layoutWorkspaceId(profileId);
      const existing = demand(await storage.readWorkspace(id), "Read layout revision");
      if (existing) parseRecord(existing, profileId);
      const result = await storage.commit({
        mutations: [existing ? {
          kind: "updateWorkspace" as const, id,
          expectedRevision: existing.revision,
          data: { kind: KIND, profileId, layout: snapshot },
        } : {
          kind: "createWorkspace" as const, id, expectedRevision: null,
          data: { kind: KIND, profileId, layout: snapshot },
        }],
      });
      demand(result, "Acknowledge durable Dockview layout");
    });
    this.writeQueue.set(profileId, attempt);
    void attempt.finally(() => {
      if (this.writeQueue.get(profileId) === attempt) this.writeQueue.delete(profileId);
    }).catch(() => {});
    return attempt;
  }
}

export const liveCanvasLayouts = new LiveCanvasLayouts();
