import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");
const url = pathToFileURL(resolve(process.argv[2] ?? ".canvas-dist/index.html")).href;
const browser = await chromium.launch({ headless: true });
const timeout = setTimeout(() => {
  console.error("Canvas canonical layout acceptance exceeded hard timeout");
  process.exit(1);
}, 110_000);

const dbName = "canvas:v3:marius-patrik/template-repo";

async function inspect(page) {
  return page.evaluate(async (name) => {
    const opened = indexedDB.open(name, 1);
    const db = await new Promise((resolve, reject) => {
      opened.onsuccess = () => resolve(opened.result);
      opened.onerror = () => reject(opened.error);
    });
    try {
      const tx = db.transaction(["workspaces", "migration", "backups"], "readonly");
      const values = ["workspaces", "migration", "backups"].map((store) => tx.objectStore(store).getAll());
      return await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve({
          layouts: values[0].result.filter((item) => item.data?.kind === "canvas-dockview-layout-v3"),
          migrations: values[1].result,
          backups: values[2].result,
          original: localStorage.getItem("canvas-dockview-layout-v2-global"),
        });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Layout inspection aborted"));
      });
    } finally { db.close(); }
  }, dbName);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

try {
  // Live UI, not a test-only IndexedDB client. Editor open and reload must
  // roundtrip only through the canonical C01 workspace record.
  // A managed BrowserContext is required for testing two tabs against the
  // exact same storage origin. Browser.newPage() creates an owned context that
  // correctly refuses any additional tabs.
  const sharedContext = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  const page = await sharedContext.newPage();
  page.setDefaultTimeout(11_000);
  await page.goto(url, { waitUntil: "load" });
  await page.getByTestId("empty-workspace").waitFor();
  await page.locator(".dock-welcome-options").getByRole("button", { name: "Editor" }).click();
  await page.locator('[data-dock-view="editor"]').waitFor();
  let snapshot;
  for (let iteration = 0; iteration < 40; iteration++) {
    snapshot = await inspect(page);
    const record = snapshot.layouts.find((x) => x.data.profileId === "global");
    if (record && JSON.stringify(record.data.layout).includes('"editor"')) break;
    await page.waitForTimeout(80);
  }
  const global = snapshot.layouts.find((x) => x.data.profileId === "global");
  assert(global && JSON.stringify(global.data.layout).includes('"editor"'),
    "Opening a real Dockview Editor must atomically write canonical IndexedDB layout");
  assert(snapshot.original === null, "Live Dockview app must no longer write legacy v2 localStorage key");
  const originalRevision = global.revision;
  await page.reload({ waitUntil: "load" });
  await page.locator('[data-dock-view="editor"]').waitFor();
  const reopened = await inspect(page);
  assert(reopened.layouts.find((x) => x.id === global.id)?.revision >= originalRevision,
    "Canonical layout ID/revision must survive reload");
  assert(reopened.original === null, "Reload must not reintroduce a second localStorage layout writer");

  // Real legacy conversion must preserve raw bytes, create a backup, atomically
  // mark imported and restore the original Dockview geometry in the UI.
  const rawLegacy = JSON.stringify({ schema: 2, layout: global.data.layout });
  const legacyPage = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  legacyPage.setDefaultTimeout(11_000);
  await legacyPage.addInitScript((raw) => {
    if (localStorage.getItem("canvas-dockview-layout-v2-global") === null)
      localStorage.setItem("canvas-dockview-layout-v2-global", raw);
  }, rawLegacy);
  await legacyPage.goto(url, { waitUntil: "load" });
  await legacyPage.locator('[data-dock-view="editor"]').waitFor();
  const migrated = await inspect(legacyPage);
  const converted = migrated.layouts.find((x) => x.data.profileId === "global");
  assert(converted && converted.id === global.id, "Legacy global profile must map to deterministic UUID");
  assert(migrated.original === rawLegacy, "Original legacy layout bytes must remain unchanged");
  assert(migrated.migrations.some((x) =>
    x.key === "canvas-dockview-layout-v2-global" && x.status === "imported"),
  "Migration marker must be committed with canonical layout in one IDB transaction");
  assert(migrated.backups.some((x) =>
    x.key === "canvas-dockview-layout-v2-global" && x.raw === rawLegacy),
  "C01 immutable backup must preserve exact original layout bytes");
  await legacyPage.reload({ waitUntil: "load" });
  await legacyPage.locator('[data-dock-view="editor"]').waitFor();
  const rerun = await inspect(legacyPage);
  assert(rerun.backups.length === migrated.backups.length,
    "Second mount must not overwrite or duplicate an existing migration backup");
  await legacyPage.close();

  // Malformed source records are never silently deleted, converted, or
  // replaced with an empty layout. Recovery becomes a visible blocking alert.
  const broken = await browser.newPage();
  broken.setDefaultTimeout(11_000);
  await broken.addInitScript(() => {
    if (!localStorage.getItem("canvas-dockview-layout-v2-global"))
      localStorage.setItem("canvas-dockview-layout-v2-global", "{malformed-json");
  });
  await broken.goto(url, { waitUntil: "load" });
  await broken.getByRole("alert").filter({ hasText: "Dockview layout was not durably saved" }).waitFor();
  const blocked = await inspect(broken);
  assert(blocked.layouts.length === 0, "Invalid legacy state must not fabricate acknowledged empty workspace");
  assert(blocked.original === "{malformed-json", "Malformed source remains unchanged");
  assert(blocked.backups.some((x) => x.raw === "{malformed-json"),
    "Malformed legacy source must still receive immutable raw backup");
  await broken.close();

  // A real IDB abort must surface in the UI, not create a fake green save
  // acknowledgement or fall back to the old second writer.
  const beforeFailure = await inspect(page);
  const current = beforeFailure.layouts.find((x) => x.id === global.id);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    window.__restoreLayoutPut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "workspaces")
        throw new DOMException("Injected layout quota denial", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.locator(".activity-new-tab").click();
  await page.getByRole("alert").filter({ hasText: "Dockview layout was not durably saved" }).waitFor();
  const afterFailure = await inspect(page);
  assert(afterFailure.layouts.find((x) => x.id === global.id).revision === current.revision,
    "Aborted layout update cannot advance durable revision");
  assert(afterFailure.original === null, "Failed save may not silently fallback to localStorage");
  await page.evaluate(() => window.__restoreLayoutPut?.());

  // Two genuinely concurrent windows share the same IndexedDB origin.
  // Window B must not overwrite a layout it rendered at an older revision.
  await page.reload({ waitUntil: "load" });
  await page.locator('[data-dock-view="editor"]').waitFor();
  const concurrent = await sharedContext.newPage();
  concurrent.setDefaultTimeout(11_000);
  await concurrent.goto(url, { waitUntil: "load" });
  await concurrent.locator('[data-dock-view="editor"]').waitFor();
  const beforeConcurrentWrite = await inspect(page);
  const observed = beforeConcurrentWrite.layouts.find((x) => x.id === global.id);
  // Opening another window alone must not create an unsolicited revision.
  assert(observed.revision === (await inspect(concurrent)).layouts.find((x) => x.id === global.id).revision,
    "Opening an unchanged layout in a second window must not mutate it");
  await page.locator(".activity-new-tab").click();
  await page.locator('[data-dock-view="new"]').waitFor();
  let newer;
  for (let attempt = 0; attempt < 40; attempt++) {
    newer = (await inspect(page)).layouts.find((x) => x.id === global.id);
    if (newer.revision > observed.revision) break;
    await page.waitForTimeout(80);
  }
  assert(newer.revision > observed.revision, "First tab must durably commit a new layout revision");
  await concurrent.locator(".activity-new-tab").click();
  await concurrent.getByRole("alert").filter({
    hasText: "Another window changed this Dockview layout",
  }).waitFor();
  const conflictSnapshot = (await inspect(page)).layouts.find((x) => x.id === global.id);
  assert(conflictSnapshot.revision === newer.revision,
    "Stale second window must not overwrite a newer canonical revision");
  await concurrent.close();
  await page.close();
  console.log("CAN-03 live Dockview: durable reload, lossless import, fail-closed invalid input, abort alert, concurrent revision CAS PASS");
} finally {
  clearTimeout(timeout);
  await browser.close();
}
