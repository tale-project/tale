# Tale blog

Ten sourced decision guides live in `en/`, `de/`, and `fr/`. The index and article routes are
`/blog`, `/blog/<slug>`, and their `/de` and `/fr` equivalents. The existing marketing content
registry, `MarketingContentPage`, and `MarketingProse` own loading, rendering, and discovery.
There is no separate blog CMS or Markdown engine.

Read [QUALITY.md](QUALITY.md) before adding or revising an article. The initial series uses
clearly labelled fictional worked examples, not Tale benchmark results or customer cases.
Linked research supports scoped claims; it does not demonstrate the product's deployed behavior.
The organization byline is Tale. Do not invent a person, reviewer, publication date, or case study.

## Authoring contract

Each article has matching filenames in all three full locales:

```yaml
title: A specific title that answers the reader's decision
description: A concrete description of the question this guide answers and the useful example or method it provides, without inflated promises.
slug: matching-file-slug
topicId: T11
reviewed: '2026-10-03'
draft: true
coverAlt: A concise description of the conceptual cover image.
```

The title is the sole H1 and metadata title (30–60 characters); descriptions follow the existing
110–160 character convention. Body headings start at H2. `reviewed` is the date sources were
checked, never an automatic publication or modification date. BlogPosting describes the visible
organization byline, language, headline, and representative image without manufactured dates.
The index uses `slug: blog` and omits `topicId`/`coverAlt`.

Keep a new article `draft: true` while reviewing. Use
`VITE_MARKETING_CONTENT_PREVIEW=true bun run --filter @tale/web dev` to inspect it; preview-only
pages are noindex and advertise no alternate languages. Production exposes a page only when
all EN/DE/FR variants are marked `draft: false`. The publication change belongs with completed
content, media, language review, and checks. Production builds ignore the preview flag.

`blog-relationships.ts` supplies related topic IDs. The index reads visible article metadata,
so neither cards nor navigation load all article bodies. Articles keep their source citations,
localize Tale route links, and link to the appropriate downloadable worksheet under
`/blog/worksheets/<locale>/`. Each worksheet includes a labelled filled example and a reusable
blank version. Downloads are static Markdown files and stay outside article discovery.

## Images

The cover series is generated conceptual art, not product screenshots. Optimized AVIF and WebP
variants are committed under `public/blog/covers`; originals and generation prompts are retained
in the research handoff. `BlogCover` uses the generated image manifest for dimensions and
responsive source sets, prioritizes article heroes, and defers card images. Cards use empty alt
text because their linked title already names the destination.

Explanatory SVGs live in `public/blog/diagrams/{en,de,fr}`. Translate their visible text, title,
description, and article alternative text together, and inspect label fit. The generated diagram
manifest supplies dimensions. The shared prose renderer offers a full-size link and keeps the
article explanation available in text. Follow `public/blog/README.md` for media provenance and
reproduction commands.

## Checks

- `bun run --filter @tale/web test` validates boundaries, locale structure, sources, media,
  downloads, related reading, and existing marketing behavior.
- `bun run lint:links` checks linked Tale documentation destinations.
- `bun run --filter @tale/web build` and `test:prerender` verify full text, canonical/alternates,
  discovery artifacts, and truthful article metadata in generated HTML.
- `bun run --filter @tale/web test:e2e tests/e2e/specs/blog.spec.ts` covers the index, articles,
  media, worksheet responses, keyboard tables, metadata, and unknown slugs across EN/DE/FR,
  light/dark, and phone-to-desktop widths.
- `bun run --filter @tale/web test:e2e tests/e2e/specs/blog-diagrams.spec.ts` measures rendered
  text padding, text overlap, and horizontal arrowhead clearance in all 30 localized SVGs.
- The [blog manual suite](../../../tests/manual/suites/blog.md) covers visual judgement and
  narrative quality that these checks cannot establish.
