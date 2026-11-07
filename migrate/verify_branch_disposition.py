#!/usr/bin/env python3
"""Fail-closed provenance, disposition coverage and exact-delta verifier (stdlib only).

No GitHub network, credentials, checkout mutation, publication or runtime writes.
This checks semantic *accountability*, not that unaccepted behavior is correct.
"""
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "migrate/manifest.json"
LEDGER = ROOT / "migrate/branch-disposition.json"
RELATIONS = {"SELECTED_BASE", "ANCESTOR", "DIVERGED", "TIP_DESCENDANT"}
GATES = {"NONE", "B_RSCODE", "C_GHCODE", "D_CANVAS", "E_PUBLICATION_SECURITY"}


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, text=True, capture_output=True, check=False
    )
    if check and result.returncode != 0:
        raise ValueError(f"git {' '.join(args)}: {result.stderr[:300]}")
    return result.stdout.strip() if result.returncode == 0 else ""


def ancestor(older: str, newer: str) -> bool:
    return subprocess.run(
        ["git", "merge-base", "--is-ancestor", older, newer],
        cwd=ROOT, capture_output=True, check=False
    ).returncode == 0


def main() -> int:
    errors: list[str] = []

    def require(ok: bool, message: str) -> None:
        if not ok:
            errors.append(message)

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    doc = json.loads(LEDGER.read_text(encoding="utf-8"))
    records = doc["entries"]
    require(doc["schemaVersion"] == 1, "schema version mismatch")
    require(doc["auditedHeadSHA"] and ancestor(doc["auditedHeadSHA"], "HEAD"),
            "audited source checkpoint not an ancestor")
    expected_counts = {"ghcode": 30, "canvas": 47, "rscode": 6}
    require(Counter(e["source"] for e in records) == expected_counts,
            "source record counts differ from registered 30/47/6")
    require(len(records) == 83, "expected exactly 77 historical + 6 RSCode records")

    original = {}
    for source in ("ghcode", "canvas"):
        for item in manifest["sourceHistory"][source]["refs"]:
            original[(source, item["ref"])] = item["commit"]

    registered = {(e["source"], e["ref"]): e["commit"]
                  for e in records if e["source"] != "rscode"}
    require(len(registered) == 77 and registered == original,
            "historical ref/SHA entries do not exactly match sourceHistory")
    unique_tips = {s + ":" + sha for (s, _), sha in original.items()}
    require(len(unique_tips) == 68, "historical unique tip count must be 68")
    require({s: manifest["sourceSnapshots"][s]["snapshotTreeSHA"]
             for s in ("ghcode", "canvas", "rscode")} == doc["sourceTrees"],
            "pinned source tree mismatch with migration manifest")

    expected_base = {
        "ghcode": manifest["sourceSnapshots"]["ghcode"]["originalSHA"],
        "canvas": "bf17d45c8068a3bda8de5d4786a829bb4c511a86",
        "rscode": manifest["rootBaseline"]["commit"],
    }
    require(doc["comparisonBases"] == expected_base, "selected source base mismatch")
    for source in ("ghcode", "canvas", "rscode"):
        require(git("rev-parse", f"HEAD:migrate/{source}") == doc["sourceTrees"][source],
                f"{source} migrated snapshot changed since Phase A review")

    seen = set()
    for row in records:
        ident = (row["source"], row["ref"])
        require(ident not in seen, f"duplicate source/ref: {ident}")
        seen.add(ident)
        source = row["source"]
        sha = row["commit"]
        base = expected_base[source]
        require(row["comparisonBaseSHA"] == base, f"{ident}: incorrect comparison base")
        require(row["relation"] in RELATIONS, f"{ident}: invalid relation")
        require(row["nextGate"] in GATES, f"{ident}: undefined acceptance gate")
        require(bool(row["disposition"]) and bool(row["acceptance"]) and
                bool(row["implementationPaths"]), f"{ident}: unclassified source behavior")
        require(len(sha) == 40 and bool(git("cat-file", "-t", sha)),
                f"{ident}: source tip Git object absent")
        require(ancestor(sha, "HEAD"), f"{ident}: tip not preserved in Git history")

        if sha == base:
            actual = "SELECTED_BASE"
            expected_commits = 0
            merge_base = base
        elif ancestor(sha, base):
            actual = "ANCESTOR"
            expected_commits = 0
            merge_base = sha
        elif ancestor(base, sha):
            actual = "TIP_DESCENDANT"
            expected_commits = int(git("rev-list", "--count", f"{base}..{sha}"))
            merge_base = base
        else:
            actual = "DIVERGED"
            merge_base = git("merge-base", base, sha)
            expected_commits = int(git("rev-list", "--count", f"{base}..{sha}"))
        require(row["relation"] == actual, f"{ident}: ancestry incorrectly classified")
        require(row["branchOnlyCommitCount"] == expected_commits,
                f"{ident}: wrong unique branch commit count ({expected_commits})")

        expected_paths = git("diff", "--name-only", merge_base, sha).splitlines()
        actual_paths = row.get("branchOnlyChangedPaths", [])
        require(sorted(actual_paths) == sorted(expected_paths),
                f"{ident}: changed path set disagrees with source Git delta")

        for p in row["implementationPaths"]:
            require((ROOT / p).exists(), f"{ident}: implementation/evidence target missing: {p}")

        aliases = sorted(e["ref"] for e in records if e["source"] == source
                         and e["commit"] == sha and e["ref"] != row["ref"])
        require(sorted(row.get("tipAliases", [])) == aliases,
                f"{ident}: tip aliases are inaccurate")
        if row["disposition"] == "REJECTED_UNSAFE_IMPLEMENTATION":
            require(source == "ghcode" and row["nextGate"] == "C_GHCODE",
                    f"{ident}: unsafe implementation mislabeled as accepted")
        if row["disposition"] == "C01_PERSISTENCE_INCLUDED_NOT_ACTIVE":
            require(source == "canvas" and row["nextGate"] == "D_CANVAS",
                    f"{ident}: inactive persistence requires explicit Canvas gate")

    print(json.dumps({
        "result": "PASS" if not errors else "FAIL",
        "coverage": {"originalRefs": len(original), "uniqueOriginalTips": len(unique_tips),
                     "rscodeRefs": expected_counts["rscode"]},
        "auditedCheckpoint": doc["auditedHeadSHA"],
        "testedHead": git("rev-parse", "HEAD"),
        "note": "Branch classification and Git deltas only; behavioral acceptance remains separate.",
        "errors": errors[:50],
    }, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
