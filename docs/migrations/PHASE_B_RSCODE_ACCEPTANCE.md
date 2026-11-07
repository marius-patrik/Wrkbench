# Phase B — RSCode functional reconciliation and runtime acceptance

**Branch:** `integration/tri-source-migration-baseline` → draft PR #39  
**Starting source tree:** `b3c0597806dc2cb841135d597a3170065ef0e6ce`  
**Phase B source tree:** `a9e654796a0dda5060876e1ed3a3f7a389d0baaf`  
**Scope:** `migrate/rscode/` (not production `src/`), plus the existing read-only migration acceptance workflow and evidence.

## Disposition: no ancestry-only acceptance

The original RSCode source base and all relevant PR heads are already in the historical DAG, but **the selected implementation is the migrated source tree**. Source-local code and executable behavioral assertions determine acceptance. Historical commits alone are not sufficient.

| Source ref | Original head | Implemented in migrated source | Behavioral evidence | Gate |
|---|---|---|---|---|
| RSCode `main` | `39341ce5f845` | Full baseline under `migrate/rscode`, modified by later security/platform fixes | Original source unit/UI, root isolation | Baseline, not promotion |
| RSC-01 PR #23 | `ff102b484d56` | Superseded by RSC-03; no older weaker origin policy activated | RSC-03 final privileged HTTP/WS/security tests | Inherited |
| RSC-03 PR #25 | `65331558418c` | `api.ts`, `devServer.test.ts`, `runtimeSecurity.test.ts` exactly match their PR-head blobs; server/browser modules contain later revisions | `runtimeSecurity.test.ts`, `devServer.test.ts`, `browserService.test.ts`; exact-host/origin, websocket, bounded messages, filesystem and browser profile paths | Source acceptance |
| RSC-04 integration | `2d26ffd8f0bd` | Single-flight `Page.enable`/CDP screencast startup and cleanup retained in `browserService.ts` | Parallel subscriber startup, failed CDP retry, teardown-during-start, capacity ceiling, native stream | Source acceptance |
| RSC-05 PR #28 | `6ed334bcad6e` | Source/scripts adapted for native Windows path handling, ConPTY, signed-signal shutdown and browser provisioning | Installed bundle API/host FS/Git/PTY/Chromium/restart on actual Linux, Windows, macOS x64/ARM64 runners | Full native acceptance |
| RSC-ROOT PR #40 | `e278e964e765` | Bounded SIGSEGV launch retry; initial profile locks no longer deleted before launch; original PR stress breadth restored **against migrated source** | Real native Chromium stress: 3 replicas × 10 complete `browserService.test.ts` suites; unit asserts no cleanup on noncrash profile contention | 30-cycle stress |

### What was genuinely implemented during Phase B

1. **Browser-profile lock safety:** The migrated BrowserFrameService no longer removes Chromium `SingletonCookie`, `SingletonLock`, or `SingletonSocket` before a first launch. Those files can be owned by another process. The bounded recovery cleanup is performed only after this launch reports an observed native `SIGSEGV`. Tests cover both noncrash contention and crash-only cleanup.
2. **Actual installed native browser bridge:** Each extracted native archive now includes `browser-stream-probe.ts`. It uses its bundled Bun, creates a browser pane through the installed HTTP API, opens the installed server's own `/api/browser/stream` WebSocket, checks PNG bytes and embedded dimensions, resizes the real CDP viewport, navigates to a source-controlled HTML fixture and verifies the resulting page state. It reruns after restart and confirms the browser pane is durable.
3. **Fail-closed packaging acceptance:** `scripts/distribution/accept.py` requires every critical check to report `PASS`. The previous Windows compatibility path that could report `BLOCKED` while returning process success is no longer considered passing.
4. **Original PR #40 stress restored:** The source workflow adds three independent Ubuntu Chromium stress jobs, each running the real native browser suite ten times. This is PR-only, `contents: read`, `persist-credentials: false`, with failure logs as limited-retention artifacts. No old root runtime is published or mutated.
5. **Native documentation corrected:** The migrated native distribution contract now reflects the platform-specific Bun versions, actual four-runner installed acceptance, persistent state, unsigned status, and the new server-owned CDP stream probe.

## Independent verification

The exact Phase B source fingerprint and pending evidence are in `migrate/manifest.json > sourceSnapshots.rscode.phaseB`.

Reproducible commands from `migrate/rscode`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test src
bun run build:web
# Requires installed Chromium and Linux host dependencies:
bun test src/tests/browserService.test.ts
# Native packaging and installed acceptance on each real OS:
bun scripts/distribution/build.ts
python3 scripts/distribution/archive.py
python3 scripts/distribution/accept.py
```

GitHub workflows:

- [Migration source verification](../../.github/workflows/migration-source-verification.yml): source tests, 30 browser stress suites, root history and source integrity.
- [Migrated RSCode native acceptance](../../.github/workflows/migration-native-distribution.yml): four host architectures and extracted bundle acceptance, including installed server stream, shutdown and restart.

**Important:** Passing the previous pre-Phase-B head is **not** acceptance of the above changes. Mark Phase B verified only when all source, stress and four-platform native jobs succeed at a single exact HEAD. If Chromium stress fails, keep it red and report the observed failure; do not silently reduce repetitions, change timeouts to suppress failures, or remove the test.

## Remaining separate blockers

- Native Windows/macOS binaries are unsigned; macOS notarization, independent binary reproducibility, redistribution rights/SPDX and release provenance remain open.
- The actual production `main` runtime is still the earlier source: this phase only establishes a reconciled, verified candidate under `migrate/rscode`.
- Browser compositor/dialog behavior outside the tested native environment is not independently established by one passing CI run; repeated stress and future telemetry remain relevant.
- GHCode and Canvas persistence/identity and the unified Wrkbench shell are separate integration gates C/D and are not activated here.

**Policy:** preserve the original history and safety tests, keep PR #39 draft, and do not publish source-only artifacts.
