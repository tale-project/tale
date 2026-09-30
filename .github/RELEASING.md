# Releasing Tale

A release ships one commit: a **release candidate**, the full 40-character SHA of a commit on
`main`. You choose it once and keep it through every step. `main` keeps moving while you validate,
and no merge can change or cancel what you validate. A version tag is pushed only at a candidate
whose validation and gate have passed.

| Step | What you do | What decides |
| --- | --- | --- |
| 1. Choose | Record the candidate SHA and the version. | You, explicitly. |
| 2. Validate | Send one `release-candidate` repository dispatch for the SHA. | The seven existing workflows and their candidate receipts. |
| 3. Gate | Run the release gate script. | Its state: only `eligible` proceeds. |
| 4. Tag | Push `vX.Y.Z` at the SHA. | `release.yml`, as for every release. |
| 5. Verify | Check the Release run, the GitHub release and the images. | Their recorded revision. |

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
`Release candidate <sha>`. It reuses their existing jobs, including all E2E shards and all five
CLI build targets. Candidate validation never attaches CLI binaries to a release. Normal
pull request, push, nightly and manual events keep their existing behavior.

Follow the runs in Actions or list one workflow at a time:

```bash
gh run list --repo tale-project/tale --workflow e2e.yml --branch main \
  --json databaseId,displayTitle,status,conclusion \
  --jq '.[] | select(.displayTitle == "Release candidate <sha>")'
gh run watch <run id> --repo tale-project/tale
```

The Build **Run workflow** action remains available for an individual Build validation; it
does not start the other six workflows. Use the repository event for a complete candidate round.

Each workflow has a separate `<workflow>-candidate-<sha>` concurrency group with cancellation
disabled. Main merges cannot cancel these runs. The shared **Candidate source / Resolve source**
job refuses a shortened, malformed or off-main SHA before any test job. Each existing checkout
then uses that exact candidate **C**, including Commitlint's commit message. The trusted workflow
comes from default-branch commit **H**, which may differ from C. Both full commits must still be
on `main` when the release gate reads them; later merges do not invalidate an older H.

Build forces the complete image and container-test graph regardless of path filters. It builds
eight `candidate-sha-<sha>` images, records each pushed digest, and tests those digests after
checking their revision labels. It also runs the web, docs, ui-docs and ai-gateway container tests
and Storybook. Candidate images remain in GHCR. Build's advisory image Trivy job stays skipped;
SAST's Opengrep and Security's high/critical dependency and filesystem checks remain blocking.
Candidate scans do not upload SARIF attributed to H. Checks' **Integration scope** likewise owes
**Backend integration** (the real-Postgres suite against `tale-db` built from C) to every candidate,
whatever its last commit touched. Its suite reaches nothing off the runner but the database and
object store the job starts: the harness answers its lanes' vendor calls itself and refuses any other
host, so no vendor outage can fail a check. The job's setup still pulls from registries and mirrors
(the images, the ffmpeg install); re-run a setup step that fails on their outage. Never waive a
failed check.

Each workflow's final **Candidate gate** records the results of every required dependency and
fails if any is missing, failed, skipped or cancelled. Build's gate is a normal job; the other
six call **Candidate gate / Record receipt**. The artifact name is
`release-candidate-<workflow-stem>-<sha>-attempt-<attempt>`, retained for 90 days. Its sole file,
`release-candidate.json`, records schema version 1, the workflow path, C, verdict, run id/URL/event,
attempt, H, main ref and the exact dependency job results. Build also records all eight image
identities and digests; the other receipts have an empty image list.

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
- **Its newest validation.** The newest `Release candidate <sha>` attempt dispatched from `main`
  used the trusted Build workflow and succeeded, with every required job successful and a complete,
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
  run does not count: path filters skip checks there and later merges cancel it.

"Newest" uses GitHub's `run_started_at`, not the run's original creation time or id. Re-running an
older run after a newer success makes that rerun the deciding evidence: its failure blocks, an
unfinished attempt waits, and a later success can recover. A first attempt without a start time
uses its creation time; a rerun missing its start time is refused because its order is unknown.

The gate reads every page of each candidate-event list and the candidate's workflow-run list
before selecting attempts. It verifies the reported total, page lengths and unique run ids;
missing pages, repeated records or a changing total answer `blocked`, never an approval based on
the partial list. Retry a read that changed. Each list has a ten-page bound of 100 runs per page.
Because GitHub caps these filtered searches at 1,000 results, a total of 1,000 or more also answers
`blocked`: completeness cannot be proved at that boundary. Do not tag from that result; the
release lane must obtain complete evidence through a reviewed change to its query strategy.

Job and artifact metadata must be complete, with unique ids and totals matching the returned
records (at most 100 per list). Each receipt archive is limited to 1 MiB compressed and one
regular `release-candidate.json` member of at most 64 KiB, including the actual decompressed
read. Extra or duplicate files, directories, links and malformed archives are refused.

## 4. Tag the candidate

Only after the gate answers `eligible`:

```bash
git fetch origin
git tag vX.Y.Z <sha>
git push origin refs/tags/vX.Y.Z
```

The tag starts `release.yml` and `publish-packages.yml`. `release.yml` builds both
architectures from the tag, runs its container test gate, then publishes the manifests, the
GitHub release and the CLI binaries.

A version dispatch of `release.yml` builds the head of the ref it runs on. Run one only with
`--ref vX.Y.Z` on the pushed tag, never on `main`.

## 5. Verify the release

- The Release run for the tag concluded `success`, and the GitHub release exists.
- A published image names the candidate:

  ```bash
  docker pull --platform linux/amd64 ghcr.io/tale-project/tale/tale-platform:X.Y.Z
  docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    ghcr.io/tale-project/tale/tale-platform:X.Y.Z
  ```

CLI publication dispatched on a tag requires the exact `release_tag` input to match that ref,
and its resolved commit (including annotated tags) to match the dispatch commit before building.
Every manual publication resolves its input tag once in Prepare and passes that exact SHA to
the build matrix, so a later tag change cannot change the binaries' source.
The existing Release workflow supplies both together. Manual CLI publication from a branch or
`main` may still build the specified tag, but it is not tag-bound deployment evidence; use the
matching tag ref when recovering a publication for Ops verification.

A published version is not a deployment. Deployments follow their own procedure.

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
- **Do not re-run an old `main` Build run** to validate a candidate. It keeps its original group,
  and the next merge cancels it again.
- **An expired receipt** (after 90 days) makes the gate ask for a new validation.
- **A failed Release run after the tag.** Never move the tag. Re-run the Release run's failed
  jobs (its concurrency never cancels a release), or release the fix as the next version.

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
