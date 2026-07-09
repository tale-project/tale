# Tale design system

The developer- and agent-facing map of Tale's design. The generic
[`design-ui`](../.agents/skills/design-ui/SKILL.md) /
[`implement-ui`](../.agents/skills/implement-ui/SKILL.md) skills teach the _method_ ("find the
project's design system, reuse its components, use its tokens"); **this directory is where that search
lands** for Tale — the specifics those skills deliberately leave out.

> **`design/` vs `designs/`.** This `design/` directory holds the curated, navigable **docs**.
> [`designs/`](../designs/) holds the **source**: the encrypted Pencil `.pen` files, their exported
> images, the generated app handoff [`design-system.md`](../designs/platform/design-system.md), the
> token export [`semantic-tokens.json`](../designs/platform/semantic-tokens.json), and the
> [`accessibility-audit.md`](../designs/accessibility-audit.md). These docs distil and point to that
> source; they never fork it. Designer↔developer UI notes go in `design/comments.md` (per
> [`.claude/CLAUDE.md`](../.claude/CLAUDE.md)) — never code-level analysis.

## Two design languages on one substrate

Tale ships **two design languages** — the **app** (the platform product: chat, dashboards, settings;
light **and** dark) and the **web** (the marketing site: its own page language) — plus a shared
**brand** layer (logo, accent, Inter). They are not one system. In code, app, web, and docs all import
the same `@tale/ui` package, `globals.css` tokens, and Tailwind preset — but that shared substrate is
**plumbing, not licence to copy patterns across surfaces.** A chat/dashboard pattern is not a marketing
pattern. Never port one surface's layout into another.

| Surface             | Lives in            | Design source                                 | Build with                                 | Theme            |
| ------------------- | ------------------- | --------------------------------------------- | ------------------------------------------ | ---------------- |
| **App** (product)   | `services/platform` | `designs/platform/*.pen` + `design-system.md` | `@tale/ui` product components              | light + dark     |
| **Web** (marketing) | `services/web`      | `design/web.md` + `Site*` + shipped assets    | `@tale/ui` `Site*` + marketing composition | light + dark     |
| **Docs**            | `services/docs`     | follows the **app** language                  | `@tale/ui`, app patterns                   | **light-locked** |
| **Shared** (brand)  | `designs/shared/`   | `branding.pen` / `logofolio.pen`              | `TaleLogo`, accent `#056CFF`, Inter        | —                |

Convex / auth / the SPA shell are **app only** — never add them to web or docs. **Docs follow the app**
language (light-locked) — see [app.md](app.md).

## Sources of truth — read, don't memorize

Per [`AGENTS.md`](../AGENTS.md): _discover the conventions, don't memorize them._ These can't drift:

- [`designs/platform/design-system.md`](../designs/platform/design-system.md) — the app design _intent_
  - component/screen specs (1815 lines; the deep app reference).
- [`designs/platform/semantic-tokens.json`](../designs/platform/semantic-tokens.json) — the
  design-intent tokens (DTCG, light/dark).
- [`packages/ui/src/globals.css`](../packages/ui/src/globals.css) — the **shipped** tokens (the real
  ones in code) and the `@theme` / `.dark` wiring.
- [`packages/ui/src/index.ts`](../packages/ui/src/index.ts) + the Storybook
  ([`packages/ui/src/storybook`](../packages/ui/src/storybook/)) — the live component catalogue.
- [`designs/accessibility-audit.md`](../designs/accessibility-audit.md) — a11y rules + the form text
  hierarchy.
- The `.pen` files are **encrypted** — open them only through the Pencil MCP with the editor running
  (`get_editor_state({ include_schema: true })` first). Offline fallback: the exported PNGs in
  [`designs/platform/images/`](../designs/platform/images/) + the spec in `design-system.md`.

## Colours & tokens — the short version

**Three vocabularies coexist** (full tables + the map in [tokens.md](tokens.md)):

1. **Design-intent** (`surface-primary`, `text-primary`, …) — in `semantic-tokens.json` / the `.pen`
   files. Reference only; **not** the names you write in code.
2. **Canonical `@tale/ui`** (`--color-bg-base`, `--color-fg-base`, `--color-fg-muted`,
   `--color-border-base`, `--color-accent-base`…) → utilities `bg-bg-base`, `text-fg-base`, ….
3. **Legacy HSL/shadcn** (`--foreground`, `--background`, `--card`, `--muted-foreground`,
   `--destructive`, `--border`…) → utilities `text-foreground`, `bg-card`, `text-muted-foreground`,
   `text-destructive`, `border`. `globals.css` bridges these into `@theme` (its header says so).

**The code rule:** use the semantic utility classes mapped in `globals.css`; **never hardcode hex/gray**;
match the surrounding file. Brand accent is `#056CFF`. Dark mode uses **true neutral grays** (not the
blue-tinted `#030712`), driven by the `.dark` class + tokens.

## Important notes (the non-obvious)

- **Font: Inter only**, self-hosted (`@fontsource/inter`, metric-matched Arial fallback — no CDN).
- **Icons: Lucide only** — no custom SVGs; the sole exception is the locale flag glyphs in
  [`packages/ui/src/icons/flags.tsx`](../packages/ui/src/icons/flags.tsx).
- **One control height** — every control is `h-9`; `h-8` is the dense (`sm`) variant; `icon`/`icon-sm`
  are square; there is deliberately **no `lg`**.
- **`Card` is the one bordered-surface primitive**
  ([`layout/card.tsx`](../packages/ui/src/components/layout/card.tsx)) — every card-like surface is a
  `Card` variant, never a hand-rolled `div`.
- **Skeletons mask in place** — wrap the real component in `Skeletonize`/`SkeletonBox`
  ([`feedback/skeleton-context.tsx`](../packages/ui/src/components/feedback/skeleton-context.tsx)); no
  whole-tree swaps.
- **Toasts** top-right, 5s auto-dismiss (errors persist). **Tooltips** hover-only (~200/100ms), never
  on click. **Modals** use a backdrop blur. Hover fill is gray-100 light / gray-800 dark.
- **Accessibility is WCAG 2.1 AA** — the form text hierarchy (label → description → hint → error) and
  the open icon-button `aria-label` gap are catalogued in
  [`designs/accessibility-audit.md`](../designs/accessibility-audit.md).

## In this directory

- [app.md](app.md) — the **platform** app design language: shell, chat, conversations, knowledge, interaction conventions, docs-follow-app.
- [web.md](web.md) — the **marketing web** design language: `Site*` components, page language, assets, prerender, what _not_ to import.
- [branding.md](branding.md) — the **shared brand** layer: logo, accent, Inter, org branding config.
- [tokens.md](tokens.md) — the full **colour / spacing / type / icon** tables and the intent→shipped map.
