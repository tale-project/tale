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

Describe required operator action, migrations by file name, the new API contract version,
compatibility changes, or known limitations. If no action is required, state that explicitly
after checking the changes in this release.
```

Replace the instructional prose with verified outcomes. Do not copy generated PR titles into
Highlights or claim that an upgrade needs no action without checking. The validator requires both
sections and rejects empty sections, TODO/TBD markers and links into a `tale-project` repository
other than the public `tale` and `.github`, even in a comment: readers outside the organization
cannot open them. It also reads from Git what the release brings since the previous release tag,
and rejects Upgrade notes that do not name each migration file it adds, such as
`0204_usage_ledger_provider.sql`, and its `API_CONTRACT_VERSION` when that changed, such as
`3.44.0`. Naming more, such as an earlier release's migration, is allowed. A reviewer verifies the
facts.

Run from the repository root, in a clone with the release tags (`git fetch --tags`), before
recording the candidate SHA:

```bash
bun tools/cli/scripts/release-notes.ts --version vX.Y.Z
```

It compares with the release tag `git describe` finds before the checkout; `--previous-tag vA.B.C`
names another.

The release workflow validates the same file again in Prepare, before building images, and the
package workflow validates it at the released commit before pinning `ui-vX.Y.Z` and
`marketing-ui-vX.Y.Z`. Both run after the tag and pass `--shape-only`: they check the sections
and do not compare, so compare before tagging. The package workflow's maintained validator runs
from `main` with `--source-root <released checkout>`; it reads that checkout's notes without
executing its scripts or Bun configuration. At publication the release puts the authored sections
first, then generated API contract notes and GitHub's PR list. Release names remain
version-based. Follow [Releasing Tale](../RELEASING.md) for candidate validation, tagging and
recovery.
