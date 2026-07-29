# Accessibility — audit & changes

Living doc for accessibility work across the platform. Companion to [`session-ux-changes.md`](session-ux-changes.md).

## What kicked this off

A user flagged that on the **System Prompt** settings page (governance → system prompt editor) the field labels read as the same color as the descriptions below them. Both were sitting at `text-muted-foreground`, so the hierarchy collapsed and the labels stopped doing their job.

The weight was already correct (labels are `font-medium`); the issue was color, not weight.

## Phase 1 — Fixed (this session)

Bumped form-label contrast at the shared-component level so every form on the platform inherits the fix.

- [`services/platform/app/components/ui/forms/label.tsx`](../services/platform/app/components/ui/forms/label.tsx) — `text-muted-foreground` → `text-foreground`
- [`services/platform/app/components/ui/forms/form-section.tsx`](../services/platform/app/components/ui/forms/form-section.tsx) — same swap on the inline `<span>` used by `FormSection`

Result: labels now sit at full foreground contrast, descriptions stay at muted, counters/hints can go even lighter via `text-tertiary` when needed. Three visible tiers instead of one.

This was a tiny diff but ripples through every form because they all go through these two components.

### Confidentiality footer — already fixed on `main`

The Phase 2 sweep (below) flagged that the chat composer's data-notice footer had drifted under AA: `text-gray-400 dark:text-gray-500` resolved to 2.81:1 (light) and 4.06:1 (dark). Both below the 4.5:1 floor for 12px text.

While we were drafting this audit, a separate commit landed on `main` that independently made the same swap (`text-gray-400 dark:text-gray-500` → `text-muted-foreground`) and re-added a small `ShieldAlert` icon next to the notice. After rebase, the footer reads at ~4.80:1 light / ~9.0:1 dark — AA-clean — without any change from this branch.

Recording the finding here anyway so the doc captures both the original failure and how it resolved.

## Phase 2 — Static sweep (this session)

A programmatic pass over text contrast, icon labelling, hardcoded colors, and clickable non-buttons. Findings below. The runtime sweep (axe, Lighthouse, screen reader, focus/keyboard) is still pending — see "How to run the sweep".

### Lint coverage

`oxlint` is configured with the type-aware `jsx-a11y` ruleset enabled — 27 rules covering `aria-*` validity, `alt-text`, `label-has-associated-control`, role/interactivity mismatches, etc. The repo currently passes lint, so the categories those rules catch are clean by construction. The findings below are the things the rules **don't** check.

### Color contrast — token map

Tokens resolved from `packages/ui/src/globals.css`. Ratios computed against the resolved `--background`.

| Token (light)        | Hex     | On `--background` (#FCFCFC) | Verdict |
| -------------------- | ------- | --------------------------- | ------- |
| `--foreground`       | #09090B | ~19.3:1                     | ✓ AAA   |
| `--muted-foreground` | #71717A | ~4.80:1                     | ✓ AA    |

| Token (dark)         | Hex     | On `--background` (#0A0A0A) | Verdict |
| -------------------- | ------- | --------------------------- | ------- |
| `--foreground`       | #FFFFFF | ~19.1:1                     | ✓ AAA   |
| `--muted-foreground` | #9DA3AE | ~9.0:1                      | ✓ AAA   |

So the platform's primary text tokens are AA-clean in both themes — the Phase 1 fix (labels at `text-foreground`, descriptions at `text-muted-foreground`) is now load-bearing on this.

### Findings (rank: severity × surface area)

**1. Icon-only buttons rely on tooltip content for naming.** 🟠 _23 buttons across chat, conversations, automations, message-editor, navigation pagination._

Pattern: `<Tooltip content="..."><Button size="icon"><Icon /></Button></Tooltip>` with no `aria-label` on the button.

The platform `Tooltip` ([`services/platform/app/components/ui/overlays/tooltip.tsx`](../services/platform/app/components/ui/overlays/tooltip.tsx)) wraps Radix `TooltipPrimitive`. Radix tooltips wire content via **`aria-describedby`**, not `aria-label`. That makes the tooltip a **description**, not the button's **name**. Screen readers announce these as "button, [description]" with no accessible name — failing **WCAG 4.1.2 (Name, Role, Value)** in addition to often failing 2.5.3 (Label in Name).

Where it's clean: roughly 71 of 94 icon buttons already set `aria-label` directly (settings/governance editors, vendor/customer dialogs, chat composer model/agent selectors, etc).

Where it's missing (23 occurrences in 9 files):

- [`features/chat/components/message-bubble.tsx`](../services/platform/app/features/chat/components/message-bubble.tsx) (7) — copy, info, fork, bookmark, edit, save-prompt
- [`features/chat/components/voice-mode-toggle.tsx`](../services/platform/app/features/chat/components/voice-mode-toggle.tsx)
- [`features/conversations/components/message-editor/editor-action-bar.tsx`](../services/platform/app/features/conversations/components/message-editor/editor-action-bar.tsx) (4)
- [`features/conversations/components/message-editor/improve-mode.tsx`](../services/platform/app/features/conversations/components/message-editor/improve-mode.tsx)
- [`features/automations/components/automation-steps.tsx`](../services/platform/app/features/automations/components/automation-steps.tsx) (5)
- [`features/automations/executions/executions-table.tsx`](../services/platform/app/features/automations/executions/executions-table.tsx)
- [`features/documents/components/rag-status-badge.tsx`](../services/platform/app/features/documents/components/rag-status-badge.tsx)
- [`features/settings/connectors/components/sso-config/role-mapping-section.tsx`](../services/platform/app/features/settings/connectors/components/sso-config/role-mapping-section.tsx)
- [`components/ui/navigation/pagination.tsx`](../services/platform/app/components/ui/navigation/pagination.tsx) — the previous/next chevron buttons
- [`components/ui/data-display/json-viewer.tsx`](../services/platform/app/components/ui/data-display/json-viewer.tsx)

**Fix options (pick one consistently):**

1. Add `aria-label` to each button that matches the tooltip content. Verbose but unambiguous.
2. Update the platform `Tooltip` to forward `content` as the trigger's `aria-label` when `children` is an icon-only button (heuristic: child has no text). Tighter blast radius.

Recommend (1) for first pass — easy to grep, lint won't help, and the explicit attribute documents intent. Reach for (2) if the pattern keeps reappearing.

**2. Hardcoded `text-gray-*` outside the data-notice case.** 🟡

File: [`services/platform/app/features/conversations/components/conversation-panel.tsx`](../services/platform/app/features/conversations/components/conversation-panel.tsx#L585) — three sites use `text-[13px] text-gray-500 dark:text-gray-400`.

- Light: `#6B7280` on `#FCFCFC` ≈ **4.83:1** — passes AA
- Dark: `#9CA3AF` on `#0A0A0A` ≈ **8.4:1** — passes AAA

Functionally fine, but it's hardcoded gray bypassing the token system. Worth a follow-up to swap for `text-muted-foreground` so future theme changes don't strand these.

**3. Inline hardcoded colors in the global error display.** 🟢 _Defensible — explicitly inlined._

File: [`services/platform/app/components/error-boundaries/displays/global-error-display.tsx`](../services/platform/app/components/error-boundaries/displays/global-error-display.tsx)

All eight color values cross-checked against `--background` in their respective themes:

| Element                      | Light                            | Dark                             | Verdict    |
| ---------------------------- | -------------------------------- | -------------------------------- | ---------- |
| Heading text                 | `#111827` on `#FFFFFF` (~16.7:1) | `#F3F4F6` on `#030712` (~18.2:1) | ✓ AAA      |
| Muted paragraph + small text | `#6B7280` on `#FFFFFF` (~4.83:1) | `#9CA3AF` on `#030712` (~9.5:1)  | ✓ AA / AAA |
| Primary button               | `#FFFFFF` on `#030712` (~19.8:1) | `#030712` on `#FFFFFF` (~19.8:1) | ✓ AAA      |
| Secondary button             | `#374151` on `#E5E7EB` (~10.4:1) | `#D1D5DB` on `#374151` (~5.06:1) | ✓ AAA / AA |
| Support link                 | `#056CFF` on `#FFFFFF` (~4.99:1) | `#5098FF` on `#030712` (~6.5:1)  | ✓ AA       |
| Error detail message         | `#DC2626` on `#FEF2F2` (~4.86:1) | `#F87171` on `#2D1F1F` (~5.4:1)  | ✓ AA       |

These are intentionally inlined so the boundary renders when CSS is broken — that constraint is documented in the file (`global-error-display.tsx:122-124`). Leave as-is.

### Categories not yet swept (still in "How to run the sweep")

1. **Color contrast** — run axe DevTools or Lighthouse on representative pages (chat, settings, knowledge, agents) in **both** themes. Tale aims for WCAG AA per AGENTS.md (4.5:1 for text, 3:1 for UI components). Some muted-foreground combinations may dip below that in dark mode.
2. **Label–input association** — every `<input>` needs a real `<label for="…">` or an `aria-labelledby`. Easy to miss with custom field components.
3. **Focus reachability + visibility** — every interactive element reachable via Tab, with a visible focus ring. The custom popovers / dropdowns we've polished are usual offenders.
4. **Heading hierarchy** — page H1 → section H2 → subsection H3, no skipped levels. Settings pages often skip.
5. **Live regions** — toasts and validation errors need `role="status"` / `aria-live="polite"` so screen readers announce them.
6. **Hit targets** — every clickable thing ≥ 24×24 px per WCAG 2.5.5. Icon-only buttons in dense rows are the usual fail.
7. **Keyboard navigation in overlays** — Escape closes menus/popovers; arrow keys move within menus; focus returns to the trigger on close.

## How to run the sweep

For each page in scope:

1. Open in Chrome with axe DevTools and Lighthouse (Accessibility audit).
2. Run **both** in light and dark mode — contrast results differ.
3. Tab through every interactive element. Note any that the focus ring skips or that have no visible focus state.
4. Open every overlay (dropdown, popover, modal, sheet). Verify Escape closes, focus traps where it should, and focus restores to the trigger on close.
5. Run a screen reader pass (VoiceOver on macOS) over one form and one chat — confirm labels, descriptions, and error messages announce.

Capture findings in a single markdown file (one per page or one consolidated), then triage into PRs grouped by surface (forms, navigation, overlays, etc).

## Token rules

A reusable hierarchy for any text inside a form/section:

| Role                     | Token                              | Notes                                                                                      |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Field label              | `text-foreground`                  | Full contrast. `font-medium`.                                                              |
| Field description / help | `text-muted-foreground`            | Sentence-case explanation under the label.                                                 |
| Counter / inline hint    | `text-tertiary`                    | Char counts, ratio strings, "(optional)" markers.                                          |
| Error message            | `text-destructive`                 | Inline validation only. Always pair with `aria-invalid` and `role="alert"` on the message. |
| Section header           | `text-foreground` + heavier weight | Above a group of fields.                                                                   |
| Section description      | `text-muted-foreground`            | One line under the section header.                                                         |

Same rules apply outside forms; they just happen to bite hardest in forms because that's where three text tiers sit closest together.

## Open todos

- [x] Compute WCAG contrast for the primary text tokens
- [x] Static scan: icon-only buttons missing accessible name
- [x] Static scan: hardcoded `text-gray-*` outside email-safe contexts
- [x] Static scan: clickable non-`<button>` divs (none in app routes)
- [ ] **Phase 3 (next):** fix the two remaining findings
  - [ ] Add `aria-label` to the 23 icon buttons relying on tooltip-as-description
  - [ ] Swap the three `conversation-panel.tsx` gray sites for `text-muted-foreground`
- [ ] Programmatic a11y sweep on chat, settings, knowledge, agents (both themes) — axe / Lighthouse
- [ ] Verify modal/popover focus trap and Escape behavior across the app
- [ ] Audit icon-only buttons for ≥ 24×24 hit target
- [ ] Confirm all error messages have `role="alert"` + are linked via `aria-describedby`
