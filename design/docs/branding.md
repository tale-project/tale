# Branding — the shared brand layer

The brand identity that legitimately spans app **and** web. This is the small set of things that are
genuinely shared by design — everything else two surfaces have in common is a substrate coincidence
(see [README.md](README.md)), not a brand contract.

## What's actually shared

- **The logo** — `TaleLogo` ([`packages/ui/src/logo/tale-logo.tsx`](../../packages/ui/src/logo/),
  exported from `@tale/ui/logo`). Themed fill (dark on light, white on dark). Use the component; never
  re-draw or re-colour the mark.
- **The accent** — brand blue `#056CFF` (`primary-500`). It is the one chromatic accent across both
  surfaces; in code it arrives through the brand/primary tokens, not a literal hex.
- **The typeface** — Inter, self-hosted (`@fontsource/inter`). Same everywhere.

## Design source

- [`design/sources/shared/branding.pen`](../sources/shared/) — brand identity, logo usage, colour usage.
- [`design/sources/shared/logofolio.pen`](../sources/shared/) — the logo system and variations.
- [`design/sources/shared/images/`](../sources/shared/images/) — the department / agent logos (`logo-design`,
  `logo-marketing`, `logo-operations`, `logo-qa`, …) and the brand moodboards.

## Org-level branding (configurable)

Self-hosted/cloud orgs can override brand surfaces (logo, name, colours) — that is **configuration**,
not a code change:

- [`configs/platform/custom/branding/`](../../configs/platform/custom/branding/) — where an org's
  branding config lives.
- [`docs/en/platform/admin/branding.md`](../../docs/en/platform/admin/branding.md) — the user-facing
  reference for what an admin can change.

Per Tale's boundaries, org branding is **files, not tables** — never add a branding column to Convex.
(The docs site intentionally has no per-instance colour override — its `locals.css` keeps docs,
platform, and web on the single shared scheme.)

## What is NOT shared

The app and the web are separate design languages (see [app.md](app.md) / [web.md](web.md)). Sharing
the logo, accent, and Inter does **not** make a marketing hero an app pattern or vice versa. Keep brand
consistent; keep page languages separate.
