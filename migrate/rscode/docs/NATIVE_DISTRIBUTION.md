# RSCode portable native distribution — migrated source acceptance

**Status:** source-only acceptance candidate on `integration/tri-source-migration-baseline`, not a released or signed application. The original RSC-05 PR #28 was imported and subsequently repaired for real Windows/macOS/Linux hosts. The original source snapshot is not the current tested implementation.

## Packaged installation

Each native archive contains:

- An OS-native bundled Bun executable (Windows x64: **Bun 1.4.4**; Linux x64 and macOS x64/ARM64: **Bun 1.3.11**).
- Installed source and dependency tree from a frozen `bun.lock`.
- The compiled Rsbuild client under `dist/web`.
- A bundled Playwright Chromium installation and native browser probes.
- `distribution.json` with exact source SHA, OS/architecture, Bun version and browser provenance.
- A SHA-256 manifest for byte-integrity checking (not a publisher signature).

The package is a portable extracted application, **not** an MSI/MSIX, a notarized .app, or an auto-updating installer. The installed app needs neither a repository checkout nor a network install of Bun, packages or Chromium. Its default privileged local service binds to `127.0.0.1` only.

Run after extraction:

- macOS/Linux: `./canvas`
- Windows: `canvas.cmd`

User data is outside the extracted application and survives replacement:

- macOS: `~/Library/Application Support/RSCode`
- Windows: `%APPDATA%\\RSCode`
- Linux: `$XDG_DATA_HOME/rscode` or `~/.local/share/rscode`

`CANVAS_HOME`, `CANVAS_WORKSPACE_CWD` and `CANVAS_PORT` override data location, initial working directory and loopback service port respectively.

## Read-only, PR-only acceptance

`.github/workflows/migration-native-distribution.yml` builds, extracts and validates **on the actual host OS**:

| Target | Runner | Bun |
|---|---|---|
| Linux x64 | Ubuntu 24.04 | 1.3.11 |
| Windows x64 | Windows 2025 | 1.4.4 |
| macOS ARM64 | macOS 15 | 1.3.11 |
| macOS x64 | macOS 15 Intel | 1.3.11 |

The acceptance script `scripts/distribution/accept.py` verifies the archive checksum, extracts outside the source checkout, and invokes the **bundled** Bun. Required checks are:

1. Real extracted wrapper, health endpoint, frontend assets and isolated persistent data directory.
2. Actual host filesystem workspace create/edit/read and Git repository discovery/status.
3. Native PTY subprocess, including Windows ConPTY with native `ComSpec`/CMD.
4. Bundled Chromium running the installed frontend and retaining browser storage on restart.
5. **Server-owned Chromium CDP stream through the installed `/api/browser/stream` WebSocket**, including PNG IHDR/dimension validation, viewport resize, real page navigation and title.
6. Graceful server shutdown using SIGTERM or scoped Windows CTRL_BREAK/SIGBREAK, then restart, persisted workspace/browser data and clean port reuse.

After the server-stream probe, `accept.py` now **requires every listed check to be PASS**. An old compatibility branch that labels Windows filesystem operations BLOCKED cannot produce a passing acceptance report. A failed subprocess or timeout preserves diagnostic report data and fails the job.

The real source browser stress gate is separate: `migration-source-verification.yml` repeats `browserService.test.ts` in three independent Ubuntu runners, ten full runs each. This matches the original RSC-ROOT PR #40 stress breadth and checks actual native launch, frames, resize, input, dialog, quota/capacity behavior and shutdown.

## Packaging locally

Use a fresh absolute `PLAYWRIGHT_BROWSERS_PATH`, on the **target host OS and architecture**, before installation:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run build:web
bun scripts/distribution/build.ts
python3 scripts/distribution/archive.py
python3 scripts/distribution/accept.py
```

Python 3.12 is required for acceptance. Linux needs Chromium's additional system libraries (`bunx playwright install-deps chromium` on supported Ubuntu/Debian hosts). This is not a cross-build workflow.

## Outstanding release gates

- All four exact-head native acceptance jobs **and** all 30 migrated Chromium stress passes must complete; older green runs do not certify modified code.
- Bounded SIGSEGV retry protects only native process crashes. It must not delete another process's persistent Chromium singleton locks on initial launch, and it does not automatically fix unrelated blank-page/compositor or dialog races.
- A reproducibility rerun must compare two independently built artifacts with fixed toolchains, inputs and runner images.
- Windows signing, macOS signing/notarization, dependency-license/SPDX/attribution and distribution rights are unaccepted.
- There is no updater, installer, automated rollback or user-data migration engine.
- A healthy standalone source archive does not establish that the single merged Wrkbench app is integrated; these tests apply to **`migrate/rscode`** only.
- Do not expose the privileged local filesystem/terminal service over a public network or assume it has remote-user authentication.

Prior source acceptance reports and the integrated capability map are in `../../docs/migrations` relative to the repository root. No native binaries are published by the migration workflows.
