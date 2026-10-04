# Pull-request CI readiness

Each validation workflow emits one direct terminal context on every PR and merge group:
`CI ready (Checks)`, `CI ready (Commitlint)`, `CI ready (SAST)`, `CI ready (Security)`,
`CI ready (CLI)`, `CI ready (E2E)`, and `CI ready (Build)`. The terminal job always runs
after its native dependencies, including failed or skipped dependencies. It reads only that
workflow's `needs` results, not another workflow's API or a previously stored green verdict.
Its summary records source, run and attempt. The source graph guard requires every actual
job to be classified and preserves all current matrix legs.

An applicable blocking job must succeed. Missing, cancelled, failed, unknown and unexpected
skipped results hold readiness. Drafts are held; `ready_for_review` runs the applicable
checks again at the same head. Candidate source/receipt jobs and CLI manual publication are
explicitly inapplicable on ordinary PRs. Release-candidate receipts keep their separate
required graph: the new ordinary-only contexts are permitted there only as completed skips.

`.github/ci-scope.yml` owns the previous PR path policy for Build, E2E, CLI and Security,
plus Checks' existing backend integration scope. Scope jobs validate exact boolean outputs
and compare the frozen event's base/head/file count with PR metadata before and after
discovery. Source movement, a changed count, or 3000 or more changed files requires complete
coverage. API failure, malformed metadata, missing output, duplicate paths or incomplete
discovery fails. The pinned filter expands renames into added/deleted paths: any mixed
added/deleted set conservatively requires full coverage, so expanded path counts never
certify API-row completeness. Unambiguous discovery requires an exact unique path count.
Shared gate/scope changes also require complete coverage.
Push, schedule, manual and candidate admission remains separate; merge groups run full
validation, and Commitlint checks the actual group base-to-head range.

Build's detailed service outputs still decide which containers and Storybook are owed;
outer workflow applicability alone is not a service matrix. PR service decisions come from
the same validated discovery; queued Build jobs never query the mutable PR files again.
Existing fork PRs use local
smoke/image validation without new write privileges. Image vulnerability scans retain their
existing **advisory** policy: their native aggregate is recorded as advisory, never proof
that every scanner passed or found no vulnerabilities. Security's Bun audit/Trivy gates and
SAST's Opengrep remain blocking. Recovered Playwright retries still need their diagnostic
artifact review as described in the repo contract.

Scope and verdict actions use the repository-pinned `actions/github-script` Node 24 runtime
and a dependency-free evaluator; they do not install the monorepo or start another CI graph.

## Activation and observation

Source alone does not activate branch protection. Before requiring these contexts, observe
their exact live names and GitHub Actions application identity (15368), positive and negative
PR/merge-group cases, and failed/latest rerun behavior. Bind the seven contexts to that app;
generic candidate or skipped execution jobs cannot substitute for them. Keep the coordinator's
exact-head checks and independent review until enforcement is active and observed. Independent
review remains a separate obligation; a CI readiness result does not certify it.

The complete [release-candidate gate](RELEASING.md) remains required before tagging a release.
