# Blog media

The covers are AI-generated conceptual editorial illustrations, produced with the built-in
image generation tool for the 2026-10-03 Tale editorial package. They are not product screenshots,
customer evidence, measured outcomes, or certifications. The selected T05 image is revision v2;
the superseded image is not shipped.

The original PNGs, prompts, source-image identifiers, and revision history remain in the research
package's `editorial/assets/` and `editorial/image-prompts.json`, outside the repository. The
responsive assets below are the published derivatives; no PNG master is copied into `public/`.

## Covers

`covers/T01-480.webp` through `covers/T10-1600.avif` use the existing image pipeline:
widths 480, 828, 1200, and 1600; WebP quality 78; AVIF quality 64; no enlargement or crop.
`app/generated/blog-image-manifest.ts` records the source dimensions, variant URLs and blur
preview for each T01–T10 identifier. Cover alternative text belongs to the localized article.

From the repository root, regenerate with the source package available:

```sh
bun services/web/scripts/optimize-images.ts --blog /path/to/editorial/image-prompts.json
```

The command resolves each `assetPath` relative to that JSON file and uses its stable `id` for
filenames. It does not alter the marketing image manifest. Outputs are committed assets; the
application build does not need the masters or an image-generation service.

| Topic | Selected master | SHA-256 of master |
| --- | --- | --- |
| T01 | T01-cover.png | `d5660a448ca82625331bae4a0e190c7c94a4aafa7b33e41f63dd9e5f8b9d421a` |
| T02 | T02-cover.png | `89914c30dc7ce184ee2eef11d75af6a8681dc070f1d1cbb8cbb7ffc2a0030ce1` |
| T03 | T03-cover.png | `2c9ed9fca4bfb66da5c376ce7ade16595fbfe2fdb1b858bdae3e6e0bd23a513c` |
| T04 | T04-cover.png | `774eb29d3cfa4dd7d955d71947440fd479c42d6d2cb505ba64aa8a20a872faea` |
| T05 | T05-cover-v2.png | `5d0080b924c94f773a6bb36090c71cd334c3648e4f34aabbf24082882d53cdae` |
| T06 | T06-cover.png | `9468c5dcfa7e402f703f4706b58aa7a33ad8f7c77d9e7f5682b5ffef4ea364d8` |
| T07 | T07-cover.png | `29f126df27efa59e18cc07c5686835e188576b87df0c9f4c59821e44a2312879` |
| T08 | T08-cover.png | `315236702e2c1ea845e06c9aa65b35c8a975bf7c5e8716a5c9d2b8bc1859b058` |
| T09 | T09-cover.png | `8efb8bef24c1a6b9f483a5f587ee5ce1ae37a5c8a8b0199fb038e43d73d3860c` |
| T10 | T10-cover.png | `31fd07f3b52eb184944a1888baef258864ed94e36fd1a00ae8c4726e8abf82fc` |

## Diagrams

`diagrams/{en,de,fr}/T01-diagram.svg` through `T10-diagram.svg` are editable SVG explanations.
Their visible text, accessible title and description, and conceptual-example notice are localized.
They deliberately distinguish result review from action authorization and permission from
successful execution. The diagrams depict concepts, not Tale interface layouts or measured results.

Each locale retains the source viewBox dimensions. The English diagram sources come from the
editorial package; spacing and line breaks are adjusted where necessary to keep labels inside
shapes. Localized copies preserve the same relationships. `app/generated/blog-diagram-manifest.ts`
records each locale, URL, and viewBox dimensions so pages can reserve the right space.

When editing a diagram, preserve its accessible title/description and update all three locales.
Check the rendered text for clipping and overlap, including line breaks inside SVG text spans.
Use at least 16 SVG units of visible text clearance inside boxes. Headings with body text use a
consistent heading-to-body gap; standalone labels are vertically centered. Arrowheads use explicit
user-space dimensions so stroke width cannot enlarge them into the neighboring box.
`tests/e2e/specs/blog-diagrams.spec.ts` checks rendered text bounds across all thirty diagrams.
If viewBox dimensions change, update the diagram manifest in the same change. Localized article
alternative text explains the diagram's relationships independently of its visible labels.
