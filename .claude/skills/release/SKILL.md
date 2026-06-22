---
name: release
description: How to cut a tagged release — push a `vX.Y.Z` tag that triggers the automated Release pipeline (`.github/workflows/release.yml`), which builds the multi-arch service images, the GitHub release, and the CLI binaries. Read before tagging a new version, deciding release notes, or running the `/release` command. Covers semver validation against the existing `vX.Y.Z` tags, what the tag-triggered CI does versus what you do by hand, auto-generated versus curated notes (and the `|| skip` guard that makes curated notes work), and the user-approval gate before the tag is pushed.
---

# release

Cutting a release is **pushing one git tag**. A `vX.Y.Z` (or bare `X.Y.Z`) tag triggers
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml), which does all the heavy
lifting — there is nothing to build locally. This picks up where [`ship`](../ship/SKILL.md) stops:
ship merges one change to `main`; release bundles what's on `main` into a versioned cut. Tag
mechanics defer to [`git`](../git/SKILL.md).

## When this applies

When the user asks to release/tag/publish a new version, or runs `/release [version]`. Not for
opening a PR (that's `ship`) and not for deploying an already-released version (operators run
`tale upgrade` then `tale deploy` — both are real CLI commands under
[`tools/cli/src/commands/`](../../../tools/cli/src/commands/)).

## What the tag triggers — don't redo it by hand

Pushing a `v*.*.*` tag runs the Release workflow end to end. Verify against
[`release.yml`](../../../.github/workflows/release.yml) before claiming otherwise; as of now it:

1. Resolves the version **from the tag** — the tag is the only version source. **Nothing to bump:**
   the image `VERSION` build-arg and the CLI version both come from the tag (CLI `package.json` ships
   `1.0.0-dev` as a placeholder).
2. Builds + pushes all **9 service images** (platform, db, proxy, convex, web, docs, sandbox,
   sandbox-egress, sandbox-runtime) for amd64 **and** arm64 to GHCR.
3. Runs the container test gate (image-validation + smoke + web + docs).
4. Creates the multi-arch manifests `:<version>` and `:latest`.
5. **Creates the GitHub Release** — `gh release create <tag> --title "Tale <tag>" --generate-notes`,
   guarded by `|| echo "Release already exists, skipping creation"`.
6. Triggers [`cli.yml`](../../../.github/workflows/cli.yml) to build the CLI binaries and attach them.

So the agent does **not** build images, push manifests, or run `gh release create` after a plain tag
push — CI owns all of it.

## The rules

Steps 1–4 are read-only. The tag push (step 5) is the irreversible, outward-facing action — it ships
images to a public registry and a public release — so it happens only after explicit user approval.

1. **Preflight.** Be on `main`, synced with `origin`, working tree clean, and the gate green
   (`bun run check`). Releases are cut from `main`; the tag must point at the commit you intend to
   ship.
2. **Pick the version.** Normalize to the repo's `v`-prefix; it must be valid semver and strictly
   greater than the latest tag (`git tag --sort=-v:refname | head -1` — tags look like `v0.2.84`). If
   missing or invalid, ask before continuing.
3. **Survey what's shipping.** `git log <latest>..HEAD --oneline --no-merges`, plus the diff for
   anything non-trivial. This both informs the notes and catches operator-facing changes (new
   required env var, renamed config, a destructive migration) that deserve a callout.
4. **Decide the notes strategy.**
   - **Auto (default for routine cuts):** let CI run `--generate-notes`. Do nothing extra.
   - **Curated:** because step 5 of the pipeline _skips_ when a release already exists, pre-create the
     release with your notes so CI keeps them — `gh release create <tag> --title "Tale <tag>" --notes-file <file>`
     (this also creates and pushes the tag). Or push the tag for auto-notes, then replace them with
     `gh release edit <tag> --notes-file <file>`. Write curated notes in **English**, and verify each
     non-obvious claim against the diff — a commit subject is a lead, not a fact (`reviewer-caught`).
5. **Approval gate (hard).** Present: previous → new version, commit/file counts, the notes plan
   (auto vs. the curated preview), and any operator-facing/breaking callout. Then ask explicitly
   before pushing. **Never push the tag or create the release without that approval.**
6. **Trigger, then watch.** Push the annotated tag (`git tag -a <tag> -m "Release <tag>" && git push origin <tag>`),
   or run the curated `gh release create` from step 4. Re-runs without a new tag go through
   `workflow_dispatch` (`gh workflow run release.yml -f version=<tag>`). Then follow the run
   (`gh run watch`) and report the release URL once create-release and the CLI build finish.

## Patterns

Don't:

- Run `gh release create` after a plain tag push — the pipeline already did, and a second call fails
  on the existing release.
- Build or push images / manifests locally — CI builds all 9 services for both arches.
- Bump a version in `package.json` or a VERSION file — the tag is the only source.
- Push the tag before the user has approved the version and notes.

Do:

- For curated notes, create the release _before_ the tag-triggered pipeline reaches its create-release
  job; the `|| skip` guard is exactly what preserves them.
