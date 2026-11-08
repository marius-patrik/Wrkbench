import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");
const url = pathToFileURL(resolve(process.argv[2] ?? ".canvas-dist/index.html")).href;
const database = "canvas:v3:marius-patrik/template-repo";
const browser = await chromium.launch({ headless: true });
const watchdog = setTimeout(() => {
  console.error("CAN-02 live profiles acceptance exceeded hard timeout");
  process.exit(1);
}, 135_000);

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
async function inspect(page) {
  return page.evaluate(async (dbName) => {
    const request = indexedDB.open(dbName, 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["workspaces", "migration", "backups"], "readonly");
      const requests = ["workspaces", "migration", "backups"].map((name) => tx.objectStore(name).getAll());
      return await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve({
          directories: requests[0].result.filter((row) => row.data?.kind === "canvas-profile-directory-v1"),
          backups: requests[2].result,
          markers: requests[1].result,
          raw: localStorage.getItem("canvas-profiles-v1"),
        });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? Error("CAN-02 inspection aborted"));
      });
    } finally {
      db.close();
    }
  }, database);
}
async function canonical(page, predicate = () => true) {
  let read;
  for (let tries = 0; tries < 85; tries++) {
    read = await inspect(page);
    if (read.directories.some(predicate)) return read;
    await page.waitForTimeout(100);
  }
  throw new Error("Expected canonical C01 profile transaction did not complete: " + JSON.stringify(read));
}
async function createProfile(page, name) {
  await page.getByTestId("profile-select").click();
  await page.getByRole("menuitem", { name: "New profile" }).click();
  await page.getByRole("textbox", { name: "Profile name" }).fill(name);
  await page.getByRole("button", { name: "Save profile" }).click();
}

try {
  // The actual React UI must use a single IDB writer for profile creation.
  // Playwright's browser.newPage() creates a page-owned context which cannot
  // open a second tab; a shared explicit context is required for true CAS.
  const shared = await browser.newContext({ viewport: { width: 1350, height: 850 } });
  const ui = await shared.newPage();
  ui.setDefaultTimeout(12_000);
  await ui.goto(url, { waitUntil: "load" });
  await ui.getByTestId("profile-select").waitFor();
  await createProfile(ui, "Persisted Research");
  const saved = await canonical(ui, (row) =>
    row.data.directory.profiles.some((p) => p.name === "Persisted Research"));
  const record = saved.directories[0];
  assert(record.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    "Profile catalog must have a canonical deterministic UUID");
  assert(saved.raw === null, "The active UI may not recreate the old Zustand localStorage writer");

  await ui.reload({ waitUntil: "load" });
  await ui.getByTestId("profile-select").waitFor();
  assert((await ui.getByTestId("profile-select").textContent()).includes("Persisted Research"),
    "Real UI must restore the selected IDB profile on reload");
  const reloaded = await inspect(ui);
  assert(reloaded.directories[0]?.id === record.id,
    "Reload must preserve the same UUID-based profile directory");

  // Fresh separate context: import authentic Zustand v1 bytes including
  // private notes and scratch drafts with zero loss or guessed attribution.
  const seeded = await browser.newContext();
  const legacy = await seeded.newPage();
  legacy.setDefaultTimeout(12_000);
  const source = JSON.stringify({
    state: {
      profiles: [
        {
          id: "global", name: "Global", route: "/canvas", pinned: ["editor"],
          note: "Raw legacy note preserved", selectedDocument: "README.md",
          drafts: { "README.md": "# Legacy scratch bytes" },
        },
        {
          id: "study", name: "Study", route: "/editor", pinned: [],
          note: "Study records", selectedDocument: "", drafts: {},
        },
      ],
      currentId: "study",
    },
    version: 1,
  });
  await legacy.addInitScript((raw) => {
    if (localStorage.getItem("canvas-profiles-v1") === null)
      localStorage.setItem("canvas-profiles-v1", raw);
  }, source);
  await legacy.goto(url, { waitUntil: "load" });
  await legacy.getByTestId("profile-select").waitFor();
  const imported = await canonical(legacy, (row) => row.data.directory.profiles.length === 2);
  const directory = imported.directories[0].data.directory;
  assert(directory.currentId === "study" &&
    directory.profiles[0].drafts["README.md"] === "# Legacy scratch bytes" &&
    directory.profiles[0].note === "Raw legacy note preserved",
  "Original profile identity, note, selected document, and scratch draft were not imported exactly");
  assert(imported.raw === source, "Original localStorage string was changed");
  assert(imported.backups.some((row) => row.key === "canvas-profiles-v1" && row.raw === source),
    "Immutable C01 migration backup must retain exact raw Zustand v1 bytes");
  assert(imported.markers.some((row) => row.key === "canvas-profiles-v1" && row.status === "imported"),
    "C01 must mark profile import only in the same transaction as canonical record");
  await legacy.reload({ waitUntil: "load" });
  await legacy.getByTestId("profile-select").waitFor();
  const importedAgain = await inspect(legacy);
  assert(importedAgain.backups.length === imported.backups.length,
    "Reload may not re-run or overwrite an imported immutable profile backup");
  await seeded.close();

  // A corrupt legacy source must be backed up but must NOT mount defaults or
  // silently discard notes/drafts; recovery is a real blocking UI.
  const badContext = await browser.newContext();
  const invalid = await badContext.newPage();
  invalid.setDefaultTimeout(12_000);
  await invalid.addInitScript(() => {
    localStorage.setItem("canvas-profiles-v1", "{bad-json");
  });
  await invalid.goto(url, { waitUntil: "load" });
  await invalid.getByRole("alert").filter({ hasText: "Saved profiles could not be recovered" }).waitFor();
  assert(await invalid.getByTestId("profile-select").count() === 0,
    "Unvalidated previous private profile state must block the app");
  const failed = await inspect(invalid);
  assert(failed.directories.length === 0 && failed.raw === "{bad-json" &&
    failed.backups.some((row) => row.raw === "{bad-json"),
  "Corrupt profile source must remain backed up and unaccepted");
  await badContext.close();

  // Simulated quota exhaustion must never acknowledge the edit or silently
  // write the previous localStorage key; a visible Retry must restore it.
  const prior = await inspect(ui);
  const priorRevision = prior.directories[0].revision;
  await ui.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreProfilePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "workspaces")
        throw new DOMException("Injected profile quota failure", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await createProfile(ui, "Pending Quota Recovery");
  await ui.getByRole("alert").filter({ hasText: "Profile or scratch changes were not saved" }).waitFor();
  const aborted = await inspect(ui);
  assert(aborted.directories[0].revision === priorRevision &&
    !aborted.directories[0].data.directory.profiles.some((p) => p.name === "Pending Quota Recovery"),
  "Failed transaction must not update the acknowledged profile directory");
  assert(aborted.raw === null, "Quota failure cannot recreate the old writer");
  await ui.evaluate(() => window.__restoreProfilePut?.());
  await ui.getByRole("button", { name: "Retry durable save" }).click();
  await canonical(ui, (row) => row.data.directory.profiles.some((p) => p.name === "Pending Quota Recovery"));
  assert(await ui.getByRole("alert").filter({ hasText: "Profile or scratch changes were not saved" }).count() === 0,
    "Successful retry must clear its actual durable-save warning");

  // Two real same-origin windows must not overwrite one another's profile
  // directory through the optimistic Zustand in-memory projection.
  const staleWindow = await ui.context().newPage();
  staleWindow.setDefaultTimeout(12_000);
  await staleWindow.goto(url, { waitUntil: "load" });
  await staleWindow.getByTestId("profile-select").waitFor();
  await createProfile(ui, "Canonical Writer A");
  const fromA = await canonical(ui, (row) =>
    row.data.directory.profiles.some((p) => p.name === "Canonical Writer A"));
  await createProfile(staleWindow, "Stale Writer B");
  await staleWindow.getByRole("alert")
    .filter({ hasText: "Profile or scratch changes were not saved" }).waitFor();
  const rejected = await inspect(ui);
  // Writer A may finish an additional legitimate route/profile checkpoint
  // after the first matching DB poll. Revision equality is NOT a security
  // contract; preserving A while rejecting B's bytes is.
  assert(rejected.directories[0].revision >= fromA.directories[0].revision,
    "Canonical profile revision may never regress");
  assert(rejected.directories[0].data.directory.profiles.some((p) => p.name === "Canonical Writer A"),
    "A stale tab may not displace the first window's acknowledged profile");
  assert(!rejected.directories[0].data.directory.profiles.some((p) => p.name === "Stale Writer B"),
    "Stale second window must never overwrite another window's acknowledged profile bytes");
  await staleWindow.close();

  await ui.close();
  console.log("CAN-02 live profiles: canonical create/reload, lossless notes+draft import, malformed quarantine, quota retry, stale-tab CAS PASS");
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
