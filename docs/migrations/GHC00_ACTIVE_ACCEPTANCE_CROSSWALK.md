# GHC-00 historical integrity reproductions → active GHCode acceptance

**Canonical source:** `migrate/ghcode`; full original GHCode commit DAG preserved in PR #39. This crosswalk maps the previously failing v0.1.8 reproduction tests to **present behavior assertions** rather than treating copied red tests as passing production checks.

Original exact source fixtures remain in `migrate/ghcode/evidence/ghc00-historical-tests`, including `ghc00-v018-reproduction.spec.ts`, `ghc00-integrity.spec.ts`, `ghc00-migration.spec.ts` and their fixtures. Their old version-specific failure expectations must not be executed as a green acceptance suite.

| Historical defect / required behavior | Active source acceptance | Intended invariant |
|---|---|---|
| Private cached workspace visible after A signs out | `.github/tests/identity-isolation.spec.ts`: anonymous cannot mount or reopen A's private workspace; delayed blob response cannot repopulate UI | Cross-principal private bytes not visible |
| B inherits A private cache with denied 404 / same login | `identity-isolation.spec.ts`: immutable numeric user ID, denied B, A→B→A transition | Repository name or mutable login cannot authorize private data |
| Close editor inside 250ms debounce loses text | `.github/tests/workbench.spec.ts`: Monaco failed save guards close button, middle click, native Close Group | Unacknowledged live bytes must block destructive close |
| IDB request success then aborted transaction falsely acknowledges save | `.github/unit/storage-unit.test.ts`: commit acknowledgment requires transaction complete; `.github/tests/push-journal.spec.ts`: real quota abort | Acknowledged only after durable IDB commit |
| Aborted local commit consumes staged data / phantom commit | `storage-unit.test.ts`: atomic staged consume/commit, competing stage CAS; `push-journal.spec.ts`: real concurrent staged commits | All stores commit together or none |
| Reload before debounced save loses document | `.github/unit/document-service.test.ts`: checkpoint recovery, quota failure, principal epoch; `push-journal.spec.ts`: real IDB draft reload and forged account/ref rejection | Persisted draft recovers with review, never exposes foreign bytes or auto-pushes |
| Repository switch loses pending private edit | **New:** `workbench.spec.ts`: pending private write blocks repository switch; after Retry save, public repository opens and original owned overlay remains intact | Fail closed before repository context changes |
| Storage quota failure silently reported as saved | `workbench.spec.ts`: visible quota failure and retry; `push-journal.spec.ts`: quota-aborted overlay transaction | No silent save acknowledgment |
| Move editor between Dockview surfaces loses pending content | **New:** `workbench.spec.ts`: real dirty README tab drag main→panel→main with failed overlay put, notice and live content retained, Retry save and IDB reload | Resource model and acknowledged content survive transport |
| v2 legacy cache silently assigned to current login | `identity-isolation.spec.ts`: old private records/layout/recents not rendered; user-invoked opt-in quarantine; `push-journal.spec.ts`: real v5 lossless raw backups | Never infer historical ownership; retain original data |

## Additional durability checks beyond original GHC-00

Phase C1 protects the Git remote publication boundary: immutable commit IDs, exact ordered ancestry, CAS push preparation/finalization, confirmed-ref retry, no local-commit deletion or destructive cleanup while any push journal remains unresolved. These are asserted by `storage-unit.test.ts`, `push-journal.spec.ts` (real Chromium/IDB) and the mock-backed full `workbench.spec.ts` push-acknowledgment failure scenario. See `PHASE_C_GHCODE_PUSH_INTEGRITY.md`.

## Acceptance policy

This document is a **test-to-invariant disposition**; it is not a blanket guarantee of proof. The two new GHC-00 UI regressions, the new C1 browser tests, the unit suite, the existing user/identity and GitHub mock tests must all pass at one exact `migrate/ghcode` tree fingerprint in `migrate/manifest.json`.

Unattributed legacy v2 records are intentionally not automatically migrated to a current account; verifiable historical ownership is a prerequisite for actual attribution. Last keystrokes whose draft IDB transaction never committed cannot be reconstructed after a process crash; the UI must warn and retain them in memory until recovery/close. Full production integration remains blocked until a single unified storage and document authority replaces the inert source trees.

No automatic release, new independent GHCode repository, source-tree deletion, or modification of the separate React 19 Pages branch is authorized.
