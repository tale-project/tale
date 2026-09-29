# Releasing Tale

A release ships one commit: a **release candidate**, the full 40-character SHA of a commit on
`main`. You choose it once and keep it through every step. `main` keeps moving while you validate,
and no merge can change or cancel what you validate. A version tag is pushed only at a candidate
whose validation and gate have passed.

| Step | What you do | What decides |
| --- | --- | --- |
| 1. Choose | Record the candidate SHA and the version. | You, explicitly. |
| 2. Validate | Dispatch `build.yml` for the SHA. | The run's **Candidate gate** job. |
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

Dispatch the Build workflow for the SHA. With permission to run workflows, use the Actions tab
(**Build → Run workflow**, `candidate_sha`) or:

```bash
gh workflow run build.yml --repo tale-project/tale --ref main -f candidate_sha=<sha>
```

A token that can push but cannot run workflows (the release lane's) sends a repository dispatch
instead:

```bash
gh api repos/tale-project/tale/dispatches -f event_type=release-candidate \
  -f 'client_payload[candidate_sha]=<sha>'
```

Both start the same run, titled `Release candidate <sha>`. Follow it with:

```bash
gh run list --repo tale-project/tale --workflow build.yml --branch main \
  --json databaseId,displayTitle,status,conclusion \
  --jq '.[] | select(.displayTitle == "Release candidate <sha>")'
gh run watch <run id> --repo tale-project/tale
```

What the run does:

- **Its own concurrency group.** The group is `Build-candidate-<sha>`, and it is never cancelled.
  Merges to `main`, pull request pushes and re-runs of old `main` builds use other groups, so
  they cannot cancel it. That was the failure in
  [#3951](https://github.com/tale-project/tale/issues/3951).
- **Checks the candidate refuses.** The `changes` job refuses a SHA that is not full, or that is
  not a commit on `main`.
- **The same jobs as every push, all of them.** Every job checks out the candidate. It builds
  the eight images as `candidate-sha-<sha>` and runs Smoke test and Validate images. It runs the
  web, docs, ui-docs and ai-gateway container tests and the Storybook build, even when the
  candidate's last commit did not touch them.
- **One exception.** The advisory Trivy scan does not run for a candidate: its SARIF would be
  filed against the head of `main`.
- **Exact images.** Each build leg records the digest it pushed. Smoke test and Validate images
  pull those digests, never a tag, and fail on an image whose revision label is not the
  candidate. Candidate images stay in GHCR, like the `sha-<sha>` images of `main` pushes; no
  workflow deletes them.
- **The verdict.** The **Candidate gate** job runs last, whatever happened before it. It passes
  only if every job it needs succeeded. A skipped or cancelled job fails it.
- **The receipt.** The gate keeps the artifact `release-candidate-<sha>` for 90 days. Its
  `release-candidate.json` holds the candidate, the verdict, the run and attempt, the dispatched
  ref and workflow commit, every job's result and every image digest. The gate also writes it
  as a table in the job summary.

The workflow definition comes from the ref you dispatch (`main`). The source, the Dockerfiles and
the container test scripts come from the candidate. A test dispatch from another branch does not
count as release validation, even if its title, jobs and artifact names match. The release gate
checks the workflow path, the `main` dispatch branch and its full source SHA; that workflow commit
must still be on `main` when the gate runs. Later merges may advance `main` without invalidating it.

## 3. Run the release gate

```bash
bun tools/cli/scripts/release-candidate-gate.ts --sha <sha> --version vX.Y.Z
```

The gate only reads GitHub. It prints a JSON report and exits 0 only when the state is
`eligible`.

| State | Meaning | Next |
| --- | --- | --- |
| `eligible` | Every check below passed. | Tag (step 4). |
| `pending` | A required run is still going. | Wait, then run the gate again. |
| `blocked` | A required run is missing, failed, skipped or was cancelled. | Validate again, or re-run what failed. |
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
  used the trusted Build workflow and succeeded, with a successful Candidate gate job and an
  unexpired receipt. Earlier distinct candidate runs stay in the report; each entry describes
  that run's current attempt. Each run records its attempt number, creation and current attempt
  start times, dispatch branch and workflow source SHA in the report.
- **The other workflows.** The newest attempt of Checks, SAST, Commitlint and E2E on the commit
  succeeded, and so did CLI and Security when they ran for it. The Build push run of the commit
  does not count, because path filters skip checks there and later merges cancel it.

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

Only Build has a candidate mode so far. The other workflows still run once per push to `main`,
and a newer merge still cancels their older runs. E2E runs only when dispatched on the head of
`main`. If one of them never finished on the candidate, the gate answers `blocked`, and
re-running that old run only meets the next merge again. Choose a candidate whose runs finished
instead, and record that you did.

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

A published version is not a deployment. Deployments follow their own procedure.

## Failure, resume and idempotency

- **Failures stay visible.** A failed candidate run keeps its logs and its receipt, with verdict
  `failed`. Open the failing job before you decide anything.
- **Resume a flake.** Re-run the failed jobs (`gh run rerun <run id> --failed`, which needs
  permission to run workflows), or dispatch the same SHA again. Either stays in the candidate's
  own group. The newest attempt for the SHA decides, even when it belongs to an older run id,
  and the gate still lists the earlier runs.
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
