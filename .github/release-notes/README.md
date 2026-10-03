# Authored release notes

Before choosing a release candidate, add `vX.Y.Z.md` for the intended full release and merge it
through a reviewed PR. Keep these files as release history. A notes file belongs to one version;
never reuse an earlier version's highlights. Content-only `sites_only` builds do not publish a
GitHub release and need no file.

Use two sections, in this order:

```markdown
## Highlights

Describe the changes users can observe, who benefits, and a concrete workflow affected.
Link the relevant documentation or pull requests. State limitations when they affect adoption.

## Upgrade notes

Describe required operator action, migrations, compatibility changes, or known limitations.
If no action is required, state that explicitly after checking the changes in this release.
```

Replace the instructional prose with verified outcomes. Do not copy generated PR titles into
Highlights or claim that an upgrade needs no action without checking. The validator requires both
sections and rejects empty sections and TODO/TBD markers; a reviewer verifies the facts.

Run from the repository root before recording the candidate SHA:

```bash
bun tools/cli/scripts/release-notes.ts --version vX.Y.Z
```

The release workflow validates the same file again in Prepare, before building images, and the
package workflow validates it before pinning `ui-vX.Y.Z` and `marketing-ui-vX.Y.Z`. At
publication it puts the authored sections first, then generated API contract notes and GitHub's
PR list. Release names remain version-based. Follow [Releasing Tale](../RELEASING.md) for candidate
validation, tagging and recovery.
