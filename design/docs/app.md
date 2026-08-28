# App — the platform design language

The **platform** product UI (`services/platform`). This is a distilled map; the exhaustive component +
screen specs live in [`design/sources/platform/design-system.md`](../sources/platform/design-system.md) — go
there for the detail of any element below, and to a `.pen` file (via Pencil) or
[`design/sources/platform/images/`](../sources/platform/images/) for the pixels.

## What the app feels like

A dense, calm, keyboard-friendly product surface in **light and dark**. Inter throughout, Lucide icons
only, generous whitespace on the `gap` scale, one bordered surface (`Card`), one control height (`h-9`).
Colour comes from tokens, never hex (see [tokens.md](tokens.md)). Motion is small and purposeful
(`framer-motion`): fades, slides, the AI shimmer — never decorative.

## Shell & layout

- **Nav sidebar** — a slim left rail (~48px in the design) of Lucide icon targets; the active item is
  full-contrast, inactive muted; each shows a no-arrow tooltip to its right. Built from `@tale/ui`
  primitives, not a bespoke layout.
- **Header** — per-section title row (`h-13`, `text-base` semibold `h1`) that always ends in exactly
  **one** `border-border` line: the tab strip's own `border-b` when a tab row follows (Knowledge,
  Inbox, project detail), otherwise the header's own bottom border (`AdaptiveHeaderRoot showBorder` —
  Projects, Automations, Settings). Icon buttons are 32×32, 8px radius, hover fill.
- **Right/secondary panels** (history sidebar, detail panels) slide in and **resize the main column**
  rather than overlay it; main content re-flows to the remaining width.
- **Main column is centred and width-capped** — e.g. chat is 558px (new) / 768px (conversation). Don't
  let product content run full-bleed.

## The big surfaces (pointers)

- **Chat** — centred input that auto-grows (72→200px then scrolls), send button appears only with
  content, agent selector dropdown above the input, streaming response with a blinking cursor + stop
  button, the **thinking timeline** (collapsed-by-default, user-controlled — never auto-expand it),
  rich-text/markdown answers, message hover actions. Specs: `design-system.md` → _Chat_, _Dev Notes_.
- **Conversations** (inbox) — split panel (list + detail), tabs (Open/Closed/Spam/Archived), bulk-action
  bar, Gmail-style reply composer with an "improve with AI" rewrite. Specs: `design-system.md` →
  _Conversations_.
- **Knowledge** — tabbed (Documents/Websites/Products/Customers/Vendors) over a `DataTable`. Specs:
  `design-system.md` → _Knowledge_.
- **Auth, settings, automations, agents, onboarding** — each has a `.pen` under `design/sources/platform/`.

## Interaction conventions (hold these everywhere)

- **Hover fill** — gray-100 light / gray-800 dark on every interactive list row, icon button, and
  selector (read the token in `globals.css`; never hardcode the hex).
- **Pointer cursor on anything pressable** — `@tale/ui/globals.css` restores it in `base` for
  `button` / `[role="button"]` (Tailwind v4's Preflight sets `default`), and `not-allowed` while
  disabled. A row that is deliberately inert opts out with `cursor-default`; never re-add
  `cursor-pointer` per button.
- **Toasts** top-right, 5s auto-dismiss; **error** toasts persist until dismissed; stack with 8px gap.
- **Tooltips** on hover only (~200ms in / ~100ms out), never on click.
- **Modals/overlays** use a backdrop blur over a dimmed scrim; confirm/cancel actions right-aligned;
  destructive confirm uses the danger colour.
- **Loading** masks in place — `Skeletonize` around the real component, never a whole-tree swap or a
  bare spinner where a skeleton fits.
- **Settings pages have no page titles** — the rail/tab already names the page; content starts at the
  first section header.

## Dark mode

First-class, not an afterthought. Every colour resolves through a token that has a `.dark` value;
verify both themes on anything you touch. Dark uses **true neutral grays**. Never ship a colour that
won't theme.

## Docs follow the app

[`services/docs`](../../services/docs/) uses the **same app language and `@tale/ui`**, but is
**light-locked** (`defaultTheme: 'light'`). Treat a docs UI change as an app change with no dark mode —
same components, same tokens, same conventions. Page _content_ rules live in the
[`write-docs`](../../.agents/skills/write-docs/SKILL.md) skill; this is only the visual layer.

## Accessibility (app)

WCAG 2.1 AA. The recurring gaps and the token hierarchy are in
[`design/sources/accessibility-audit.md`](../sources/accessibility-audit.md): icon-only buttons need a real
`aria-label` (a tooltip is a _description_, not a name); form text descends label → description → hint →
error; every overlay traps focus and restores it on close; hit targets ≥ 24×24px.
