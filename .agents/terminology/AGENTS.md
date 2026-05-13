---
name: terminology
description: Cross-locale terminology rules for the Tale platform UI, marketing site, and docs site — covering English source forms AND every translation. Use whenever writing or editing any user-facing string in `services/platform/messages/*.json`, `services/web/messages/*.json`, `services/docs/messages/*.json`, or pages under `docs/`.
---

# Tale terminology

Authoritative source for how every product term renders **in every locale, including English**. English is not exempt — it has its own spelling, capitalization, and style rules in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md). Translations derive from the English form but each locale has its own conventions on top.

Three surfaces follow these rules:

1. **Platform UI** — `services/platform/messages/*.json`.
2. **Marketing site** — `services/web/messages/*.json`.
3. **Docs site** — `docs/**` page bodies plus `services/docs/messages/*.json` chrome strings.

When the shipped UI and a terminology file disagree, the UI wins — update the terminology file to match, then propagate to docs and marketing.

## Files in this skill

- [`TERMINOLOGY.md`](TERMINOLOGY.md) — cross-locale rules that apply to **every locale, English included** (length parity, informal-form tone, plurals, placeholders, brand names, role names, error-message style). Read this first.
- [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md) — English source forms. Authoritative for `en.json` and any English prose in docs/marketing. Covers: product-feature spellings (`Knowledge base`, `Prompt library`, `Research plan`, `Arena Mode`), KB entities (`Customer`, `Vendor`, `Product`, `Document`, `Website`), technical vocabulary (`AI`, `LLM`, `MCP server`, `PII`), verb/noun pairings (`log in` vs `login`), and deployment terms (`self-hosted`, `on-premises`, `open source`).
- [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md) — German base.
- [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) — Swiss German overrides (mainly `ß` → `ss` and a few lexical shifts). Read [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md) first; this file lists only the diff.
- [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md) — French base.
- [`GLOSSARY.json`](GLOSSARY.json) — machine-readable projection consumed by [`services/docs/tests/terminology.test.ts`](../../services/docs/tests/terminology.test.ts). Keep in sync with the markdown files — the markdown is the human source of truth; this JSON is the machine view.

Add a `TERMINOLOGY_<LOCALE>.md` for any new regional variant. Variants list only what differs from the base; the base file applies to everything else.

## When to use

- **Writing or editing any English string** in `en.json` files, English docs pages, or marketing copy — check [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md) for the canonical form. `Knowledge Base` (title-cased) is a bug; `Knowledge base` (sentence-cased) is correct. `Todo list` is a bug; `Research plan` is correct. `On-premise` is a bug; `On-premises` is correct.
- Adding, renaming, or removing a UI string in `services/platform/messages/*.json` — confirm the term against the locale file and update it if the form needs a new entry.
- Writing or editing a translated docs page under `docs/de/`, `docs/fr/`, `docs/de-CH/`, or any future variant tree — quote UI labels verbatim from the locale JSON, and use the terminology tables to resolve standard product terms.
- Writing marketing or chrome copy in any locale — apply the same informal-form rule (`tu`/`du`) and product-term conventions; the marketing site is not exempt.
- Adding a new product term to the UI — register it in `TERMINOLOGY_EN.md`, every base locale file, and `GLOSSARY.json` in the same PR.
- Adding a new locale or regional variant — create `TERMINOLOGY_<LOCALE>.md` here and extend `GLOSSARY.json`.
