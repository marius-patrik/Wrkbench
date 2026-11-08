import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  BASE_SHA,
  installGithubMock,
  MOCK_REPOSITORY,
  PUBLIC_REPOSITORY,
} from "./github-mock";

type Surface = "primary" | "main" | "secondary" | "panel";

const surface = (page: Page, name: Surface) =>
  page.locator(`[data-workbench-surface="${name}"]`);

const tab = (page: Page, name: Surface, label: string) =>
  surface(page, name).locator(".dv-tab").filter({ hasText: label }).first();

async function dragTab(page: Page, from: Surface, label: string, to: Surface) {
  const source = tab(page, from, label);
  const target = surface(page, to);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error(`missing drag geometry for ${from} -> ${to}`);

  await source.dragTo(target, {
    force: true,
    targetPosition: {
      x: Math.max(20, Math.min(targetBox.width - 20, targetBox.width / 2)),
      y: Math.max(20, Math.min(targetBox.height - 20, targetBox.height / 2)),
    },
  });

  await expect.poll(async () => surface(page, from).getAttribute("data-workbench-dnd-stage")).toMatch(/source/);
  await expect(surface(page, to)).toHaveAttribute("data-workbench-dnd-stage", /^moved:/);
  await expect(tab(page, to, label)).toBeVisible();
  await expect(tab(page, from, label)).toHaveCount(0);
}

async function openCommand(page: Page, label: string) {
  const omnibar = page.getByLabel("Workbench omnibar");
  await omnibar.fill(`>${label}`);
  await omnibar.press("Enter");
}

async function openFromLauncher(page: Page, label: string) {
  const launcher = surface(page, "main").getByRole("button", { name: "Open tab launcher" }).last();
  await launcher.click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

async function seedAuthenticatedSession(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem("workbench-github-token", JSON.stringify({ token: "test-token" }));
  });
  await page.reload();
  await expect(page.getByTitle("Sign out")).toBeVisible();
}

async function openPrivateRepository(page: Page) {
  await page.getByRole("button", { name: /Open Repository/ }).first().click();
  await page.getByRole("textbox", { name: "Repository" }).fill(MOCK_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).toContainText(MOCK_REPOSITORY);
}

async function editActiveMonaco(page: Page, value: string) {
  const editor = surface(page, "main").locator(".monaco-editor").last();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(value);
  await page.waitForTimeout(450);
}

async function stageAndCommit(page: Page, message: string) {
  await tab(page, "primary", "Source Control").click();
  const row = surface(page, "primary").locator(".scm-change-row").filter({ hasText: "README.md" });
  await expect(row).toBeVisible();
  await row.getByTitle("Stage", { exact: true }).click();
  await expect(row.getByTitle("Unstage", { exact: true })).toBeVisible();

  await row.getByTitle("Unstage", { exact: true }).click();
  await expect(row.getByTitle("Stage", { exact: true })).toBeVisible();
  await row.getByTitle("Stage", { exact: true }).click();

  const messageBox = surface(page, "primary").getByLabel("Commit message");
  await messageBox.fill(message);
  await surface(page, "primary").getByRole("button", { name: /Commit staged/ }).click();
  await expect(surface(page, "primary").getByText(message, { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
});

test("root regions resize, clamp, hide/show, and persist", async ({ page }) => {
  const shell = page.locator(".workbench-shell");

  const readSize = async (name: "primary" | "secondary" | "panel") =>
    shell.evaluate((element, property) =>
      Number.parseFloat(getComputedStyle(element).getPropertyValue(`--${property}-size`)),
    name);

  const dragSeparator = async (label: string, dx: number, dy: number) => {
    const separator = page.getByRole("separator", { name: label });
    const box = await separator.boundingBox();
    if (!box) throw new Error(`${label} is not visible`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(shell).toHaveClass(/root-resizing/);
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
    await page.mouse.up();
  };

  const primaryBefore = await readSize("primary");
  await dragSeparator("Resize Primary Sidebar", 54, 0);
  await expect.poll(() => readSize("primary")).toBeGreaterThan(primaryBefore + 35);
  const primary = await readSize("primary");

  await page.getByTitle(/Toggle Secondary Sidebar/).click();
  const secondaryBefore = await readSize("secondary");
  await dragSeparator("Resize Secondary Sidebar", -44, 0);
  await expect.poll(() => readSize("secondary")).toBeGreaterThan(secondaryBefore + 25);
  const secondary = await readSize("secondary");

  const panelBefore = await readSize("panel");
  await dragSeparator("Resize Panel", 0, -38);
  await expect.poll(() => readSize("panel")).toBeGreaterThan(panelBefore + 20);
  const panel = await readSize("panel");

  await page.getByTitle(/Toggle Primary Sidebar/).click();
  await expect(page.getByRole("separator", { name: "Resize Primary Sidebar" })).toBeHidden();
  await page.getByTitle(/Toggle Primary Sidebar/).click();
  await page.getByTitle(/Toggle Panel/).click();
  await expect(page.getByRole("separator", { name: "Resize Panel" })).toBeHidden();
  await page.getByTitle(/Toggle Panel/).click();

  expect(Math.abs(await readSize("primary") - primary)).toBeLessThan(2);
  expect(Math.abs(await readSize("secondary") - secondary)).toBeLessThan(2);
  expect(Math.abs(await readSize("panel") - panel)).toBeLessThan(2);

  await page.reload();
  expect(Math.abs(await readSize("primary") - primary)).toBeLessThan(2);
  expect(Math.abs(await readSize("secondary") - secondary)).toBeLessThan(2);
  expect(Math.abs(await readSize("panel") - panel)).toBeLessThan(2);

  await page.setViewportSize({ width: 640, height: 640 });
  await expect.poll(async () => (await surface(page, "main").boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(290);
});

test("tabs move across root Dockview surfaces, existing groups, splits, and reload", async ({ page }) => {
  await page.getByTitle(/Toggle Secondary Sidebar/).click();

  await dragTab(page, "primary", "Explorer", "main");
  await dragTab(page, "main", "Explorer", "secondary");
  await dragTab(page, "secondary", "Explorer", "panel");

  const omnibar = page.getByLabel("Workbench omnibar");
  await omnibar.fill(">Open Browser");
  await omnibar.press("Enter");
  await expect(tab(page, "main", "Browser")).toBeVisible();

  await tab(page, "panel", "Explorer").dragTo(tab(page, "main", "Browser"), { force: true });
  await expect(tab(page, "main", "Explorer")).toBeVisible();
  await expect(tab(page, "panel", "Explorer")).toHaveCount(0);

  await dragTab(page, "main", "Explorer", "panel");

  const mainDock = surface(page, "main").locator(".workbench-dockview");
  const dockBox = await mainDock.boundingBox();
  if (!dockBox) throw new Error("main Dockview is not visible");
  await tab(page, "panel", "Explorer").dragTo(mainDock, {
    force: true,
    targetPosition: { x: Math.max(4, dockBox.width - 8), y: Math.max(20, dockBox.height / 2) },
  });
  await expect(tab(page, "main", "Explorer")).toBeVisible();
  await expect(tab(page, "panel", "Explorer")).toHaveCount(0);
  await expect(surface(page, "main").locator(".dv-groupview")).toHaveCount(2);

  await page.reload();
  await expect(tab(page, "main", "Explorer")).toBeVisible();
  await expect(tab(page, "main", "Browser")).toBeVisible();
  await expect(surface(page, "main").locator(".dv-groupview")).toHaveCount(2);
});

test("anonymous public repository and Browser history/reload/blocked fallback work", async ({ page }) => {
  await installGithubMock(page);
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>example</body></html>" }),
  );
  await page.route("https://example.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>example org</body></html>" }),
  );
  await page.route("https://blocked.example/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    await route.abort("failed");
  });

  await page.getByRole("button", { name: /Open Repository/ }).first().click();
  await page.getByRole("textbox", { name: "Repository" }).fill(PUBLIC_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).toContainText(PUBLIC_REPOSITORY, {
    timeout: 20_000,
  });

  await openCommand(page, "Open Browser");
  await expect(tab(page, "main", "Browser")).toBeVisible();

  const browser = surface(page, "main").locator(".browser-tab");
  const location = browser.getByRole("textbox", { name: "URL" });
  await location.fill("https://example.com");
  await location.press("Enter");
  await expect(browser.getByRole("button", { name: "Back" })).toBeEnabled();

  await location.fill("https://example.org");
  await location.press("Enter");
  await browser.getByRole("button", { name: "Back" }).click();
  await expect(location).toHaveValue(/example\.com/);

  await expect(browser.getByRole("button", { name: "Reload" })).toBeVisible();
  await browser.getByRole("button", { name: "Reload" }).click();

  await location.fill("https://blocked.example");
  await location.press("Enter");
  await expect(browser.getByText(/may block iframes/i)).toBeVisible({ timeout: 12_000 });
  await expect(browser.getByRole("link", { name: "Open externally" }).first()).toHaveAttribute("href", /blocked\.example/);
});

test("GitHub sign-in covers start, pending, success, denial, expiry, and sign-out", async ({ page }) => {
  await installGithubMock(page);
  await page.route("https://github.com/login/oauth/authorize**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Mock GitHub authorization</body></html>" }),
  );

  await page.getByRole("button", { name: /Open Repository/ }).first().click();
  const signIn = page.getByRole("button", { name: "Sign in with GitHub" });
  await expect(signIn).toBeEnabled();
  await signIn.click();
  await expect(page).toHaveURL(/github\.com\/login\/oauth\/authorize/);

  const authorize = new URL(page.url());
  expect(authorize.searchParams.get("client_id")).toBe("test-client-id");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
  expect(authorize.searchParams.get("state")).toBeTruthy();

  await page.goBack();
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem("workbench-github-auth-result") || "{}"));
  expect(pending.phase).toBe("pending");
  const transaction = await page.evaluate(() => JSON.parse(sessionStorage.getItem("workbench-github-auth-transaction") || "{}"));
  expect(transaction.state).toBeTruthy();

  await page.goto(`/?code=test-code&state=${encodeURIComponent(transaction.state)}`);
  await expect(page.getByTitle("Sign out")).toContainText("octocat");
  await expect.poll(async () => page.evaluate(() => {
    const raw = sessionStorage.getItem("workbench-github-auth-result");
    return raw ? JSON.parse(raw).phase : "";
  })).toBe("success");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTitle("Sign out").click();
  await expect(page.getByTitle("Sign in with GitHub")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("workbench-github-token"))).toBeNull();

  await page.goto("/?error=access_denied&error_description=Denied");
  await expect.poll(async () => page.evaluate(() => {
    const raw = sessionStorage.getItem("workbench-github-auth-result");
    return raw ? JSON.parse(raw).phase : "";
  })).toBe("denied");

  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.setItem("workbench-github-auth-transaction", JSON.stringify({
      state: "expired-state",
      verifier: "verifier",
      redirectUri: window.location.href,
      createdAt: 1,
    }));
  });
  await page.goto("/?code=expired&state=expired-state");
  await expect.poll(async () => page.evaluate(() => {
    const raw = sessionStorage.getItem("workbench-github-auth-result");
    return raw ? JSON.parse(raw).phase : "";
  })).toBe("expired");
});

test("authenticated private repo supports dirty edits, staging, local commit, push, and divergence", async ({ page }) => {
  const github = await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);

  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").getByTitle("README.md").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();
  await editActiveMonaco(page, "# Changed in browser\n");

  await stageAndCommit(page, "browser commit");
  const push = surface(page, "primary").getByTitle("Push local commits");
  await expect(push).toBeEnabled();
  await push.click();
  await expect.poll(() => github.state.pushed).toBe(true);
  expect(github.state.writes).toEqual(expect.arrayContaining(["blob", "tree", "commit", "graphql-ref-cas"]));
  await expect(surface(page, "primary").getByText("No local changes.")).toBeVisible();

  await tab(page, "main", "README.md").click();
  await editActiveMonaco(page, "# Divergent local change\n");
  await stageAndCommit(page, "divergent commit");

  github.setRemoteHead("9999999999999999999999999999999999999999");
  await surface(page, "primary").getByTitle("Fetch remote").click();
  await expect(surface(page, "primary").getByText(/Remote moved from/)).toBeVisible();
  await expect(surface(page, "primary").getByTitle("Push local commits")).toBeDisabled();
});


test("real Source Control branch creation preserves staged private edits in an atomic local fork", async ({ page }) => {
  const github = await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);
  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").getByTitle("README.md").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();
  await editActiveMonaco(page, "# Newly staged branch work\\n");

  await tab(page, "primary", "Source Control").click();
  const row = surface(page, "primary").locator(".scm-change-row").filter({ hasText: "README.md" });
  await expect(row.getByTitle("Stage", { exact: true })).toBeVisible();
  await row.getByTitle("Stage", { exact: true }).click();
  await expect(row.getByTitle("Unstage", { exact: true })).toBeVisible();

  page.once("dialog", async (dialog) => dialog.accept("topic"));
  await surface(page, "primary").getByTitle("Create branch").click();
  await expect(page.getByRole("combobox", { name: "Repository ref" })).toHaveValue("topic");
  await expect.poll(() => github.state.writes.includes("create-branch")).toBe(true);

  const persisted = await page.evaluate(async () => {
    const open = indexedDB.open("darkfactory-workbench");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const tx = db.transaction(["workspaces", "overlays", "staged"], "readonly");
      const read = (store: string) => new Promise<any[]>((resolve, reject) => {
        const request = tx.objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [workspaces, overlays, staged] = await Promise.all([
        read("workspaces"), read("overlays"), read("staged"),
      ]);
      const branch = workspaces.find((item) => item.ref === "topic");
      return {
        branchPresent: Boolean(branch),
        distinctSession: branch?.id !== workspaces.find((item) => item.ref === "main")?.id,
        stagedContent: staged.find((file) => file.workspaceId === branch?.id)?.content,
        workingContent: overlays.find((file) => file.workspaceId === branch?.id)?.content,
        belongsToPrincipal: branch?.ownership?.principalKey === "gh:github.com:1001",
      };
    } finally {
      db.close();
    }
  });
  expect(persisted).toEqual({
    branchPresent: true,
    distinctSession: true,
    stagedContent: "# Newly staged branch work\\n",
    workingContent: "# Newly staged branch work\\n",
    belongsToPrincipal: true,
  });
});

test("Monaco save failures guard Dockview close and account transition until acknowledged", async ({ page }) => {
  await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);
  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").getByTitle("README.md").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { restoreOverlayStore?: () => void }).restoreOverlayStore =
      () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "overlays")
        throw new DOMException("Injected quota failure", "QuotaExceededError");
      return original.apply(this, args as Parameters<IDBObjectStore["put"]>);
    };
  });
  await editActiveMonaco(page, "# Unacknowledged important draft\\n");
  await expect(surface(page, "main").locator(".resource-generated-notice[role=\"alert\"]")).toContainText(
    "Document save not acknowledged",
  );

  page.once("dialog", (dialog) => dialog.dismiss());
  await tab(page, "main", "README.md").getByTitle("Close").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();
  // A native middle-click must not bypass the DocumentService dirty guard.
  page.once("dialog", (dialog) => dialog.dismiss());
  await tab(page, "main", "README.md").click({ button: "middle", force: true });
  await expect(tab(page, "main", "README.md")).toBeVisible();
  // The initial group contains pinned perspective tabs, so Close Group
  // is intentionally disabled there. Split the editable document into its
  // own unpinned group to exercise a genuinely enabled native group action.
  await tab(page, "main", "README.md").click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Split Right" }).click();
  const editors = surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" });
  await expect(editors).toHaveCount(2);
  await editors.last().click({ button: "right", force: true });
  const closeGroupAction = page.getByRole("menuitem", { name: "Close Group" });
  await expect(closeGroupAction).toBeEnabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await closeGroupAction.click();
  await expect(editors).toHaveCount(2);
  await page.getByTitle("Sign out").click();
  await expect(page.getByTitle("Sign out")).toBeVisible();

  await page.evaluate(() => {
    (window as Window & { restoreOverlayStore?: () => void }).restoreOverlayStore?.();
  });
  // Both split views share one authoritative DocumentService model.
  // Either retry action flushes the same resource; avoid strict-mode ambiguity.
  await surface(page, "main").getByRole("button", { name: "Retry save" }).first().click();
  await expect(surface(page, "main").locator(".resource-generated-notice[role=\"alert\"]")).toHaveCount(0);
  // Once durably acknowledged, close the split group and remaining editor.
  await editors.last().click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "Close Group" }).click();
  await expect(editors).toHaveCount(1);
  await tab(page, "main", "README.md").click({ button: "middle", force: true });
  await expect(tab(page, "main", "README.md")).toHaveCount(0);
  await page.reload();

  const durable = await page.evaluate(async () => {
    const request = indexedDB.open("darkfactory-workbench");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction("overlays", "readonly");
        const get = tx.objectStore("overlays").getAll();
        get.onsuccess = () => resolve(
          get.result.some((item) => item.content === "# Unacknowledged important draft\\n"),
        );
        get.onerror = () => reject(get.error);
      });
    } finally {
      db.close();
    }
  });
  expect(durable).toBe(true);
});

test("GHC-00 pending Monaco draft survives a real Dockview cross-surface move and retry", async ({ page }) => {
  await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);
  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").getByTitle("README.md").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { restoreMoveOverlayStore?: () => void }).restoreMoveOverlayStore =
      () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "overlays")
        throw new DOMException("Simulated write failure before Dockview transfer", "QuotaExceededError");
      return original.apply(this, args as Parameters<IDBObjectStore["put"]>);
    };
  });
  const content = "# PENDING_MOVE_SENTINEL\n";
  await editActiveMonaco(page, content);
  await expect(surface(page, "main").getByRole("alert").filter({
    hasText: "Document save not acknowledged",
  })).toBeVisible();

  // The user may move a dirty pane; its live model must travel with the pane.
  // A transfer is not a close and must not silently ack the failed write.
  await dragTab(page, "main", "README.md", "panel");
  await expect(surface(page, "panel").getByRole("alert").filter({
    hasText: "Document save not acknowledged",
  })).toBeVisible();
  await expect(surface(page, "panel").locator(".monaco-editor .view-line").filter({
    hasText: "PENDING_MOVE_SENTINEL",
  })).toBeVisible();

  await page.evaluate(() => {
    (window as Window & { restoreMoveOverlayStore?: () => void }).restoreMoveOverlayStore?.();
  });
  await surface(page, "panel").getByRole("button", { name: "Retry save" }).click();
  await expect(surface(page, "panel").locator(".resource-generated-notice[role=alert]")).toHaveCount(0);
  await dragTab(page, "panel", "README.md", "main");
  await page.reload();

  const preserved = await page.evaluate(async () => {
    const request = indexedDB.open("darkfactory-workbench");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["workspaces", "overlays"], "readonly");
      const workspaces = tx.objectStore("workspaces").getAll();
      const overlays = tx.objectStore("overlays").getAll();
      return await new Promise<boolean>((resolve, reject) => {
        tx.oncomplete = () => resolve(overlays.result.some((item) =>
          item.path === "README.md" && item.content === "# PENDING_MOVE_SENTINEL\n" &&
          workspaces.result.some((workspace) => workspace.id === item.workspaceId &&
            workspace.ownership?.principalKey === "gh:github.com:1001")));
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  expect(preserved).toBe(true);
});

test("GHC-00 pending private edits block repository switch until a committed save", async ({ page }) => {
  await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);
  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").locator(".explorer-entry-main[title=\"README.md\"]").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as Window & { restoreSwitchOverlayStore?: () => void }).restoreSwitchOverlayStore =
      () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "overlays")
        throw new DOMException("Simulated disk quota before workspace switch", "QuotaExceededError");
      return original.apply(this, args as Parameters<IDBObjectStore["put"]>);
    };
  });
  await editActiveMonaco(page, "# SWITCH_PRIVATE_SENTINEL\n");
  await expect(surface(page, "main").getByRole("alert").filter({
    hasText: "Document save not acknowledged",
  })).toBeVisible();

  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill(PUBLIC_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-dialog-error"))
    .toContainText("Document changes are not durably acknowledged");
  await expect(page.locator(".workspace-repository-button")).toContainText(MOCK_REPOSITORY);
  await page.getByRole("dialog", { name: "Open GitHub repository" })
    .getByRole("button", { name: "Close" }).click();

  await page.evaluate(() => {
    (window as Window & { restoreSwitchOverlayStore?: () => void }).restoreSwitchOverlayStore?.();
  });
  await surface(page, "main").getByRole("button", { name: "Retry save" }).click();
  await expect(surface(page, "main").locator(".resource-generated-notice[role=alert]")).toHaveCount(0);
  await page.locator(".workspace-repository-button").click();
  await page.getByRole("textbox", { name: "Repository" }).fill(PUBLIC_REPOSITORY);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".workspace-repository-button")).toContainText(PUBLIC_REPOSITORY);
  // Each verified repository session has its own Dockview layout, so
  // opening the public README must NOT retain the old private tab or title.
  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").locator(".explorer-entry-main[title=\"README.md\"]").click();
  await expect(surface(page, "main").locator(".dv-tab").filter({ hasText: "README.md" }))
    .toHaveCount(1);

  // The public repository must not render the private draft. Prove durability
  // through the actual repository/Monaco UI after a fresh browser reload,
  // rather than inspecting another concurrent IndexedDB connection which can
  // wait indefinitely on blocked transactions during a context transition.
  await expect(page.getByText("SWITCH_PRIVATE_SENTINEL")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTitle("Sign out")).toBeVisible();
  await openPrivateRepository(page);
  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").locator(".explorer-entry-main[title=\"README.md\"]").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();
  await expect(surface(page, "main").locator(".monaco-editor .view-line")
    .filter({ hasText: "SWITCH_PRIVATE_SENTINEL" })).toBeVisible();
});

test("GitHub entity surfaces and omnibar navigate files, symbols, entities, commands, and refs", async ({ page }) => {
  await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);

  await openCommand(page, "Open Issues");
  await expect(surface(page, "main").getByText("#7 Private issue", { exact: true }).last()).toBeVisible();

  await openCommand(page, "Open Pull Requests");
  await expect(surface(page, "main").getByText("Private pull request")).toBeVisible();

  await openCommand(page, "Open Actions");
  await expect(surface(page, "main").getByText("Validate private repository", { exact: true }).last()).toBeVisible();

  await openFromLauncher(page, "Projects");
  await expect(surface(page, "main").getByText("#1 Private project", { exact: true })).toBeVisible();

  await openFromLauncher(page, "Branches & Tags");
  await expect(surface(page, "main").getByText("main", { exact: true }).last()).toBeVisible();
  await expect(surface(page, "main").getByText("v1.0.0", { exact: true }).last()).toBeVisible();

  await openFromLauncher(page, "Commits");
  await expect(surface(page, "main").getByText("Base commit")).toBeVisible();

  await openFromLauncher(page, "Releases");
  await expect(surface(page, "main").getByText("Version 1.0.0", { exact: true }).last()).toBeVisible();

  const omnibar = page.getByLabel("Workbench omnibar");
  await page.keyboard.press("Control+p");
  await expect(omnibar).toBeFocused();
  await omnibar.fill("src/app.ts");
  await omnibar.press("Enter");
  await expect(tab(page, "main", "app.ts")).toBeVisible();
  await omnibar.fill("@hello");
  await expect(page.getByRole("button", { name: /hello · function · line 1/ })).toBeVisible();
  await omnibar.press("Enter");

  await page.keyboard.press("Control+p");
  await expect(omnibar).toBeFocused();
  await omnibar.fill("#7");
  const issueResult = page.locator(".omnibar-results button").filter({ hasText: "Private issue" }).first();
  await expect(issueResult).toBeVisible();
  await issueResult.click();
  await expect(surface(page, "main").getByText("#7 Private issue", { exact: true }).last()).toBeVisible();

  await page.keyboard.press("Control+p");
  await omnibar.fill("branch:feature");
  await expect(page.locator(".omnibar-results button").filter({ hasText: "feature" }).first()).toBeVisible();
  await omnibar.press("Escape");

  await page.keyboard.press("Control+p");
  await omnibar.fill("project:1");
  await expect(page.locator(".omnibar-results button").filter({ hasText: "Private project" }).first()).toBeVisible();
  await omnibar.press("Enter");
  await expect(surface(page, "main").getByText("#1 Private project", { exact: true }).last()).toBeVisible();

  await page.keyboard.press("Control+p");
  await omnibar.fill(`commit:${BASE_SHA.slice(0, 7)}`);
  await expect(page.getByRole("button", { name: /Base commit/ })).toBeVisible();
  await omnibar.press("Enter");
  await expect(surface(page, "main").getByText(BASE_SHA)).toBeVisible();

  await page.keyboard.press("Control+p");
  await omnibar.fill("run:12");
  await expect(page.getByRole("button", { name: /Run #12/ })).toBeVisible();
  await omnibar.press("Enter");
  await expect(surface(page, "main").getByText("Validate private repository", { exact: true }).last()).toBeVisible();

  await page.keyboard.press("Control+p");
  await omnibar.fill("release:v1.0.0");
  await expect(page.getByRole("button", { name: /v1.0.0/ })).toBeVisible();
  await omnibar.press("Enter");
  await expect(surface(page, "main").getByText("Version 1.0.0", { exact: true }).last()).toBeVisible();
});

test("keyboard shortcuts toggle root regions and focus both omnibar modes", async ({ page }) => {
  const shell = page.locator(".workbench-shell");

  await page.keyboard.press("Control+b");
  await expect(shell).toHaveClass(/primary-collapsed/);
  await page.keyboard.press("Control+b");
  await expect(shell).not.toHaveClass(/primary-collapsed/);

  await page.keyboard.press("Control+Alt+b");
  await expect(shell).not.toHaveClass(/secondary-collapsed/);
  await page.keyboard.press("Control+Alt+b");
  await expect(shell).toHaveClass(/secondary-collapsed/);

  await page.keyboard.press("Control+j");
  await expect(shell).toHaveClass(/panel-collapsed/);
  await page.keyboard.press("Control+j");
  await expect(shell).not.toHaveClass(/panel-collapsed/);

  const omnibar = page.getByLabel("Workbench omnibar");
  await page.keyboard.press("Control+Shift+p");
  await expect(omnibar).toBeFocused();
  await expect(omnibar).toHaveValue(">");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+p");
  await expect(omnibar).toBeFocused();
});



test("owned backup round-trips private durable drafts and completed push journals", async ({ page }) => {
  await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);

  const recoveryIds = await page.evaluate(async () => {
    const request = indexedDB.open("darkfactory-workbench");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ draftId: string; pushId: string }>((resolve, reject) => {
        const tx = db.transaction(["workspaces", "blobs", "drafts", "pushOperations"], "readwrite");
        const request = tx.objectStore("workspaces").getAll();
        let result: { blobKey: string; draftId: string; pushId: string } | null = null;
        tx.oncomplete = () => result ? resolve(result) : reject(new Error("Fixture missing"));
        tx.onabort = () => reject(tx.error ?? new Error("Fixture transaction aborted"));
        request.onsuccess = () => {
          const workspace = request.result.find(
            (item) => item.ownership?.principalKey === "gh:github.com:1001",
          );
          if (!workspace) return tx.abort();
          const principal = workspace.ownership.principalKey;
          const session = workspace.ownership.session;
          const fields = [
            principal, workspace.id, session.id, session.repositoryKey,
            session.ref, workspace.baseSha, "README.md",
          ];
          const draftId = "ghcode-document-v1:" + fields.map(encodeURIComponent).join(":");
          const pushId = workspace.id + ":push:fixture-restore";
          const blobSha = "a".repeat(40);
          const blobKey = workspace.id + ":" + blobSha;
          tx.objectStore("blobs").add({
            key: blobKey, workspaceId: workspace.id, sha: blobSha,
            content: "Raw content-addressed blob fixture", updatedAt: Date.now(),
          });
          tx.objectStore("drafts").add({
            id: draftId, workspaceId: workspace.id, principalKey: principal,
            content: "# Safely checkpointed private bytes\n", revision: 3, updatedAt: Date.now(),
          });
          tx.objectStore("pushOperations").add({
            id: pushId, workspaceId: workspace.id, principalKey: principal,
            repositoryId: workspace.repository.id, ref: workspace.ref,
            expectedRemoteSha: workspace.baseSha, targetSha: workspace.baseSha,
            commitIds: [], phase: "completed", createdAt: Date.now(), updatedAt: Date.now(),
          });
          result = { blobKey, draftId, pushId };
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });

  await page.locator(".workspace-repository-button").click();
  await expect(page.getByRole("dialog", { name: "Open GitHub repository" })).toBeVisible();
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export owned local backup" }).click();
  const download = await downloadPending;
  const sourcePath = await download.path();
  if (!sourcePath) throw new Error("Owned backup download did not produce a file");
  const payload = JSON.parse(await readFile(sourcePath, "utf8"));
  expect(payload.schema).toBe(1);
  expect(payload.data.blobs).toEqual([
    expect.objectContaining({ key: recoveryIds.blobKey, content: "Raw content-addressed blob fixture" }),
  ]);
  expect(payload.data.drafts).toEqual([
    expect.objectContaining({
      id: recoveryIds.draftId,
      content: "# Safely checkpointed private bytes\n",
    }),
  ]);
  expect(payload.data.pushOperations).toEqual([
    expect.objectContaining({ id: recoveryIds.pushId, phase: "completed" }),
  ]);

  await page.evaluate(async ({ blobKey, draftId, pushId }) => {
    const request = indexedDB.open("darkfactory-workbench");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["blobs", "drafts", "pushOperations"], "readwrite");
        tx.objectStore("blobs").delete(blobKey);
        tx.objectStore("drafts").delete(draftId);
        tx.objectStore("pushOperations").delete(pushId);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("Fixture cleanup aborted"));
      });
    } finally {
      db.close();
    }
  }, recoveryIds);
  const reloaded = page.waitForEvent("load");
  await page.getByLabel("Owned local workspace backup file").setInputFiles({
    name: "owned-workspace-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload), "utf8"),
  });
  await reloaded;
  await expect(page.getByTitle("Sign out")).toBeVisible();
  const recovered = await page.evaluate(async ({ blobKey, draftId, pushId }) => {
    const request = indexedDB.open("darkfactory-workbench");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(["blobs", "drafts", "pushOperations"], "readonly");
      const blobReq = tx.objectStore("blobs").get(blobKey);
      const draftReq = tx.objectStore("drafts").get(draftId);
      const pushReq = tx.objectStore("pushOperations").get(pushId);
      return await new Promise<{ blob: unknown; draft: unknown; push: unknown }>((resolve, reject) => {
        tx.oncomplete = () => resolve({ blob: blobReq.result, draft: draftReq.result, push: pushReq.result });
        tx.onabort = () => reject(tx.error ?? new Error("Recovery lookup aborted"));
      });
    } finally {
      db.close();
    }
  }, recoveryIds);
  expect(recovered.blob).toEqual(expect.objectContaining({
    key: recoveryIds.blobKey, content: "Raw content-addressed blob fixture",
  }));
  expect(recovered.draft).toEqual(expect.objectContaining({
    id: recoveryIds.draftId, content: "# Safely checkpointed private bytes\n",
  }));
  expect(recovered.push).toEqual(expect.objectContaining({
    id: recoveryIds.pushId, phase: "completed",
  }));
});

test("uncertain remote push survives reload and safely reconciles without a second ref mutation", async ({ page }) => {
  const github = await installGithubMock(page);
  await seedAuthenticatedSession(page);
  await openPrivateRepository(page);

  await tab(page, "primary", "Explorer").click();
  await surface(page, "primary").getByTitle("README.md").click();
  await expect(tab(page, "main", "README.md")).toBeVisible();
  await editActiveMonaco(page, "# Durable pending push\\n");
  await stageAndCommit(page, "recover after missing acknowledgment");

  github.failAfterConditionalMutationOnce();
  await surface(page, "primary").getByTitle("Push local commits").click();
  await expect.poll(() => github.state.pushed).toBe(true);
  const unresolved = surface(page, "primary").getByRole("status", { name: "Unresolved push" });
  await expect(unresolved).toBeVisible();
  await expect(unresolved).toContainText("Expected remote revision");
  await expect(unresolved).toContainText("Intended target revision");
  await expect(unresolved).toContainText("Unpublished local commits");
  const remoteAfterWrite = github.state.remoteHead;
  expect(github.state.writes.filter((entry) => entry === "graphql-ref-cas")).toHaveLength(1);

  await page.reload();
  await expect(page.getByTitle("Sign out")).toBeVisible();
  await openPrivateRepository(page);
  await tab(page, "primary", "Source Control").click();
  const recovered = surface(page, "primary").getByRole("status", { name: "Unresolved push" });
  await expect(recovered).toBeVisible();
  await expect(recovered).toContainText(remoteAfterWrite);
  await expect(recovered).toContainText("Unfinished publication is durable");

  await recovered.getByRole("button", { name: "Retry recorded push safely" }).click();
  await expect(surface(page, "primary").getByText("No local changes.")).toBeVisible();
  await expect(recovered).toHaveCount(0);
  expect(github.state.remoteHead).toBe(remoteAfterWrite);
  expect(github.state.writes.filter((entry) => entry === "graphql-ref-cas")).toHaveLength(1);
});
