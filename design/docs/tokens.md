# Tokens — colours, spacing, type, the intent→shipped map

A **map, not a copy.** Exact values live in the source and can change; this names the systems and the
utilities you write, so you read the right file for the value:

- **Shipped (code):** [`packages/ui/src/globals.css`](../../packages/ui/src/globals.css) — the only truth
  for what a class resolves to. Every service `@import`s it.
- **Intent (design):** [`design/sources/platform/semantic-tokens.json`](../sources/platform/semantic-tokens.json)
  — the DTCG token set in the `.pen` files (light/dark via `$extensions.mode`).

**Golden rule:** write the semantic **utility class**, never a hex. Match the surrounding file — the
codebase is mid-consolidation onto `@tale/ui` (the UI-unification program), so two shipped vocabularies
are live at once; don't invent a third.

## Shipped tokens — the two live vocabularies

`globals.css` says so in its own header: (1) canonical `@tale/ui` tokens and (2) HSL legacy/shadcn
tokens, both surfaced through Tailwind's `@theme` so they generate `bg-*` / `text-*` / `border-*`
utilities.

**1. Canonical `@tale/ui`** (`--color-*`, defined `@theme` + `:root`/`.dark`):

| Group      | Tokens                                                        | Utilities (examples)                              |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Background | `--color-bg-base` · `bg-elevated` · `bg-muted` · `bg-overlay` | `bg-bg-base`, `bg-bg-elevated`, `bg-bg-muted`     |
| Foreground | `--color-fg-base` · `fg-muted` · `fg-subtle` · `fg-inverse`   | `text-fg-base`, `text-fg-muted`, `text-fg-subtle` |
| Border     | `--color-border-base` · `border-strong` · `border-input`      | `border-border-base`, `border-border-strong`      |
| Accent     | `--color-accent-base` · `accent-fg`                           | `bg-accent-base`, `text-accent-fg`                |

**2. Legacy HSL / shadcn** (`--foreground`, `--background`, … bridged to `--color-*`):

| Token                                                            | Utilities                                 |
| ---------------------------------------------------------------- | ----------------------------------------- |
| `--background` / `--foreground`                                  | `bg-background`, `text-foreground`        |
| `--card` / `--card-foreground`                                   | `bg-card`, `text-card-foreground`         |
| `--muted` / `--muted-foreground`                                 | `bg-muted`, `text-muted-foreground`       |
| `--primary` / `--primary-foreground`                             | `bg-primary`, `text-primary-foreground`   |
| `--secondary`, `--accent`, `--popover`                           | `bg-secondary`, `bg-accent`, `bg-popover` |
| `--destructive`                                                  | `text-destructive`, `bg-destructive`      |
| `--border` / `--input` / `--ring`                                | `border` (`border-border`), `ring-ring`   |
| `--success` / `--warning` / `--info`                             | `bg-success`, `text-warning`, …           |
| `--chart-1…5`, `--chart-success/failure/warning/neutral/primary` | chart-theme utilities                     |

Anchor values (light → dark, read `globals.css` for the rest): `bg-base` `#ffffff → #0a0a0a`, `fg-base`
`#030712 → #f5f5f5`, `fg-subtle` `#6b7280 → #a3a3a3`, `border-base` `#e5e7eb → #404040`, `accent-base`
`#030712 → #ffffff`. Dark mode is **true neutral gray**, not blue-tinted.

## Brand accent

`#056CFF` (`primary-500`) — the one chromatic accent across app and web. In code it arrives via the
brand/primary tokens; don't write the literal hex. Per-org overrides: see [branding.md](branding.md).

## Design-intent tokens (reference only)

`semantic-tokens.json` groups: `background` · `surface` · `text` · `border` · `divider` · `button`
(primary/secondary/danger/ghost/disabled) · `input` · `card` · `nav` · `interactive` · `feedback`
(error/warning/success/info) · `avatar` · `badge` · `tooltip` · `skeleton` · `icon` · `logo`. Each is
light/dark. **These names (`surface-primary`, `text-primary`, …) are NOT the code classes** — they map
onto the shipped vocabularies above. Static scales (used to derive the rest): `gray`, `primary`,
`error`, `warning`, `success`, `info`, `slate`, `white`, each `25 / 50 / 100…950`.

## Spacing · radii · type · icons · motion

Intent scale (from `semantic-tokens.json`); in code you mostly write the matching **Tailwind
utilities** (`p-4`, `gap-3`, `rounded-lg`, `text-sm`, `size-4`).

| Scale                      | Values                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spacing**                | `4xs 4` · `3xs 6` · `xs 8` · `sm 12` · `md 16` · `mdLg 20` · `lg 24` · `xl 32` · `2xl 40` · `3xl 48` · `4xl 64` · `5xl 80` · `6xl 96` · `7xl 120` (px)                                                              |
| **Radii**                  | `xs 2` · `sm 4` · `md 8` · `lg 12` · `xl 16` · `2xl 24` · `3xl 32` · `full`. Shipped `globals.css`: `--radius-sm 6` · `--radius-md 8` · `--radius-lg 8` · `--radius-xl 16` → `rounded-md`/`rounded-lg`/`rounded-xl` |
| **Font size**              | `display 60` · `h1 48` · `h2 36` · `h3 32` · `h4 24` · `h5 20` · `h6 18` · `body 16` · `bodySm 14` · `caption 12` (px). Family: **Inter**                                                                           |
| **Font weight**            | `regular 400` · `medium 500` · `semiBold 600` · `bold 700`                                                                                                                                                          |
| **Line height**            | `tight 1.25` · `normal 1.5` · `relaxed 1.75`. Letter-spacing `tight -0.025em`                                                                                                                                       |
| **Icon size**              | `xs 12` · `sm 16` · `md 20` · `lg 24` · `xl 32` (Lucide, `size-3`…`size-8`)                                                                                                                                         |
| **Control**                | every control `h-9`; dense `h-8`; square `icon`/`icon-sm`; **no `lg`**                                                                                                                                              |
| **Motion** (`globals.css`) | duration `micro 100` · `short 150` · `standard 200` · `medium 300` · `long 400`; ease `default`/`out-quint`/`spring`; scale `pressed .97` · `hover 1.02` · `exit .95`                                               |

When you need an exact number or a token not listed here, **read `globals.css`** — it is current; this
table is a snapshot.
