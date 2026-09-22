# Accessibility — audit & changes

Historical findings and a procedure for continued accessibility work. Companion to
[`session-ux-changes.md`](session-ux-changes.md). The counts and contrast measurements below
record the original static sweep; they are not a current conformance report. Reproduce a finding
against the current source and rendered page before treating it as open or resolved.

Reusable controls, data tables, and error displays now live under `packages/ui/src/components/`;
platform-specific wrappers remain under `services/platform/app/`. Follow the current package
exports when locating moved components. Historical file names without a current counterpart
are retained as text below.

## What kicked this off

A user flagged that on the **System Prompt** settings page (governance → system prompt editor) the field labels read as the same color as the descriptions below them. Both were sitting at `text-muted-foreground`, so the hierarchy collapsed and the labels stopped doing their job.

The weight was already correct (labels are `font-medium`); the issue was color, not weight.

## Phase 1 — Recorded label-contrast fixes

Bumped form-label contrast at the shared-component level so every form on the platform inherits the fix.

- [`packages/ui/src/components/forms/label.tsx`](../../packages/ui/src/components/forms/label.tsx) — `text-muted-foreground` → `text-foreground`
- [`packages/ui/src/components/forms/form-section.tsx`](../../packages/ui/src/components/forms/form-section.tsx) — same swap on the inline `<span>` used by `FormSection`

Result: labels now sit at full foreground contrast, descriptions stay at muted, counters/hints can go even lighter via `text-tertiary` when needed. Three visible tiers instead of one.

This was a tiny diff but ripples through every form because they all go through these two components.

### Confidentiality footer — already fixed on `main`

The Phase 2 sweep (below) flagged that the chat composer's data-notice footer had drifted under AA: `text-gray-400 dark:text-gray-500` resolved to 2.81:1 (light) and 4.06:1 (dark). Both below the 4.5:1 floor for 12px text.

While we were drafting this audit, a separate commit landed on `main` that independently made the same swap (`text-gray-400 dark:text-gray-500` → `text-muted-foreground`) and re-added a small `ShieldAlert` icon next to the notice. After rebase, the footer reads at ~4.80:1 light / ~9.0:1 dark — AA-clean — without any change from this branch.

Recording the finding here anyway so the doc captures both the original failure and how it resolved.

## Phase 2 — Recorded static sweep

A programmatic pass over text contrast, icon labelling, hardcoded colors, and clickable non-buttons. Findings below. The runtime sweep (axe, Lighthouse, screen reader, focus/keyboard) is still pending — see "How to run the sweep".

### Lint coverage

`oxlint` is configured with the type-aware `jsx-a11y` ruleset enabled — 27 rules covering `aria-*` validity, `alt-text`, `label-has-associated-control`, role/interactivity mismatches, etc. Workspace overrides limit that coverage; the UI consolidation moved some exceptions with their
components into `packages/ui/.oxlintrc.json`. A passing lint run does not establish accessible
behavior or cover every instance. Inspect those overrides and verify the rendered interaction.

### Color contrast — token map

Tokens resolved from `packages/ui/src/globals.css`. Ratios computed against the resolved `--background`.

| Token (light)        | Hex     | On `--background` (#FCFCFC) | Verdict |
| -------------------- | ------- | --------------------------- | ------- |
| `--foreground`       | #09090B | ~19.3:1                     | ✓ AAA   |
| `--muted-foreground` | #71717A | ~4.80:1                     | ✓ AA    |

A ratio holds for one pairing only. `--muted-foreground` on the `--muted` fill (#F4F4F5) — the
table header — is ~4.40:1 and fails AA for 14px text, which is why `TableHead` reads
`--table-header-foreground` (zinc-600 #52525B, ~7.03:1 on `--muted`) instead.

| Token (light, on `--muted` #F4F4F5) | Hex     | Ratio   | Verdict |
| ----------------------------------- | ------- | ------- | ------- |
| `--muted-foreground`                | #71717A | ~4.40:1 | ✗ AA    |
| `--table-header-foreground`         | #52525B | ~7.03:1 | ✓ AAA   |

| Token (dark)         | Hex     | On `--background` (#0A0A0A) | Verdict |
| -------------------- | ------- | --------------------------- | ------- |
| `--foreground`       | #FFFFFF | ~19.1:1                     | ✓ AAA   |
| `--muted-foreground` | #9DA3AE | ~9.0:1                      | ✓ AAA   |

So the platform's primary text tokens are AA-clean in both themes — the Phase 1 fix (labels at `text-foreground`, descriptions at `text-muted-foreground`) is now load-bearing on this.

### Findings (rank: severity × surface area)

**1. Icon-only buttons rely on tooltip content for naming.** 🟠 _23 buttons across chat, conversations, automations, message-editor, navigation pagination._

Pattern: `<Tooltip content="..."><Button size="icon"><Icon /></Button></Tooltip>` with no `aria-label` on the button.

The shared `Tooltip` ([`packages/ui/src/components/overlays/tooltip.tsx`](../../packages/ui/src/components/overlays/tooltip.tsx)) wraps Radix `TooltipPrimitive`. Radix tooltips wire content via **`aria-describedby`**, not `aria-label`. That makes the tooltip a **description**, not the button's **name**. Screen readers announce these as "button, [description]" with no accessible name — failing **WCAG 4.1.2 (Name, Role, Value)** in addition to often failing 2.5.3 (Label in Name).

Where it's clean: roughly 71 of 94 icon buttons already set `aria-label` directly (settings/governance editors, vendor/customer dialogs, chat composer model/agent selectors, etc).

Where it's missing (23 occurrences in 9 files):

- `features/chat/components/message-bubble.tsx` (7) — copy, info, fork, bookmark, edit, save-prompt
- [`features/chat/components/voice-mode-toggle.tsx`](../../services/platform/app/features/chat/components/voice-mode-toggle.tsx)
- [`features/conversations/components/message-editor/editor-action-bar.tsx`](../../services/platform/app/features/conversations/components/message-editor/editor-action-bar.tsx) (4)
- [`features/conversations/components/message-editor/improve-mode.tsx`](../../services/platform/app/features/conversations/components/message-editor/improve-mode.tsx)
- `features/automations/components/automation-steps.tsx` (5)
- `features/automations/executions/executions-table.tsx`
- [`features/documents/components/rag-status-badge.tsx`](../../services/platform/app/features/documents/components/rag-status-badge.tsx)
- `features/settings/connectors/components/sso-config/role-mapping-section.tsx`
- [`packages/ui/src/components/data-table/data-table-pagination.tsx`](../../packages/ui/src/components/data-table/data-table-pagination.tsx) — the previous/next chevron buttons
- [`packages/ui/src/components/data-display/json-viewer.tsx`](../../packages/ui/src/components/data-display/json-viewer.tsx)

**Fix options (pick one consistently):**

1. Add `aria-label` to each button that matches the tooltip content. Verbose but unambiguous.
2. Use the shared `IconButton` where it fits; provide its explicit accessible label.

Keep the accessible name on the control. A tooltip is supplementary help, and a heuristic that
copies tooltip text should not decide the name of an unrelated child element.

**2. Hardcoded `text-gray-*` outside the data-notice case.** 🟡

File: [`services/platform/app/features/conversations/components/conversation-panel.tsx`](../../services/platform/app/features/conversations/components/conversation-panel.tsx#L585) — three sites use `text-[13px] text-gray-500 dark:text-gray-400`.

- Light: `#6B7280` on `#FCFCFC` ≈ **4.83:1** — passes AA
- Dark: `#9CA3AF` on `#0A0A0A` ≈ **8.4:1** — passes AAA

Functionally fine, but it's hardcoded gray bypassing the token system. Worth a follow-up to swap for `text-muted-foreground` so future theme changes don't strand these.

**3. Inline hardcoded colors in the global error display.** 🟢 _Defensible — explicitly inlined._

File: [`packages/ui/src/components/error-boundaries/displays/global-error-display.tsx`](../../packages/ui/src/components/error-boundaries/displays/global-error-display.tsx)

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
6. **Hit targets** — measure dense controls and their spacing. [WCAG 2.1 SC 2.5.5](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) defines 44×44 CSS pixels at AAA. The 24×24 minimum, with spacing and other exceptions, belongs to [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) at AA. Record the applicable criterion; do not label every target below 24 pixels a WCAG 2.1 AA failure.
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
- [ ] Review icon-only target size and spacing against the applicable criterion above
- [ ] Confirm all error messages have `role="alert"` + are linked via `aria-describedby`
