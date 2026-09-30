# @tale/lint-links

The link gate: every link in the documentation sites, and every link into them from the rest of
the repository, lands on a page, a file or a section that exists.

```bash
bun run lint:links
```

CI runs it beside the other repository-wide gates, and `bun run check` runs it locally. It needs no
build and no server, and takes a few seconds.

## What it judges

1. **Every content page** of docs.tale.dev (`docs/`) and ui.tale.dev (`services/ui-docs/content/`).
   Each link the page renders, read with the renderer's own parser, is resolved against the page's
   URL the way a browser resolves it. That covers inline and reference links, autolinks, images, and
   the `href`/`src` of component tags like `<Card>` and `<Video>`, but never an example inside code.
2. **Every other file in the repository**, tracked or new but not ignored. It checks each absolute
   address on those two origins and each docs path the code builds at run time: template literals on
   the `DOCS_URL` / `TALE_DOCS_URL` constants, the marketing site's `docsPath` fields, and the
   `docs:` lists in its message catalogs (`src/references.ts`).

Each address is judged by the site it points at, through the site's own description of what it
answers (`services/<site>/scripts/link-site.ts`), with the documentation frame's rules
(`@tale/ui/docs/links`):

| Rule                        | The address…                                        | Fix                                                                    |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `link-target-missing`       | is a 404                                            | Use the page the finding suggests, or remove the link.                 |
| `link-via-redirect`         | is a moved page or a section folder                 | Link the page the redirect lands on.                                   |
| `fragment-missing`          | has a `#fragment` no heading or id renders          | Use the renderer's slug, or keep the old `{#id}` on a renamed heading. |
| `link-locale-switch`        | leaves a German or French page for another language | Link the page in the same locale tree.                                 |
| `link-empty`, `link-script` | is empty or a `javascript:` URL                     | Give it a real address.                                                |

External addresses are not fetched. The lockfile and the release notes fetched from GitHub
(`services/web/app/generated/`) are not scanned, since they quote history.

## Extending it

- **A new way of building a docs address in code** belongs in `src/references.ts`, with a test.
  Otherwise its links go unjudged.
- **A new documentation site** exports a `LINK_SITE_MODULE` from its `scripts/link-site.ts` and is
  added to `SITE_MODULES` in `cli.ts`.

## Scripts

```bash
bun run --filter @tale/lint-links test
bun run --filter @tale/lint-links typecheck
bun run --filter @tale/lint-links lint
```
