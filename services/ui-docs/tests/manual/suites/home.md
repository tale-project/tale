# Documentation entry

> **Prefix** `HOME-` · **Reset** none · **Cost** ~5 min

The root opens the first guide inside the shared documentation frame.
The retired marketing-page boxes keep their IDs in historical rounds; new
entry checks start after them. Functional entry routing is owned by
[`../reference/automation.md`](../reference/automation.md).

## Scope & routes

| Surface | Route / source |
| --- | --- |
| Entry guide | `{base}/`, first entry in `content/nav.json` |
| Shared frame | `app/routes/__root.tsx`, `app/components/docs/ui-docs-layout.tsx` |

## Preconditions

The dev server up per [`../setup.md`](../setup.md). Judge both Light and Dark.

## Boxes

- [ ] `HOME-16` · **Open `/` at 320, 768 and 1440 px and compare it with `/docs/getting-started/introduction`** → the same guide has the same article spacing, rail, header and footer treatment at each width; no empty hero band or horizontal scrolling, and the title and navigation remain readable in both themes.
