# Forgejo port

Turns the workflows under `.github/` into the ones Forgejo's runner runs under `.forgejo/`.
It is a function of text: the files go in, the generated files, the checks the merge train
declares and the list of what Forgejo would refuse come out. Nothing in this directory is
read by the CI that runs today, and no file under `.github/` is changed by it.

The port is applied once, at the cut-over. After that `.forgejo/workflows/` is edited by hand
and the generator is not run again. Until then it stays current with `.github/` by being
re-run, which is why it names no job or step that Tale edits daily: a workflow is ported by
rules that find what to change from what it says.

## Commands

```sh
bun tools/cli/scripts/forgejo-port.ts report               # what the port does to each file
bun tools/cli/scripts/forgejo-port.ts check                # fail on a problem, on a stale declared-checks.yml
bun tools/cli/scripts/forgejo-port.ts check --runner PATH  # also hold every file to a forgejo-runner
bun tools/cli/scripts/forgejo-port.ts generate [--write]   # the files of .forgejo/ (the cut-over)
bun tools/cli/scripts/forgejo-port.ts checks [--write]     # the checks the merge train declares
bun tools/cli/scripts/forgejo-port.ts github [--write]     # the edits GitHub's copies of the workflows that stay need
```

`--root DIR` names another checkout and `--out DIR` another place to write to.

## What it does

| Where | What | Why |
| --- | --- | --- |
| Triggers | `merge_group` and `repository_dispatch` are removed; `push` runs for `mq/**` with no `paths`; `pull_request` loses the types Forgejo has no event for | Forgejo fires neither event, and a batch of the merge train is a push to `mq/<batch>-<attempt>`. A new branch has no "before" to compare paths with |
| Release candidate | the `candidate-source` and `candidate-gate` jobs, `run-name`, and every condition on them | the candidate runs are GitHub's dispatch, which only the release lane on GitHub receives |
| Conditions | folded by what the port knows (the events the workflow has, the jobs it lost, the size of a matrix); a job or step that can never run is removed | Forgejo evaluates `if` on the runner, so a skipped job still takes a runner |
| Merge group | `github.event_name == 'merge_group'` reads `push` | a batch is a push, and the only pushes a ported workflow has are batches |
| Scope | the `ci-scope` step is replaced by what it answers: a pull request owes the fast lanes, a batch owes everything, Security runs on every pull request | the answer is a function of the event, and the files a pull request touches need GitHub's API |
| Readiness | each `CI ready (…)` job runs `forgejo-port/ready.ts`, which hands the needs to Tale's own policy (`../ci-ready.ts`) as a pull request or as a merge group | the check the merge train reads is the one the merge queue read |
| Services | `services:` become `docker run` steps on the loopback address | a runner in host mode never starts them |
| Matrix | `strategy.job-total` is written as the number; rows whose runner the pool does not serve are removed | the runner leaves `job-total` empty, and a label it does not serve falls back to a Docker image instead of waiting |
| Actions | each external action is kept, replaced, dropped or refused from one table (`actions.ts`) | the node mirrors every action a workflow pins; the artifact actions have Forgejo forks; the runner cache is per instance |
| Registry | CI images go to `git.tale.dev` with the token of the secret `CI_PACKAGES_TOKEN`; BuildKit's `type=gha` cache becomes a registry cache written by batches | the job token can log in but cannot push a package |
| Release feed | `GITHUB_TOKEN` handed to a build becomes the secret `CI_GITHUB_TOKEN` | the web site's release feed calls api.github.com, which does not know Forgejo's token |
| Publisher | `publish-packages.yml` pushes to the Forgejo repository and runs on a `v*.*.*` tag as well | the push mirror makes GitHub's refs exactly Forgejo's, so snapshots and pins must be made there |

The rules are in `rules.ts`, `scope.ts`, `triggers.ts`, `actions.ts`, `cache.ts` and
`workflow-rules.ts`; the folder is `expression.ts` and `workflow.ts`; `manifest.ts` is the
one place that names a workflow, a label, a secret or a file.

## Tiers

| Run | Event | Owes |
| --- | --- | --- |
| Pull request | `pull_request` | Checks' fast lanes, Commitlint, SAST and Security; Build, E2E, CLI and the backend integration check read as skipped |
| Batch | `push` to `mq/**` | every job of every workflow |
| Nightly, weekly, manual | `schedule`, `workflow_dispatch` | as on GitHub |

A pull request costs about 28 runner-minutes and a batch about 141. At the measured volume
(about 108 pull request pushes and 40 batches a day) that is about 145 runner-hours a day, six
runners busy on average.

## What stays on GitHub

| File | Plan | Reason |
| --- | --- | --- |
| `release.yml` | github | the release lane: its jobs and runs are what the release adopter reads, it builds arm64 images, signs the macOS and Windows binaries and creates the GitHub release |
| `release-candidate-source.yml`, `release-candidate-receipt.yml` | github | reusable workflows of the candidate dispatch, which only GitHub can send |
| `scorecard.yml` | github | OpenSSF Scorecard publishes with GitHub's OIDC identity |
| `load.yml` | github | a manual load test GitHub-hosted runners serve as it is |
| `workspace-upgrade.yml` | github | upgrades a workspace from the published releases, resolved through GitHub's release API |
| `issue-labeler.yml` | later | labels issues with GitHub's REST API; Forgejo's labels API takes ids |
| `cleanup-pr-images.yml` | later | deletes a closed pull request's image tags through GHCR's API |
| `sandbox-incus-e2e.yml` | later | builds an Incus node with a ZFS pool on the runner, which needs a virtual machine |
| `cli.yml` | port | ported without its manual `release` job and without the macOS and Windows rows |

`github` prints the one edit GitHub's own copies need: `publish-packages.yml` publishes
nothing while the repository variable `TALE_SOURCE` is `forgejo`, because the mirror deletes
a ref only GitHub made.

## Checks

`declared-checks.yml` lists the checks the merge train waits for, one `CI ready (…)` per
workflow. `check` fails when it differs from what the port generates; `checks --write`
rewrites it.

`check --runner PATH` runs `forgejo-runner validate` on every generated workflow and action
and `forgejo-runner exec --list` on every workflow, so a file that parses but cannot be
planned fails too. The tests run it when `FORGEJO_RUNNER` names a binary, or on linux/amd64
by downloading the pinned build (`runner.ts`: version 13.2.0, the digest the ops repository
pins for the node). A problem the port reports about the workflows as they are today is
printed as a warning, so that a workflow edited today is not held to a port applied later.

## Changing the port

1. Find what the rule has to recognise in the workflow itself (a job id Tale's readiness table
   lists, a label the pool serves, one exact line) and nothing else.
2. Say what was done in the report and what was not found in `warnings`; a rule that finds
   nothing to do does nothing.
3. Test it on a small workflow, then on the real ones with `report`.
4. Run `check --runner` before the cut-over.

## Cut-over

1. `check --runner PATH` is clean and `declared-checks.yml` is current.
2. `generate --write` in a branch of the Forgejo repository; read the diff, in particular the
   comments that describe GitHub's behaviour.
3. `github --write` in a branch of the GitHub repository, merged before the push mirror is
   switched on; set the repository variable `TALE_SOURCE` to `forgejo` when it is.
4. The ops repository's `docs/guides/tale-cutover.md` has the rest: the accounts, the
   secrets, the merge train's declaration and the order.
