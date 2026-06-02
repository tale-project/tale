# Session notes — UX changes

Quick log of what changed and why. Pair with [`agents-models-ux-gaps.md`](agents-models-ux-gaps.md) for the gap inventory.

## Notifications

Moved the bell out of the user dropdown and into the sidebar — notifications are a primary surface, burying them in a user menu makes them undiscoverable.

Rewrote the row pattern: dropped the chevron-expand, the duplicate severity dot (people kept reading it as an unread indicator), and the hidden "Mark as read" button. The whole row is now clickable to mark read. Same pattern as Gmail, Linear, GitHub.

New empty states: "You're all caught up" on the Unread tab, "No notifications yet" on All — with icons. Empty states are a positive design moment, not just absence of content.

Popover background switched to `bg-card` so light mode is white (matching the rest of the app's dropdowns).

## Data tables

Named the entity in row-count footers across 9+ tables. "Showing all 7 agents" instead of "No more items to load" — the old copy described the loading mechanism, users care about the data.

Search input bumped from 256px → 288px and fixed an internal `max-w-70` that was leaving a phantom gap before adjacent buttons. Footer copy left-aligned with `px-3` to match cell padding.

## Dropdown menus

Radio dots → checkmarks. Radios imply "select pending submit" but menus commit on click — wrong affordance. macOS, VS Code, Notion all use checkmarks. Submenu background flipped from `bg-muted` (grey) to `bg-card` to match the parent menu. Added a `keepOpen` flag for menu items that swap content in place.

## Settings

Dropped the redundant "Two-factor authentication is not yet enabled" line — the "Enable" button alone conveys state. Kept the org-enforced variant since "you must do this" is real context.

Branding panel borders were invisible because `border-input` paints with the input _fill_ color (white in light, near-black in dark) — switched to `border-border`. Lightened the heavy v4 `shadow-sm` to `shadow-xs`.

## Profile name save bug

`getCurrentUser` was reading from the JWT identity, which doesn't refresh on profile updates. So edits saved correctly to the DB but the form re-read the stale JWT name and "reverted" on screen. Now reads from the user table directly. One extra query per profile read — fine for this path.

## Agent picker

Capability icons (🌐 Web, 📄 Docs, 💻 Code, 🖼 Image, 🔌 Integrations) under each agent's description — scannable structured layer on top of the admin-authored prose. Descriptions vary in quality by agent author; icons are uniform.

Layout fix: icons originally sat in the right rail and competed with the selection checkmark; moved them into a new `meta` slot below the description. "Requires Tavily" warning moved to the same row, opposite the icons. Free side benefit: descriptions stopped wrapping. Background → `bg-card`.

## Model picker

Same pattern as the agent picker: dropped the radio, moved capability tag icons from the right rail to the `meta` slot, switched to `bg-card`.

Added hover tooltips on the provider badge ("Routed via Openrouter") and quantization badges (fp8 = "Higher quality, slower" / fp4 = "Faster, cheaper" etc.). This is option 1 from gap #4. **Option 2 (hide variants behind a developer toggle) is the better long-term fix** — most users have no reason to pick between fp8 and fp4 of the same model, that's a cost-vs-quality decision configuration shouldn't surface in the runtime picker. Tooltips are the band-aid.

## AI disclaimer

Hid the "AI can make mistakes—verify responses and do not share sensitive data." footer on the empty/new-chat homepage. It still appears in active chats (gated on `threadId`).

Why: the empty homepage is a _welcoming_ moment — the prompt is asking the user what they want to do, the composer is inviting them to start. A disclaimer underneath that says "be careful" before they've typed a word disclaims a thing that hasn't happened, and works against the inviting tone. The risk the disclaimer mitigates only exists once the AI starts generating, so that's the moment it earns its place — small, persistent, at the bottom of the active chat. Legally, this also matches how Swiss revFADP and the EU AI Act treat disclosure: required at the _point of interaction_, not pre-engagement.

Caveat documented for whoever owns compliance at Tale: if there's a contractual or vertical-industry reason it must stay on the homepage (regulated customers, enterprise contracts), revert. Otherwise this matches the industry default.

## Still open

From [agents-models-ux-gaps.md](agents-models-ux-gaps.md):

- "Auto" model attribution chip on AI messages (#1)
- Persistent capability indicator during chat — not just at picker time (#2)
- Cross-agent suggestion when the wrong agent is picked (#3)
- Reason-aware "No models available" empty state
- Quantization variants behind a developer toggle (the real fix for #4)
