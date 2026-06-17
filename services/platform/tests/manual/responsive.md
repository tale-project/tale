# Responsive — Manual Test Plan (cross-cutting)

> **Purpose**: Verify the app adapts across viewports — the mobile bottom tab
> bar and More sheet, the mobile Save bar, the chat composer, and that no page
> overflows horizontally at small widths.

## Scope

Test at three widths: **375×812** (mobile), **768×1024** (tablet), **1280×800**
(desktop). Resize the browser (or use the Playwright MCP `browser_resize`) and
re-walk the key surfaces: chat, a DataTable page, a settings form, a dialog.

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md).

> **Agent note**: drive width changes with `browser_resize`; the mobile primary
> nav is `navigation.aria.primaryNavigation` and the overflow sheet is
> `navigation.more`.

## Automated coverage

| Case(s)    | Status         | e2e spec             |
| ---------- | -------------- | -------------------- |
| F1, F2, F3 | ✅ automated   | `responsive.spec.ts` |
| F4–F7      | 🔶 manual-only | —                    |

## Functional tests

| ID  | Test            | Steps                                     | Expected                                                                            |
| --- | --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| F1  | Bottom tab bar  | At 375 px, view a dashboard page          | Bottom tab bar (`navigation.aria.primaryNavigation`) replaces the desktop side rail |
| F2  | More sheet      | Tap **More** (`navigation.more`)          | Secondary nav (knowledge, automations, settings) opens in a sheet                   |
| F3  | Mobile Save bar | At 375 px, edit a settings field          | The Save bar is reachable and usable (not clipped off-screen)                       |
| F4  | Chat on mobile  | At 375 px, send a message + attach a file | Composer, pickers, and attachment chips are usable; reply renders                   |
| F5  | Tables          | At 375 px, open a DataTable page          | Table adapts (horizontal scroll or stacked layout); no clipped actions              |
| F6  | Dialogs/sheets  | Open a create/delete dialog on mobile     | Renders full-width/again as a sheet; actions reachable                              |
| F7  | No overflow     | Scroll each key page at 375 px            | No horizontal scrollbar; nothing clipped or off-canvas                              |

## Boundary & error tests

| ID  | Test              | Input                                 | Expected                                           |
| --- | ----------------- | ------------------------------------- | -------------------------------------------------- |
| B1  | Tablet breakpoint | 768 px                                | Layout transitions cleanly (no half-broken hybrid) |
| B2  | Rotate            | Switch portrait ↔ landscape on mobile | Layout reflows without loss of state               |
| B3  | Long content      | A very long agent name / message      | Wraps or truncates with a tooltip; never overflows |

## Accessibility (WCAG 2.1 AA)

| ID  | Check         | Expected                                                              |
| --- | ------------- | --------------------------------------------------------------------- |
| A1  | Touch targets | ≥ 44×44 CSS px on mobile                                              |
| A2  | Reflow        | Content reflows to single column at 320 px without loss (WCAG 1.4.10) |
| A3  | Bottom nav    | Tab bar items have accessible names + current state                   |

## Performance

| ID  | Metric | Target                                         |
| --- | ------ | ---------------------------------------------- |
| P1  | Resize | Layout settles < 0.5 s after a viewport change |

## Issues Found

| #   | Test ID | Route / URL + width | Severity | Description | Screenshot |
| --- | ------- | ------------------- | -------- | ----------- | ---------- |
|     |         |                     |          |             |            |

## Test summary

```
Area: Responsive
Functional: ___/7   Boundary: ___/3   A11y: ___/3   Perf: ___/1
Widths: 375 ☐  768 ☐  1280 ☐
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
