---
description: Tag a new version to trigger the automated Release pipeline
argument-hint: [version, e.g. v0.3.0]
allowed-tools: Read, Bash, Skill
---

Cut version **$ARGUMENTS** from `main`. Follow the [`release`](../skills/release/SKILL.md) skill.
Releasing is **pushing the `vX.Y.Z` tag** — that triggers
[`release.yml`](../../.github/workflows/release.yml), which builds all 9 multi-arch images, the
GitHub release (auto-generated notes), and the CLI binaries. Don't build or `gh release create` by hand.

1. **Preflight** — on `main`, synced with origin, clean tree, `bun run check` green.
2. **Validate the version** — `v`-prefixed semver, strictly greater than
   `git tag --sort=-v:refname | head -1`. Ask if missing or invalid.
3. **Survey** — `git log <latest>..HEAD --oneline --no-merges` + diff for anything non-trivial; catch
   operator-facing changes (new env var, renamed config, destructive migration).
4. **Notes** — default: let CI `--generate-notes`. Curated: pre-create the release with
   `gh release create <tag> --notes-file <file>` (CI skips its own creation) or `gh release edit`
   after. English; verify claims against the diff.
5. **Approval gate** — present version, commit/file counts, notes plan, breaking callouts. Ask
   explicitly before pushing the tag.
6. **Trigger & watch** — `git tag -a <tag> -m "Release <tag>" && git push origin <tag>` (or the
   curated `gh release create`). Then `gh run watch` and report the release URL.
