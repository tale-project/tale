# Screenshots

Show, then tell: every UI step the reader performs is visualized, and every feature page opens
with a hero shot of its surface. A screenshot earns its place when it carries the point — a
location, a state, a layout — better than the sentence would; reach for words alone only when the
picture would show nothing. This file is the contract for every image that ships; the repo's docs
guide names the concrete pipeline, paths, and ceilings.

## The manifest rule — no hand-captured screenshot ever ships

Every image is declared in the repo's screenshot manifest: one entry per image mapping a stable
name to the route, the interaction steps that reach the state, the viewport, the crop, and the
seeded data it expects. Regeneration is one command; an image that can't be regenerated from the
manifest doesn't merge.

Why: screenshots rot silently. The UI ships weekly; a hand-captured image is stale the day the
surface changes, and nobody can tell what state produced it. The manifest is the coupling point —
when a change touches a route, grep the manifest for it and regenerate the affected images in the
same change.

## The believable-data rule — fix the seed, not the screenshot

The captured workspace must look like a real customer's: named people, plausible projects and
documents, realistic counts and dates. Never `test test 123`, never lorem ipsum, never an
obviously synthetic account name — and never real customer data, real emails, or real colleagues.
The seed fixtures own believability; when a screenshot looks fake, fix the seed and recapture,
don't retouch the image.

## Locale rule — capture the source locale only

Layout and interaction are locale-invariant, so one source-locale image serves every locale's
page; the alt text and caption translate, the pixels don't. Capture a locale variant only when the
visible string _is_ the subject — a translated label, a locale-specific format — and store it
alongside the original with a locale suffix.

## Crop rules

- **Capture the smallest region that carries the point** — an element or panel over a full page —
  but keep exactly one orienting landmark (the dialog title, the active sidebar item) so the
  reader knows where they are.
- **Fixed viewport and device-pixel ratio across all captures** — mixed scales read as sloppy and
  break visual rhythm.
- **No browser chrome, no cursor, no half-open animations** — capture settled state.
- **Respect the repo's format and size ceiling** — an over-budget file is an unoptimized export or
  an under-cropped capture; tighten the crop before lowering the quality.

## Embedding

Every screenshot lives in a frame with a caption, embedded with the repo's image syntax and a
**full descriptive sentence as alt text**. Caption and alt do different jobs: the caption directs
attention (what to look at here), the alt replaces the image (what a reader who can't see it needs
to know). "Chat composer" fails as alt; "The chat composer with the model picker open, showing
three available models." passes. Lead-in prose names why the reader is looking — a bare image with
no surrounding prose is the code-wall anti-pattern in another medium.

## CLI output

Prefer a fenced code block: it is searchable, translatable, and weightless. Reserve a terminal
image for output where colour or alignment is the point — and even then capture through the
repo's sanitizing path so no real username, hostname, or email ever ships.

## Where this fits

Screenshots carry the same bar as prose: reproducible, truthful, and owned by the page that embeds
them. The repo's image checks are the floor (existence, alt, size); the manifest rule and
believable-data rule are the parts a test can't judge. When you add a page's first screenshot, the
asset, its manifest entry, and the page ship in the same change.
