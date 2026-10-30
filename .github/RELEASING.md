# Releasing Tale

A release ships one commit: a **release candidate**, the full 40-character SHA of a commit on
`main`. You choose it once and keep it through every step. `main` keeps moving while you validate,
and no merge can change or cancel what you validate. A version tag is pushed only at a candidate
whose validation and gate have passed.

**Two lines.** Since 2026-10-30 `main` is the stable line (0.5.x, 0.5.95 next) and `release/0.6`
the feature line (0.6.x, 0.6.0 next): `main` plus the feature work, kept rebased onto `main`
([the repo contract](../.agents/repo.md)). Everything below releases the stable line from
`main`, as before. The feature line is not released yet: the candidate gate, `release.yml`
(which points `latest` at every release) and Ops's release adoption read one line and have to
learn the second first. When a person decides the feature line is stable, its release moves
`latest` to 0.6.x, `main` takes the feature line's commits, 0.5.x is no longer maintained, and
`release/0.7` opens as the next feature line.

| Step | What you do | What decides |
| --- | --- | --- |
| 1. Choose | Record the candidate SHA and the version. | You, explicitly. |
| 2. Validate | Send one `release-candidate` repository dispatch for the SHA. | The seven existing workflows and their candidate receipts. |
| 3. Gate | Run the release gate script. | Its state: only `eligible` proceeds. |
| 4. Tag | Push `vX.Y.Z` at the SHA. | `release.yml`, as for every release. |
| 5. Verify | Check the Release run, the GitHub release and the images. | Their recorded revision. |

## Write the user-facing release notes

Before choosing the candidate, merge a reviewed `.github/release-notes/vX.Y.Z.md` for the intended
version. Lead with **Highlights** describing verified user outcomes, followed by **Upgrade notes**
with operator actions and compatibility constraints. The [authoring guide](release-notes/README.md)
has the structure. Generated API contract notes and the PR list follow these sections.

Run `bun tools/cli/scripts/release-notes.ts --version vX.Y.Z` on the checkout you intend to select.
Only select a candidate containing that reviewed file. The existing candidate gate checks CI
and source identity; it does not check the prose. Release Prepare runs the same validator before
any image builds. It rejects a missing file, a missing, repeated or misordered section, and a
section that contains TODO or TBD or nothing but comments and `*`, `_` or `-` markers. It cannot
recognise leftover template prose or a wrong claim; the review must. Content-only `sites_only`
builds are exempt.

## 1. Choose the candidate

Choose a merged, reviewed commit on `main`, with the version it becomes. Candidates move
forward only. The version must be newer than the latest release, and the commit must contain
that release plus a later commit. Do not publish a new version at the latest release's existing
source SHA: Ops identifies the deployment by source, so it would see no new deployment to apply.
`release.yml` points `latest` at every release, so an older commit would move it backwards.
The gate enforces both version and source progression against the latest published release.
That comparison uses GitHub's `releases/latest` and its tag; the release lease below covers a
version still in flight.

Never take "whatever `main` is now" as the candidate. Record the SHA before you start, and name
it in everything you post about the release.

## 2. Validate the candidate

Send one repository dispatch with the recorded SHA. The existing release credential needs
Contents-write permission; this does not require Actions-write or a new credential:

```bash
gh api repos/tale-project/tale/dispatches -f event_type=release-candidate \
  -f 'client_payload[candidate_sha]=<sha>'
```

That event starts **Build, Checks, SAST, Commitlint, E2E, CLI and Security**, each titled
`Release candidate <sha>`. It reuses their existing jobs, including all four E2E platform shards, all four UI shards and all five
CLI build targets. Candidate validation never attaches CLI binaries to a release. Normal
pull request, push, nightly and manual events keep their existing behavior.
They skip the standalone candidate-source resolver and retain their event's checkout
commit (including pull-request merge commits); manual CLI publication
still resolves its requested release tag. Downstream jobs explicitly admit that intentional
skip while retaining their dependency, cancellation and scope checks.

Follow the runs in Actions or list one workflow at a time:

```bash
gh run list --repo tale-project/tale --workflow e2e.yml --branch main \
  --json databaseId,displayTitle,status,conclusion \
  --jq '.[] | select(.displayTitle == "Release candidate <sha>")'
gh run watch <run id> --repo tale-project/tale
```

The Build **Run workflow** action remains available for an individual Build validation; it
does not start the other six workflows. Use the repository event for a complete candidate round.

Candidate service scopes always select the complete graph. The stable UI aggregate and all four
UI shard names, the E2E scope, and every E2E leg are required receipt evidence. Candidates skip
unused informational SARIF generation; their blocking Opengrep and vulnerability gates still
execute. The scheduling and cache contracts are in [CI.md](CI.md).

Each workflow has a separate `<workflow>-candidate-<sha>` concurrency group with cancellation
disabled. Main merges cannot cancel these runs. The shared **Candidate source / Resolve source**
job refuses a shortened, malformed or off-main SHA before any test job. Each existing checkout
then uses that exact candidate **C**, including Commitlint's commit message. The trusted workflow
comes from default-branch commit **H**, which may differ from C. Both full commits must still be
on `main` when the release gate reads them; later merges do not invalidate an older H.

Build forces the complete image and container-test graph regardless of path filters. It builds
eight `candidate-sha-<sha>` images, records each pushed digest, and tests those digests after
checking their revision labels. It also runs the web, docs and ui-docs container tests
and Storybook. Candidate images remain in GHCR. Build's advisory image Trivy job stays skipped;
SAST's Opengrep and Security's high/critical dependency and filesystem checks remain blocking.
Candidate scans do not upload SARIF attributed to H. Checks' **Integration scope** likewise owes
**Backend integration** (the real-Postgres suite against `tale-db` built from C) to every candidate,
whatever its last commit touched. The harness keeps its suite's HTTP on the runner: it answers the
lanes' vendor calls itself and refuses any other host, a redirect's next hop included, so no vendor
outage can fail a check. The job's setup still pulls from registries and mirrors (the images, the
ffmpeg install); re-run a setup step that fails on their outage. Never waive a failed check.

Each workflow's final **Candidate gate** records the results of every required dependency and
fails if any is missing, failed, skipped or cancelled. Build's gate is a normal job; the other
six call **Candidate gate / Record receipt**. The artifact name is
`release-candidate-<workflow-stem>-<sha>-attempt-<attempt>`. Its sole file,
`release-candidate.json`, records schema version 1, the workflow path, C, verdict, run id/URL/event,
attempt, H, main ref and the exact dependency job results. Build also records all eight image
identities and digests; the other receipts have an empty image list.

The upload requests 90 days of retention, but GitHub can expire the artifact sooner. Every receipt
of the candidate validated on 2026-09-30 (#3971) was set to expire 30 days after its run was
created, and within five hours of that its run no longer listed it. Go by the artifact's own
metadata, never by a count of days: `expires_at` is when GitHub expires it, and the gate refuses a
receipt whose `expired` flag is set or that its run no longer lists. When a validated candidate
has to wait for its tag, read when its receipts expire:

```bash
gh api --paginate repos/tale-project/tale/actions/runs/<run id>/artifacts \
  --jq '.artifacts[] | select(.name | startswith("release-candidate-")) | {name, expires_at, expired}'
```

No output for a run means it lists no receipt.

A matching title alone is insufficient. The release gate checks the workflow path, main branch,
full H and its ancestry, every expected current-attempt job (including matrix legs), the exact
artifact name and its contents. It binds the receipt to C/H/run/attempt and rereads the run after
verification to refuse evidence that changed during the read. Expired, historical, partial,
duplicate or unexpected evidence cannot approve a release.

## 3. Run the release gate

```bash
bun tools/cli/scripts/release-candidate-gate.ts --sha <sha> --version vX.Y.Z
```

Run this with Bun, authenticated `gh` and Python 3 available. Python's standard ZIP reader
validates receipts without extracting files into the checkout. The gate only reads GitHub. It
prints a JSON report and exits 0 only when the state is `eligible`.

| State | Meaning | Next |
| --- | --- | --- |
| `eligible` | Every check below passed. | Tag (step 4). |
| `pending` | A required run is still going. | Wait, then run the gate again. |
| `blocked` | Required evidence is missing, invalid, failed, skipped or cancelled. | Inspect the reason and dispatch the same candidate again when repaired. |
| `allocated` | A version tag already points at the candidate. This does not prove publication succeeded. | Do not tag. Reconcile the Release run for the report's `tagName` (step 5). |
| `conflict` | The version is taken or not newer, or the commit is not on `main` or does not advance beyond the latest release. | Choose a version or candidate explicitly. |

To be `eligible`, the candidate must pass all of these:

- **The version tag.** Neither `vX.Y.Z` nor `X.Y.Z` exists yet. Both tag spellings publish the
  same image version, so either reserves it even while its Release run is pending or failed.
  A tag is never moved or reused. If either spelling points at another commit, the state is
  `conflict`, even if the other already points at the candidate.
- **Its place on `main`.** The candidate is on `main`, contains and advances beyond the latest
  release's source, and the version is newer than that release. An existing version allocation
  still returns `allocated` for recovery; this rule does not ask you to replace its tag.
- **Its newest validation.** The newest `Release candidate <sha>` attempt was dispatched from `main`
  on or after its verified canonical PR merge, used the trusted Build workflow and succeeded, with every required job successful and a complete,
  unexpired current-attempt receipt. Earlier distinct candidate runs stay in the report; each entry describes
  that run's current attempt. Each run records its attempt number, creation and current attempt
  start times, dispatch branch and workflow source SHA in the report.
- **The other workflows.** Checks, SAST, Commitlint, E2E, CLI and Security must all have passed.
  Each workflow uses the newest attempt across its candidate receipts and normal exact-C runs.
  A later valid candidate success can recover an older cancelled push; a later failed normal
  run or rerun still blocks. Missing CLI or Security is blocked even if its normal path filter
  would skip the commit. Repository dispatches only count through their C-bound receipts;
  their GitHub `head_sha` describes H. CLI manual publication dispatches do not count as normal
  source evidence because their input tag can differ from the workflow source. The Build push
  run does not count: its path filters can skip required candidate checks.

"Newest" uses GitHub's `run_started_at`, not the run's original creation time or id. Re-running an
older run after a newer success makes that rerun the deciding evidence: its failure blocks, an
unfinished attempt waits, and a later success can recover. A first attempt without a start time
uses its creation time; a rerun missing its start time is refused because its order is unknown.

The gate reads every page of each workflow's candidate-event list and the candidate's
workflow-run list before selecting attempts. The event lists carry no branch filter: an attempt
from another branch is refused when it is the newest, never skipped. It verifies the reported
total, page lengths and unique run ids; missing pages, repeated records or a changing total answer
`blocked`, never an approval based on the partial list. Retry a read that changed. Each list has a
ten-page bound of 100 runs per page. Because GitHub caps these filtered searches at 1,000 results,
a total of 1,000 or more also answers `blocked`: completeness cannot be proved at that boundary.
Do not tag from that result; the release lane must obtain complete evidence through a reviewed
change to its query strategy.

A complete filtered list is still not proof on its own. On 2026-10-01 GitHub answered filtered
lists whose totals matched their pages, yet the newest runs were missing, or every run was
(#4055). The gate also walks the repository's unfiltered list and compares each eligible run.

- **The fixed cutoff is C's canonical PR merge into this repository's `main`.** Associated PRs
  supply discovery hints; direct PR reads must agree and prove one closed, merged PR whose final
  merge commit is exactly C. The target repository's numeric identity comes from the requested
  repository's metadata. Its non-null, valid, nonfuture `merged_at` fixes the cutoff. Deleted
  source branches and fork heads remain valid because the target identity is what matters.
  Missing, inaccessible, omitted, inconsistent or multiple matching records answer `blocked`.
  Discovery is bounded to ten pages of 100 PRs and must end before that bound is exhausted.
- **An original run counts when `created_at` is at or after that cutoff**, including timestamp
  ties. A run created before the merge stays excluded even if rerun later; candidate runs in
  this category appear under `excluded`. Among eligible originals, the newest current attempt
  still decides. Delayed push workflows and later pushes never move the cutoff. The report's
  `arrival` field names the verified PR, repository id and canonical merge time (`createdAt`).
- **The unfiltered walk goes a minute past the cutoff and past every listed original run**,
  including those excluded from validation. An eligible run omitted by either read, different
  attempts or completed outcomes, a repeated push of C, or an observed push before the canonical
  merge answers `blocked`. A run still going in either read is judged as still going.
  Out-of-order IDs, a creation time more than a minute later than the earliest one listed before
  it, changed repeated records, incomplete pages or failure to cross the boundary within 3,000
  runs also block. Read again; do not tag from an incomplete result.

The accepted enumeration model is an unfiltered list in descending run-id order whose original
creation times never rise more than a minute above the earliest one listed before them. The
observed inversion in #4330 was one second between runs of the same event. Sixty seconds is the
gate's chosen tolerance, not an observed maximum or a GitHub guarantee. Under this model, the
walk's extra minute past the cutoff keeps every run that could still count. Identical leading
repeats caused by new runs shifting pagination are tolerated. GitHub does not document an
immutable snapshot or ID/time-order guarantee; the
gate checks observed ordering and disagreements under this model. It does not reconstruct every
historical ref update or prove the first-ever arrival of C, and cannot detect arbitrary history
omitted by every API read. Stronger lifetime guarantees require durable ref-update evidence.

Direct, legacy or advisory-merge commits without a verifiable exact-C PR into the target
repository's `main` are unsupported candidates and stay blocked. Select a later reviewed public
PR merge containing the change, then validate that new candidate. Never infer a cutoff from Git
author/committer dates, workflow cohorts, a delay margin, or an unverified PR number. If every
validation predates a valid cutoff, dispatch the same SHA again for a fresh full round.

Job and artifact metadata must be complete, with unique ids and totals matching the returned
records (at most 100 per list). Each receipt archive is limited to 1 MiB compressed and one
regular `release-candidate.json` member of at most 64 KiB, including the actual decompressed
read. Extra or duplicate files, directories, links and malformed archives are refused.

Before tagging, also check that the newest **Workspace upgrade** run on `main` passed
(`gh run list --workflow workspace-upgrade.yml --branch main --limit 1`), or dispatch one with
`gh workflow run workspace-upgrade.yml --ref main`. It upgrades real `tale deploy` workspaces
from v0.5.77 and from the previous release with `main`'s CLI, and a red run means the release
could strand existing workspaces, as v0.5.79–v0.5.89 stranded every v0.5.77 workspace at the
automation writer protocol cutover. It runs against the newest published images, so a
candidate's own images are first upgraded to by the nightly run after publication. It is not
a candidate receipt, and the gate does not read it.

## 4. Tag the candidate

Only after the gate answers `eligible`:

```bash
git fetch origin
git tag vX.Y.Z <sha>
git push origin refs/tags/vX.Y.Z
```

The tag starts `release.yml`. It builds both architectures from the tag, runs its container
test gate, then publishes the manifests, the GitHub release, the CLI binaries and the package
tags. Prepare validates the version's authored notes before anything is built, so a version
whose notes it refuses publishes nothing.

The package tags `ui-vX.Y.Z` and `marketing-ui-vX.Y.Z` follow the release. Once
`Create release` has checked that the tag names the release commit, `Publish package tags`
dispatches `publish-packages.yml` on `main` with `release_tag=vX.Y.Z` and `source_sha=<sha>`.
A tag that a workflow writes with `GITHUB_TOKEN`, as `Create release` does for a dispatched
Release, starts no push workflow, while a `workflow_dispatch` always starts one
([Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)).
Publish packages checks out `<sha>`, validates the version's notes in that checkout, and
pushes only the two tags, once its publisher has confirmed that the remote's `vX.Y.Z` names
`<sha>`. A version snapshot uses tracked package files from that clean source; local ignored
files are excluded. It leaves `dist/ui` and `dist/marketing-ui` at their current commits.
Pushes to `main` and manual runs without version inputs update those rolling snapshots.
A version whose Release stops before `Create release` gets no package tags.

The validator and publisher run from `main`'s tooling checkout and read the selected source
as data. The validator's `--source-root <directory>` selects the release's notes; the
publisher's release-only `--checkout <directory>` selects its Git identity and package files.
Neither executes historical scripts or loads the historical checkout's Bun configuration.

`Manifest <service>` publishes one OCI image index per service with
`docker buildx imagetools create`. `:X.Y.Z` and, unless the release is sites-only, `:latest`
are written by one call, so they name the same index digest. The index carries the image's
`org.opencontainers.image.*` labels as annotations (GitHub takes a multi-arch package's
description from the index's annotations) and indexes exactly this run's
`X.Y.Z-amd64` and `X.Y.Z-arm64` images, each of which carries the same metadata on its own
manifest: `Build <service> (<arch>)` reads it back by digest and fails unless it equals the
image's labels. The Manifest job reads the index back and fails unless it is that annotated
OCI index. `docker manifest inspect` lists the index but hides its annotations;
`docker buildx imagetools inspect --raw` shows both.

A version dispatch of `release.yml` builds the head of the ref it runs on. Run one only with
`--ref vX.Y.Z` on the pushed tag, never on `main`.

Release admits at most one new full cohort per UTC calendar day. Every tag shares one
workflow concurrency group, so admission waits for an earlier run to finish publishing.
Running cohorts are never cancelled by a newer tag. GitHub keeps only one pending run;
if a pending tag is superseded, dispatch its immutable tag again when it is eligible.
Recovery of the latest published tag remains allowed, and unreadable release history
refuses a full release. A `sites_only` dispatch keeps its existing publication scope.

To retry or backfill a version's package tags, dispatch Publish packages the same way, on
`main`, with the tag and the full commit SHA it names:

```bash
gh workflow run publish-packages.yml --ref main -f release_tag=vX.Y.Z -f source_sha=<sha>
```

The run refuses a tag that names another commit and a commit without valid authored notes for
that version. A package tag
that already exists never moves: if its contents are identical, the run pushes nothing and
succeeds; if they differ, it fails. Reconcile that conflict using the recorded source and
publication evidence, preserving the existing tags. Never dispatch Publish packages on a tag or any ref other than
`main`: the run would use that ref's copy of the workflow and publisher, and the copy in an
older tag also force-moves `dist/ui` and `dist/marketing-ui` back to the tagged commit.

## 5. Verify the release

- The Release run for the tag concluded `success`, and the GitHub release exists. Its notes begin
  with the reviewed Highlights and Upgrade notes, then API contract changes and the generated PR list.
- A published image names the candidate:

  ```bash
  docker pull --platform linux/amd64 ghcr.io/tale-project/tale/tale-platform:X.Y.Z
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    ghcr.io/tale-project/tale/tale-platform:X.Y.Z
  ```
- The Publish packages run for `vX.Y.Z` concluded `success`, and `ui-vX.Y.Z` and
  `marketing-ui-vX.Y.Z` exist. A newly created snapshot records `from <sha>` at the end
  of its commit message. A preserved existing tag may have an older message: the publisher
  accepts it only when its snapshot tree exactly matches the selected release's package.
  Use that run's source binding and tree comparison to verify a no-op publication.

CLI publication dispatched on a tag requires the exact `release_tag` input to match that ref,
and its resolved commit (including annotated tags) to match the dispatch commit before building.
Every manual publication resolves its input tag once in Prepare and passes that exact SHA to
the build matrix, so a later tag change cannot change the binaries' source.
The existing Release workflow supplies both together. Manual CLI publication from a branch or
`main` may still build the specified tag, but it is not tag-bound deployment evidence; use the
matching tag ref when recovering a publication for Ops verification.

A published version is not a deployment. Deployments follow their own procedure.

## A release that has to go out

The daily admission rule means a new full cohort waits for the next UTC day after a
different release has published. Same-tag recovery remains available, and `sites_only`
content builds remain outside the full-cohort limit. What can stop a release is also
`main`: a candidate validates the whole graph, and every job that already fails on `main`
fails the candidate. Work in this order.

1. **Read `main`'s red before choosing the candidate.** Open the newest completed run
   of each workflow on `main`, push and scheduled, and read its failed jobs:

   ```bash
   gh run list --repo tale-project/tale --workflow checks.yml --branch main --event push --limit 8
   gh run view <run id> --repo tale-project/tale --json jobs \
     --jq '.jobs[] | select(.conclusion == "failure") | .name'
   gh run list --repo tale-project/tale --workflow e2e.yml --branch main --event schedule --limit 3
   ```

   The scheduled E2E run is where a browser regression shows first: pull request
   checks skip the browser E2E, so a defect can sit on `main` for hours.
2. **A failure every run of the same source shows is a defect of `main`.** Never
   re-dispatch a candidate hoping it clears and never waive a job: repair it through
   a pull request, then choose a candidate that contains the repair. A failure that the
   same source also passes (a `Backend integration` check that failed on one run and
   passed on the next, tracked in #4921) is a flake: re-run all jobs of that single
   run, put the check's name on the issue that tracks it, and let a green attempt be
   the evidence. What cost a release attempt on 2026-10-13:
   - `Unit (workspaces)` refusing "native CLI scopes cover every imported platform
     backend module": a backend file the CLI now imports must be named in
     `.github/ci-scope.yml`, `.github/workflows/cli.yml` and `tools/cli/turbo.json`.
     Refresh the descriptor with `bun tools/cli/scripts/release-candidate-contract.ts --write`
     and format it with the repository's `oxfmt`.
   - `UI (platform N/4)` failing one test: run that file alone from `services/platform`
     (`bunx vitest --run --config vitest.ui.config.ts <file>` takes seconds) and bisect
     it across the recent commits.
   - `Playwright (platform 4/4)` failing at a second person's sign-in: `fixtures.ts`
     overrides `storageState`, and that reaches every `browser.newContext()`. A second
     person needs `newPersonContext(browser)`.
3. **Holds are read again right before the tag.** Findings another lane recorded
   against the candidate (the platform's release task lists them) bind a manual
   operator too, and green checks do not clear them. Re-read them just before tagging
   and say how each stands: fixed in the candidate, not applicable and why, or an
   explicit decision by the owner. Waiting clears nothing.
4. **Write the receipt.** After the release is verified, record in one comment where
   the release lane coordinates, and on the pull request that carried the candidate:
   candidate SHA and version, the seven candidate run ids, the gate report's state,
   the tag's time, the Release, CLI and Publish packages run ids, the image revision
   check, and how each hold stood. An agent that reconciles the release later needs
   exactly those identities and has no other way to find them.
5. **Hand it to Ops.** A published version is not a deployment. Ops adopts it with its
   release adopter, or by hand when the adopter is blocked or the owner asks:
   `tools/release-adoption/README.md` in `tale-project/ops`, section "Adopting a
   release by hand".

## Failure, resume and idempotency

- **Failures stay visible.** A failed candidate run keeps its logs and its receipt, with verdict
  `failed`. Open the failing job before you decide anything.
- **Resume a flake.** Dispatch the same SHA again through the same repository event. An operator
  with Actions-write may rerun all jobs of an individual run. Failed-job-only reruns may omit
  required current-attempt job evidence and remain blocked; never substitute older job or
  artifact results. The newest attempt decides even when it belongs to an older run id, and the
  gate keeps the earlier Build runs in its report.
- **A second dispatch waits.** Dispatching a SHA that is already running queues a run behind the
  current one, without cancelling it. GitHub keeps one waiting run per group, so a third dispatch
  replaces the waiting one. That cancellation shows on the replaced run; the running one
  continues.
- **A real defect.** Do not release. Fix it on `main`, then choose a new candidate explicitly and
  say that it replaces the old one. Never tag a SHA other than the validated one.
- **Do not re-run an old `main` Build run** to validate a candidate. It keeps its ordinary
  path-filtered graph and does not produce the complete candidate receipt.
- **A missing or expired receipt** leaves the gate `blocked` and names the run. Expiry follows the
  artifact's own metadata, not a count of days (step 2), and an expired receipt can drop out of
  its run's artifacts: `kept no candidate receipt` for a run that passed means its receipt expired
  or was deleted. Validate the same SHA again under the release lease below: dispatch it again
  through the repository event, wait for the new runs, then run the gate again. It decides afresh
  whether the candidate is eligible.
- **Release-note validation fails.** Before tagging, correct the notes in a reviewed PR and choose
  the new candidate. If a tag was already pushed without valid notes, keep that tag and release
  the corrected candidate under the next version; never repair its source by moving the tag.
  Publish packages validates the notes at the commit the tag names, so notes merged later
  cannot repair the refused version either.
- **A release publication retry.** A published release is preserved, including its edited notes
  and attached assets. A draft with the same tag stops publication for the release lane to
  reconcile; do not delete or overwrite another maintainer's draft. API/authentication failures
  remain failures instead of being reported as an existing release. The draft check is
  `gh release view <tag>`: gh looks a published release up by its tag and a draft by its pending
  tag (GraphQL `release(tagName:)`, `FetchRelease` in cli/cli `pkg/cmd/release/shared/fetch.go`).
  The workflow test stubs `gh`, so it proves the step's branching, not GitHub's lookup. This is
  a recorded decision: the step treats any failed lookup as a missing release and calls
  `gh release create`, so the draft check is only as reliable as gh's lookup.
- **A failed Release run after the tag.** Never move the tag, and never rebuild a version
  whose `:X.Y.Z` images are published. The maintained adopter requires the complete
  publication job matrix from one current attempt; failed-job-only retries omit earlier
  successes, and mixing attempts is refused. A full re-run builds new images, though:
  `Build <service> (<arch>)` stamps `org.opencontainers.image.created` with the attempt's
  time, so every attempt pushes new digests, and `Manifest <service>` then points `:X.Y.Z`
  and `:latest` at them. So decide by what the registry holds, not by which job failed.
  Before any retry, look up `:X.Y.Z` for every service in the run's `Build` jobs, as the
  `Verify manifests are pullable` step of `Create release` does:

  ```bash
  docker manifest inspect ghcr.io/tale-project/tale/tale-<service>:X.Y.Z
  ```

  Count a service as missing only on a not-found answer (`manifest unknown`). An
  authentication, rate-limit or network error proves nothing, so treat that service as
  published.

  - **No service has `:X.Y.Z`** (typically a failure in `Prepare`, a `Build` job or the
    `Container test gate`): for a transient failure, re-run **all jobs** of the same Release
    run (its concurrency never cancels a release). The re-run replaces only the `X.Y.Z-amd64`
    and `X.Y.Z-arm64` tags, which only the run's own jobs read.
  - **Any service has `:X.Y.Z`** (typically a failure in `Manifest <service>`,
    `Create release`, `Trigger CLI build`, `Publish package tags` or `Summary`): re-run no
    job of that run. A full re-run re-points the published tags, re-running a failed
    `Manifest` job pushes them again, and the adopter refuses a failed-job-only attempt
    anyway. Leave the tag, the images and the run as they are; until the next version
    publishes, `:latest` can name different versions per service. Missing package tags are
    recovered by dispatching Publish packages for the tag, as step 4 shows.

  For a published version, or a failure that needs a source change, recover forward: fix
  `main` where needed, then validate a new candidate and release it as the next version
  (steps 1–5).

## Merging during a release, and the release lease

Releases never freeze merging.

- **Merges continue.** Anyone may merge while a candidate validates, external maintainers
  included. A merge cannot cancel the candidate run, and it does not change what the run
  validates.
- **What mergers leave alone.** Whoever merges does not cancel or re-run runs titled
  `Release candidate <sha>`. Dispatching them belongs to the release lane.

The release lane holds a lease while one release is in flight: from candidate to tag, Release
run and verification. The lease covers releasing only, never merging.

- **Record it** where the lane coordinates, with the holder, the candidate SHA, the version, the
  time acquired and the time it expires: three hours later.
- **Renew it** once, for three more hours, only while its run is still progressing.
- **Release it** with the outcome and the receipt.

After expiry, the next holder takes the lease over only after reconciling the release in flight:

1. **Candidate runs.** Run the gate for the leased candidate and version. If a candidate run is
   still going, wait for it.
2. **The tag.** `allocated` means a version tag exists at the candidate, not that publication
   succeeded. The report's `tag` is its commit and `tagName` is its actual spelling: verify that
   tag's Release run, without pushing the alternate spelling. `conflict` means someone else took
   the version, or chose another candidate: stop and hand the decision to a person.
3. **The Release run.** If the Release run for the tag is still going, wait for it. If it
   failed, follow the rule above; no tag moves.

Never start a second release while a Release run is in flight.


## Source contract shared with Ops

`.github/release-candidate-contract.json` is the source of the evaluator's required
workflow/job map. The existing workflow guard checks its exact receipt dependencies
and every matrix/reusable job. The same file declares candidate, ordinary main and
CLI publication result sets and the source admission assertions consumed by Ops.
No fetched executable evaluator is used by Ops.

After changing an admission condition, needs edge, matrix, conditional step/input,
execution defaults, runner/container/service selectors, permissions, timeouts,
or the source/receipt helpers, refresh the descriptor with:

```sh
bun tools/cli/scripts/release-candidate-contract.ts --write
```

Review the descriptor diff and run the existing release-candidate workflow and gate
tests. The refresh retains the required job map; it cannot remove a mandatory check
on its own. Exact workflow/job/step key sets bind field presence and absence,
including unknown future selectors. Every field value is bound except workflow
and step display names and run bodies; job names remain required evidence.
Reviewed-main run bodies still require code review, and this contract does not
prove their semantic equivalence. Body/comment or display-name edits that preserve
this admission shape need no Ops digest update.
Admission changes require review of the complete canonical descriptor digest in Ops
before a release uses them. A failed source-contract check is a compatibility task,
never permission to weaken mandatory work or accept an unknown receipt shape.

Ops policy v1 remains the historical v0.5.72 lane. Its descriptor-only v2 must be
activated with a minimum source containing this descriptor, after both repositories'
normal gates are green. This data extraction does not activate policy or deploy.
