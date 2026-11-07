# Phase A — Exact historical branch disposition and semantic handoff

**Audit checkpoint:** `93b29a669b2bc336d957af3c682b3ad92c8667b6` on `integration/tri-source-migration-baseline`.
**Authoritative machine register:** [`migrate/branch-disposition.json`](../../migrate/branch-disposition.json).
**Verification command:** `python3 migrate/verify_branch_disposition.py` (full Git history required).

## Decision

**Phase A inventory and divergence classification is complete; semantic integration and final acceptance are not.**
The register covers **all 77 original source refs** (30 GHCode, 47 Canvas/template), their **68 distinct commit tips**, and **six** RSCode source/PR/integration heads.
All refs are preserved in the integration history. The register distinguishes source ancestry, current code disposition, and executable acceptance. Ancestry must not be recorded as functional integration.

## How disposition is determined

Each original tip was compared to its selected source base using the connected GitHub compare API. The comparison base is GHCode `development@7801784b`, Canvas `C01@bf17d45c`, and RSCode `main@39341ce5`.
An **ANCESTOR** is included in the chosen source's commit ancestry, but may have been altered or removed later. A **DIVERGED** tip has unique branch commits and an independent merge-base-to-tip file delta; a **TIP_DESCENDANT** is ahead of the selected source base. **SELECTED_BASE** is exact.
Unique changed-file paths are stored per ref in the JSON and checked against the local Git DAG by the verifier. Duplicate PR/branch/tag aliases are retained as separate named refs but share the same commit evidence.
Source tests verify the chosen source tree, not historical branch equivalence. `migrate/verify.py` checks Git ancestry and unchanged root runtime independently.

## High-priority branch outcomes

| Source candidate | Code disposition | Remaining behavior / acceptance gate |
|---|---|---|
| RSCode PR #23 | RSC-01 superseded by RSC-03 security implementation | Confirm full security matrix and native Chromium stability (B) |
| RSCode PR #25 | Privileged runtime fixes adapted under `migrate/rscode` | Final source-vs-PR security test crosswalk (B) |
| RSCode PR #28 | Native distribution adapted and tested on four real OS runners | Signed/reproducible distribution and release acceptance separate (B/E) |
| RSCode PR #40 | Bounded SIGSEGV retry and tests ported to migrated code | Original native stress workflow is not active on source; test real crashes/dialogs (B) |
| GHCode PR #30 | GHC-00 historical fixtures copied with matching blobs under `evidence/` | Convert invariant assertions into active future-version acceptance; preserve historical red reproduction (C) |
| GHCode PR #33 | GHC-01 identity isolation inherited and further hardened | Principal lifecycle, A/B/anonymous adversarial browser coverage (C) |
| GHCode PR #34 | Unsafe GHC-02 storage-v3 implementation deliberately **not activated** | Reconcile every behavior contract against current safe W05 v5 IDB storage; no blind cherry-pick (C) |
| Canvas PR #39 | React source-first Canvas inherited and subsequently adapted | Verify selected live-repository provider, document/graph behavior (D) |
| Canvas PR #41 | Transactional C01 persistence files and isolated tests exist | **Adapter is not bound as authoritative writer**; implement or supersede with proven equivalence (D) |
| Canvas PR #42 | Template release-security work kept upstream in retained `DarkFactory-template` | Verify replacement target workflow isolation; don't copy duplicate deploy pipeline (E) |
| Early Canvas PR #36 / stateless branch | Old generated Python `canvas.html` renderer intentionally retired by accepted ADR | Confirm read/list/put capabilities either superseded or deliberately retired with safe host adapter (D) |

### Explicit unique source-tip deltas

These are exact file changes between merge base and the divergent/tip-descendant candidate, **not** files that should automatically be copied. See JSON for the full path arrays.

| Tip aliases (short form) | Unique commits | Delta files | Disposition |
|---|---:|---:|---|
| `refs/remotes/ghcode-pr/20` | 1 | 3 | RETIRED_SOURCE_GOVERNANCE |
| `refs/remotes/ghcode-pr/3` | 3 | 2 | RETIRED_SOURCE_GOVERNANCE |
| `refs/remotes/ghcode/agent/ghc-00-baseline` | 17 | 10 | HISTORICAL_TESTS_COPIED_INERT |
| `refs/remotes/ghcode/agent/ghc-02-transactional-v3` | 43 | 8 | REJECTED_UNSAFE_IMPLEMENTATION |
| `refs/remotes/ghcode-pr/5` | 2 | 2 | RETIRED_SOURCE_GOVERNANCE |
| `refs/remotes/ghcode-pr/7` | 2 | 2 | RETIRED_SOURCE_GOVERNANCE |
| `refs/remotes/ghcode-pr/9` | 1 | 4 | RETIRED_SOURCE_GOVERNANCE |
| `refs/tags/ghcode/v0.1.8` | 2 | 0 | HISTORICAL_RELEASE_SNAPSHOT |
| `refs/remotes/template/df-main/v0.292.4` | 2 | 3 | UPSTREAM_TEMPLATE_MANAGED_CONFIG |
| `refs/remotes/template-pr/36` | 6 | 19 | RETIRED_PYTHON_CANVAS_PROTOTYPE |
| `refs/remotes/template/agent/canvas-release-security-foundation` | 5 | 4 | UPSTREAM_TEMPLATE_RELEASE_SECURITY |
| `refs/remotes/template/development` | 1 | 0 | UPSTREAM_TEMPLATE_RELEASE_SECURITY |
| `refs/remotes/template/feat/stateless-repository-canvas` | 3 | 19 | RETIRED_PYTHON_CANVAS_PROTOTYPE |

**GHCode governance branches:** PR #3/#5/#7/#9/#20 only add or change the deleted source repository's managed workflows, installation receipts, and `repo.dfconfig`. These must not create a second active release/agent route. Historical GHCode main has two unique commits but zero net file changes against its merge base.

**GHCode GHC-00:** 17 branch-only commits, ten paths, with executable acceptance/historical fixtures preserved. Their presence as inert evidence is not the same as exercising them in current CI.

**GHCode GHC-02:** 43 branch-only commits, eight affected paths, including `storage-v3.ts` and new persistence tests. The old implementation remains rejected. Contract recovery is a functional C gate, not a missing cherry-pick.

**Canvas early prototype:** PR #36 has six branch-only commits affecting 19 paths; the stateless branch has three branch-only commits affecting 19 paths. Both include the retired Python renderer, tool commands and hooks. The newer React architecture supersedes the renderer; read/write tool parity remains an explicit D gate.

**Canvas release security:** PR #42 has five branch-only commits covering four workflow/security files. Its single-commit development merge has zero net file delta against its merge base. That does not justify reactivating template Pages publishing in Wrkbench.

## Acceptance gates and dependencies

**B — RSCode:** Produce per-PR security/native/runtime behavior and stress proof at one exact source SHA. Source CI and four-platform installed acceptance have previously passed, but they do not establish root Chromium intermittent-stress closure.

**C — GHCode:** Establish active GHC-00 behavioral parity, safe v2→v5 storage/localStorage migration, principal-bound import/export/drafts, complete Dockview lifecycle, and remote push uncertainty acceptance. Excluded GHC-02 stays excluded.

**D — Canvas:** Make the C01 persistence contract authoritative or supersede it with test-backed canonical persistence, disable old parallel writers, verify selected repository context and Python-tool replacement/retirement.

**E — publishing/governance:** Keep target source CI PR-only/read-only. Audit GitHub Pages, external auth, native signing and GPL/asset obligations separately; retaining source DAG does not confer rights or safe publication.

**No branch deletion, no release, no source-only main merge, no activation of rejected code.** PR #39 remains draft.

## Complete named-ref register

The JSON file is authoritative for complete SHA values, alias sets, changed paths, implementation paths and gates.

| Historical ref | SHA | Relation | Branch-only commits | Implementation disposition | Next gate |
|---|---|---|---:|---|---|
| `refs/remotes/ghcode-pr/11` | `67b63b4883e2` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/13` | `e3974895863f` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/15` | `22336690c442` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/16` | `109097091073` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/20` | `48f5cf5e5286` | DIVERGED | 1 | RETIRED_SOURCE_GOVERNANCE | E_PUBLICATION_SECURITY |
| `refs/remotes/ghcode-pr/21` | `8b182b9ea04f` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/23` | `10ece37242ef` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/29` | `a7d5deec2bac` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode-pr/3` | `e45e9dd9c172` | DIVERGED | 3 | RETIRED_SOURCE_GOVERNANCE | E_PUBLICATION_SECURITY |
| `refs/remotes/ghcode-pr/30` | `7b82a9f8ed19` | DIVERGED | 17 | HISTORICAL_TESTS_COPIED_INERT | C_GHCODE |
| `refs/remotes/ghcode-pr/33` | `6d87f1c00607` | ANCESTOR | 0 | GHC01_IDENTITY_INHERITED | C_GHCODE |
| `refs/remotes/ghcode-pr/34` | `49d194f75ecc` | TIP_DESCENDANT | 43 | REJECTED_UNSAFE_IMPLEMENTATION | C_GHCODE |
| `refs/remotes/ghcode-pr/5` | `9253f60f0721` | DIVERGED | 2 | RETIRED_SOURCE_GOVERNANCE | E_PUBLICATION_SECURITY |
| `refs/remotes/ghcode-pr/7` | `86493007d94e` | DIVERGED | 2 | RETIRED_SOURCE_GOVERNANCE | E_PUBLICATION_SECURITY |
| `refs/remotes/ghcode-pr/9` | `7be2aaa81e91` | DIVERGED | 1 | RETIRED_SOURCE_GOVERNANCE | E_PUBLICATION_SECURITY |
| `refs/remotes/ghcode/agent/ghc-00-baseline` | `7b82a9f8ed19` | DIVERGED | 17 | HISTORICAL_TESTS_COPIED_INERT | C_GHCODE |
| `refs/remotes/ghcode/agent/ghc-01-identity-isolation` | `6d87f1c00607` | ANCESTOR | 0 | GHC01_IDENTITY_INHERITED | C_GHCODE |
| `refs/remotes/ghcode/agent/ghc-02-transactional-v3` | `49d194f75ecc` | TIP_DESCENDANT | 43 | REJECTED_UNSAFE_IMPLEMENTATION | C_GHCODE |
| `refs/remotes/ghcode/development` | `7801784b5bb5` | SELECTED_BASE | 0 | SELECTED_SOURCE_BASE | C_GHCODE |
| `refs/remotes/ghcode/fix/ghc-09a-safe-branch-cleanup` | `a7d5deec2bac` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | C_GHCODE |
| `refs/remotes/ghcode/main` | `534e2203425d` | DIVERGED | 2 | HISTORICAL_PRODUCTION_SNAPSHOT | C_GHCODE |
| `refs/tags/ghcode/v0.1.0` | `7587582fc216` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.1` | `f03ab58c014a` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.2` | `ebfde874e1f8` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.3` | `95703439660c` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.4` | `e5d92b256c3b` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.5` | `c50d52a3ba6c` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.6` | `195458b67c8f` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.7` | `12db8b781e28` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/ghcode/v0.1.8` | `534e2203425d` | DIVERGED | 2 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/remotes/template-pr/1` | `3d77d6e21fe6` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/10` | `cdc2dde81b56` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/11` | `02fee2308191` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/12` | `34637e566e36` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/14` | `2b592ca54173` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/15` | `7cf31ffd5944` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/18` | `08a391ef6925` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/19` | `2041c43d1c64` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/2` | `b13d41376fa2` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/21` | `c5e0e73ec175` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/22` | `b45d4268fa65` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/24` | `b3d23455448d` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/25` | `c006e4b723d5` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/27` | `4541cc881910` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/28` | `8387ca983d06` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/3` | `e99ec504da00` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/30` | `925d1b998cff` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/32` | `7b13e4e158df` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/34` | `d45ece1be1fa` | DIVERGED | 2 | UPSTREAM_TEMPLATE_MANAGED_CONFIG | E_PUBLICATION_SECURITY |
| `refs/remotes/template-pr/36` | `2700f23cdbfc` | DIVERGED | 6 | RETIRED_PYTHON_CANVAS_PROTOTYPE | D_CANVAS |
| `refs/remotes/template-pr/37` | `0009efb3b201` | ANCESTOR | 0 | REACT_CANVAS_SOURCE_PREDECESSOR | D_CANVAS |
| `refs/remotes/template-pr/39` | `defe601e39d7` | ANCESTOR | 0 | REACT_CANVAS_SOURCE_INHERITED | D_CANVAS |
| `refs/remotes/template-pr/41` | `bf17d45c8068` | SELECTED_BASE | 0 | C01_PERSISTENCE_INCLUDED_NOT_ACTIVE | D_CANVAS |
| `refs/remotes/template-pr/42` | `5f462ea6e73c` | DIVERGED | 5 | UPSTREAM_TEMPLATE_RELEASE_SECURITY | E_PUBLICATION_SECURITY |
| `refs/remotes/template-pr/5` | `d1b46dc0e040` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/6` | `34c7218ac216` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/7` | `879078735c40` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/8` | `3e40e20271bb` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template-pr/9` | `493aabd1c5b4` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/remotes/template/agent/canvas-c01-idb-foundation` | `bf17d45c8068` | SELECTED_BASE | 0 | C01_PERSISTENCE_INCLUDED_NOT_ACTIVE | D_CANVAS |
| `refs/remotes/template/agent/canvas-release-security-foundation` | `5f462ea6e73c` | DIVERGED | 5 | UPSTREAM_TEMPLATE_RELEASE_SECURITY | E_PUBLICATION_SECURITY |
| `refs/remotes/template/development` | `f647f7adc984` | DIVERGED | 1 | UPSTREAM_TEMPLATE_RELEASE_SECURITY | E_PUBLICATION_SECURITY |
| `refs/remotes/template/df-main/v0.292.4` | `d45ece1be1fa` | DIVERGED | 2 | UPSTREAM_TEMPLATE_MANAGED_CONFIG | E_PUBLICATION_SECURITY |
| `refs/remotes/template/feat/stateless-repository-canvas` | `8158f7035064` | DIVERGED | 3 | RETIRED_PYTHON_CANVAS_PROTOTYPE | D_CANVAS |
| `refs/remotes/template/main` | `63a6e0e0c044` | ANCESTOR | 0 | INHERITED_SOURCE_LINEAGE_NOT_FINAL_BEHAVIOR_ACCEPTANCE | D_CANVAS |
| `refs/tags/template/v0.1.1` | `9b3336e2054f` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.10` | `ebc1fc23bc26` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.11` | `9b86206cfc9e` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.12` | `f8267de05ea9` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.13` | `a4445374f2f7` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.14` | `83d7eca30a8e` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.15` | `040ebe548b2d` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.16` | `63a6e0e0c044` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.3` | `4c4a9387c0ec` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.5` | `5fc9b1663582` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.7` | `10702bd4519f` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `refs/tags/template/v0.1.9` | `6ba71f0fec3f` | ANCESTOR | 0 | HISTORICAL_RELEASE_SNAPSHOT | NONE |
| `rscode/main` | `39341ce5f845` | SELECTED_BASE | 0 | ORIGINAL_RUNTIME_BASE_RECONCILED | B_RSCODE |
| `rscode/PR#23/RSC-01` | `ff102b484d56` | TIP_DESCENDANT | 20 | RSC01_SECURITY_SUPERSEDED_BY_RSC03 | B_RSCODE |
| `rscode/PR#25/RSC-03` | `65331558418c` | TIP_DESCENDANT | 27 | RSC03_SECURITY_ADAPTED | B_RSCODE |
| `rscode/RSC-04/integration` | `2d26ffd8f0bd` | TIP_DESCENDANT | 799 | RSC04_CHROMIUM_SINGLE_FLIGHT_ADAPTED | B_RSCODE |
| `rscode/PR#28/RSC-05` | `6ed334bcad6e` | TIP_DESCENDANT | 18 | RSC05_NATIVE_DISTRIBUTION_ADAPTED | B_RSCODE |
| `rscode/PR#40/RSC-ROOT` | `e278e964e765` | TIP_DESCENDANT | 10 | RSC_ROOT_SIGSEGV_RETRY_ADAPTED_STRESS_PENDING | B_RSCODE |

## Evidence references

- `migrate/manifest.json` — original 77 refs, SHA mapping and selected subtree hashes.
- `migrate/verify.py` — original ancestry, source-tree identity and root isolation.
- `docs/migrations/BRANCH_CONVERGENCE_W01.md` — historical source-selection decisions.
- `docs/migrations/TRI_SOURCE_CAPABILITY_CROSSWALK.md` — 36 capabilities and target owners.
- `docs/migrations/W04_PROGRESS.md` and `W05_SEMANTIC_RECONCILIATION.md` — implementation and separate acceptance constraints.
- Historical exact-source head `93b29a66`: migration CI run 42405217961 and root Verify 42405217977 passed. These do not certify this new Phase A ledger until its own verification succeeds.

**Explicit non-claims:** No fresh browser acceptance was run by this evidence-only phase; a source branch's ancestry or identical blob is not proof that its runtime behavior is active or safe.
