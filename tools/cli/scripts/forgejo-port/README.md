# Forgejo port

Turns the workflows under `.github/` into the ones Forgejo's runner runs under `.forgejo/`.
It is a function of text: the files go in, the generated files, the checks the merge train
declares and the list of what Forgejo would refuse come out. No workflow under `.github/` is
changed until the cut-over, which adds one condition to one of them (`github --write`, below).

The unit tests of `@tale/cli` run the port over the workflows as they are today. They fail a
change when the generator crashes on a workflow, when `declared-checks.yml` no longer lists the
checks the port generates (`checks --write` rewrites it), when a composite action or a script the
manifest names is renamed or removed, when `e2e.yml` or `sast.yml` stops carrying the tier it is
generated for, and when this README lacks a row for a workflow or an edit the manifest lists.
What Forgejo would refuse in a workflow, an action the node's mirror list below lacks, a rule
that no longer finds the text it changes (its `anchor` warning) and a local action the port does
not generate (its `local-action-unported` warning) are printed as warnings, so that a workflow
edited today is not held to a port applied later; `check` fails on all four. The rule that finds
nothing leaves its file as the GitHub workflow has it, so a ported file would then lack what the
rule exists to change, and a local action left as it is stays a call to the GitHub copy, which
the port itself calls GitHub-only.

The port is applied once, at the cut-over. After that `.forgejo/workflows/` is edited by hand
and the generator is not run again. Until then it stays current with `.github/` by being
re-run, which is why it names no job or step that Tale edits daily: a workflow is ported by
rules that find what to change from what it says.

## Commands

```sh
bun tools/cli/scripts/forgejo-port.ts report               # what the port does to each file
bun tools/cli/scripts/forgejo-port.ts check                # fail on a problem, a rule with nothing to change, a local action left as GitHub's, a stale declared-checks.yml
bun tools/cli/scripts/forgejo-port.ts check --runner PATH  # also hold every file to a forgejo-runner
bun tools/cli/scripts/forgejo-port.ts generate [--write]   # the files of .forgejo/ (the cut-over); --force to overwrite what differs
bun tools/cli/scripts/forgejo-port.ts checks [--write]     # the checks the merge train declares
bun tools/cli/scripts/forgejo-port.ts github [--write]     # the edits GitHub's copies of the workflows that stay need
```

`--root DIR` names another checkout and `--out DIR` another place to write to.

`generate --write` overwrites a generated file whose contents differ and deletes any file in
`.forgejo/workflows`, `.forgejo/actions` and `.forgejo/scripts` that it does not generate, a
hand-written one included. The dry run lists them as `changed` and `stale`, and `--write` refuses
until `--force` is given.

## What it does

| Where | What | Why |
| --- | --- | --- |
| Triggers | `merge_group` and `repository_dispatch` are removed; `push` runs for `mq/**` with no `paths`; `pull_request` loses the types Forgejo has no event for | Forgejo fires neither event, and a batch of the merge train is a push to `mq/<batch>-<attempt>`. A new branch has no "before" to compare paths with |
| Release candidate | the `candidate-source` and `candidate-gate` jobs, `run-name`, and every condition on them | the candidate runs are GitHub's dispatch, which only the release lane on GitHub receives |
| Conditions | folded by what the port knows (the events the workflow has, the jobs it lost, the size of a matrix); a job or step that can never run is removed; a condition that called `always()`, `cancelled()`, `failure()` or `success()` still calls one when it folds to true | Forgejo evaluates `if` on the runner, so a skipped job still takes a runner; an `if:` that calls no status function waits for its `needs` to succeed |
| Merge group | `github.event_name == 'merge_group'` reads `push` | a batch is a push, and the only pushes a ported workflow has are batches |
| Scope | the `ci-scope` step is replaced by what it answers for the tier (below); Security runs on every pull request | the answer is a function of the event, and the files a pull request touches need GitHub's API |
| Readiness | each `CI ready (…)` job runs `forgejo-port/ready.ts`, which hands the needs to Tale's own policy (`../ci-ready.ts`) as a pull request or as a merge group, by the tier | the check the merge train reads is the one the merge queue read |
| Services | `services:` become `docker run` steps on the loopback address; a service's `credentials` and `volumes` are not carried over and are reported as warnings | a runner in host mode never starts them |
| Matrix | `strategy.job-total` is written as the number; rows whose runner the pool does not serve are removed | the runner leaves `job-total` empty, and a label it does not serve falls back to a Docker image instead of waiting |
| Actions | each external action is kept, replaced, dropped or refused from one table (`actions.ts`) | the node mirrors every action a workflow pins; the artifact actions have Forgejo forks; the runner cache is per instance |
| Registry | CI images go to `git.tale.dev` with the token of the secret `CI_PACKAGES_TOKEN`; BuildKit's `type=gha` cache becomes a registry cache written by batches | the job token can log in but cannot push a package |
| Link check | `lint:links` runs with `LINT_LINKS_BASE` set to the merge base with main, and the Format job fetches the whole history | GitHub checks a pull request out as a merge commit, so `HEAD^1` is the base there; a Forgejo run checks out the pull request's head and a batch is one commit per pull request, so `HEAD^1` would hide a page retired in an earlier commit |
| Release feed | `GITHUB_TOKEN` handed to a build becomes the secret `CI_GITHUB_TOKEN` | the web site's release feed calls api.github.com, which does not know Forgejo's token |
| Publisher | `publish-packages.yml` pushes to the Forgejo repository and runs on a `v*.*.*` tag as well | the push mirror makes GitHub's refs exactly Forgejo's, so snapshots and pins must be made there |

The rules are in `rules.ts`, `scope.ts`, `triggers.ts`, `actions.ts`, `cache.ts` and
`workflow-rules.ts`; the folder is `expression.ts` and `workflow.ts`; `manifest.ts` is the
one place that names a workflow, a label, a secret or a file.

## Tiers

A batch of the merge train, a push to `mq/**`, owes every job of every workflow. What a pull
request owes is the tier, set for all workflows by `tier` in `manifest.ts` and for one by the
`tier` of its plan; `--tier` replaces it for one run of the command.

| Tier | A pull request owes | Why |
| --- | --- | --- |
| `full` (the manifest's) | what a batch owes | a failure shows on the pull request, where its author is, and not in the train, where it costs a rebuild of the batch |
| `fast` | what the workflow says: since `main` lands each pull request on its own, every suite | GitHub's pull request tier, which CI.md describes |

Both tiers hand each `CI ready (…)` job to Tale's own policy; `full` as a merge group, `fast` as
a pull request.

Since GitHub's workflows hold no suite back from a pull request, the two tiers run the same
jobs on one; they differ only in that readiness.

## What the node must hold

| Of | What the generated workflows need |
| --- | --- |
| Mirrors (the instance resolves `uses:` at itself) | `actions/checkout`, `actions/setup-node`, `aquasecurity/trivy-action`, `astral-sh/setup-uv`, `docker/bake-action`, `docker/build-push-action`, `docker/login-action`, `docker/setup-buildx-action`, `forgejo/download-artifact`, `forgejo/upload-artifact`, `oven-sh/setup-bun`; and the pins those actions resolve before a job starts: `aquasecurity/setup-trivy`, `actions/cache` |
| Runner labels | `ubuntu-latest` and `ubuntu-24.04`, in host mode |
| Runner image | Bun, Node, git, jq, Docker with buildx and compose, and passwordless `sudo` for the runner's user; 4 CPUs, 16 GiB of memory (Type check gives Node a 6 GiB heap) and 80 GiB of disk (Build reclaims space down to 40 GiB free before it pulls the images) |
| Secrets of the repository | `CI_PACKAGES_TOKEN`, a token that may write packages (the job's own token logs in to the registry but cannot push), and `CI_GITHUB_TOKEN`, a read-only GitHub token for the web site's release feed |
| Registry | `git.tale.dev`, where CI images are pushed under `tale/tale/` |

`report` prints the actions the generated files use; `check` holds the Mirrors row to them.

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
pins for the node) into a directory only the user can use; a download that fails or does not match
the digest is reported. A problem the port or the runner reports about the workflows as they are
today is printed as a warning by the tests, so that a workflow edited today is not held to a port
applied later.

`forgejo-runner` is a Linux binary. On a workstation that is not Linux, `FORGEJO_RUNNER` may
name a script that runs the same version from its container image (the version, not the
pinned bytes), with the scratch directory shared at the same path:

```sh
#!/bin/sh
exec docker run --rm -v "$TMPDIR:$TMPDIR" --entrypoint /bin/forgejo-runner \
  code.forgejo.org/forgejo/runner:13.2.0 "$@"
```

Set `TMPDIR` to a directory the container engine shares. Give the script to `check --runner`,
or set `FORGEJO_RUNNER` to it for the tests. Without a runner the test says so and skips the
check.

## What the port leaves as it is

| What | On Forgejo | Why it stays |
| --- | --- | --- |
| `$GITHUB_STEP_SUMMARY` | Forgejo 15.0.9 discards the summary | the readiness job prints its verdict table to the job log |
| SARIF uploads to the Security tab | dropped with `github/codeql-action/upload-sarif`: Forgejo has no code scanning | a job that already retains the SARIF as an artifact keeps doing so |
| Comments that describe GitHub's behaviour | carried through unchanged | they are read and tidied by hand in the cut-over commit |

## Changing the port

1. Find what the rule has to recognise in the workflow itself (a job id Tale's readiness table
   lists, a label the pool serves, one exact line) and nothing else.
2. Say what was done in the report and what was not found in `warnings`; a rule that finds
   nothing to do does nothing. A rule whose text is gone says so with `rule: 'anchor'`, which
   `check` fails on.
3. Test it on a small workflow, then on the real ones with `report`.
4. Run `check --runner` before the cut-over.

## Cut-over

1. `check --runner PATH` is clean: no problem in the generated files, no rule without the text
   it changes, no local action left as GitHub's, `declared-checks.yml` is current and the
   Mirrors row lists every action the files use.
2. `generate --write` in a branch of the Forgejo repository; read the diff, in particular the
   comments that describe GitHub's behaviour.
3. `github --write` in a branch of the GitHub repository, merged before the push mirror is
   switched on; set the repository variable `TALE_SOURCE` to `forgejo` when it is.
4. The ops repository's `docs/guides/tale-cutover.md` has the rest: the accounts, the
   secrets, the merge train's declaration and the order.
