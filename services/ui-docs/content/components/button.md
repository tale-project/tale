---
title: Button
description: Choose an action style, name icon controls, and handle loading or unavailable actions without losing context.
---

Use `Button` for an action on the current screen. Give it a specific verb, such as **Save changes** or **Export**, and choose its appearance according to the action's importance and consequence. For navigation, use a link with button styling.

```tsx
import { Button, LinkButton } from '@tale/ui/button';
```

## Variants

<Demo name="button/variants" />

| Variant | Appropriate use |
| --- | --- |
| `primary` (default) | The main action in the current task. |
| `secondary` | A supporting action such as Cancel. |
| `ghost` | A quiet action in a toolbar or row. |
| `destructive` | A consequential removal, such as deleting or revoking. |
| `warning` | A consequential action that requires caution. |
| `success` | A positive action or completion treatment where the meaning is clear. |
| `link` | A text-style action; this remains a button unless you change its element. |

Use one primary action per decision area. A destructive color does not ask for confirmation or enforce permissions; the host owns those behaviors. Use a [confirmation dialog](/docs/components/dialog) when the decision needs explanation.

## Sizes and responsive labels

<Demo name="button/sizes" />

`default` is 36px high (`h-9`), and `sm` is 32px (`h-8`). `icon` and `icon-sm` are square controls at those heights. There is no `lg` size. The text-style `link` variant uses an automatic height instead of the fixed control box.

<Demo name="button/with-icon" />

Pass a Lucide component through `icon`; Button supplies a 16px decorative icon and spacing. `collapseLabel` visually hides the text below `sm` while preserving the accessible name. Pair it with an icon so the mobile control still has visible content.

## Show work in progress

<Demo name="button/loading" />

Choose **Save changes** to see a short simulated operation. `isLoading` displays a spinner, sets `aria-busy`, and disables activation. The label remains in place. The example resets after 1.5 seconds; a real screen should clear loading when its request settles.

Set `type="submit"` for form submission and `type="button"` for other form actions. The component does not generally override the browser's default button type. Disable duplicate submissions in your handler as well, and keep a failed save visible near the form.

## Explain an unavailable action

<Demo name="button/disabled-reason" />

Focus **Publish** with the keyboard to read why it is unavailable. When `disabled` and a nonempty `disabledReason` are present, the component uses `aria-disabled` instead of native `disabled`, preserves keyboard focus, and blocks clicks, Enter, and Space. A plain disabled button leaves the tab order.

The reason only applies while `disabled` is true. Describe what would make the action available; use visible nearby text when the explanation is essential to completing the task. A disabled UI control is not an authorization check.

## Navigate with a link

<Demo name="button/as-child" />

`asChild` merges styling onto one child element, such as an anchor. Keep link behavior on that child. Tooltips and `disabledReason` are suppressed in this mode, and an anchor does not acquire native button disabling. Do not use `disabled` as a way to prevent a link from navigating.

For TanStack Router destinations, `LinkButton` accepts `href`, `params`, `search`, and `prefetch`. It requires router context. For an external URL, an anchor inside `Button asChild` keeps normal browser link behavior.

## Props

Native button attributes pass through. These are the component-specific choices:

| Prop | Values or default | Behavior |
| --- | --- | --- |
| `variant` | `primary`, `secondary`, `ghost`, `destructive`, `warning`, `success`, `link`; default `primary` | Visual emphasis. |
| `size` | `default`, `sm`, `icon`, `icon-sm`; default `default` | Control dimensions. |
| `icon`, `iconClassName` | Lucide component; optional extra classes | Leading decorative icon. |
| `isLoading` | `false` | Spinner, busy state, and activation blocking. |
| `disabledReason` | Optional React content | Focusable explanation while disabled; unavailable with `asChild`. |
| `fullWidth` | `false` | Fills the available width. |
| `collapseLabel` | `false` | Hides text visually below `sm`. |
| `asChild` | `false` | Styles one child instead of rendering a button. |
| `title` | Optional string | Tooltip; also names an icon-sized Button unless `aria-label` overrides it. |
| `tooltip` | Optional React content | Overrides the visible tooltip text. |
| `tooltipSide` | `top`, `right`, `bottom`, `left`; default `top` | Tooltip placement. |
| `tooltipOpen`, `onTooltipOpenChange` | Optional controlled state | Lets a caller control a state-announcing tooltip. |

## Accessibility and alternatives

Icon-sized Buttons require `aria-label` or `title` at the type level. Text-sized buttons still need meaningful children; the type system cannot judge the label's quality. A tooltip alone is a description, not the control's name. `title` on a text Button adds a tooltip without replacing its visible accessible name.

Use `IconButton` from `@tale/ui/icon-button` for a toolbar glyph: it requires `aria-label`, defaults to `ghost`, and supplies a tooltip. For a table's create action, prefer `DataTable.addAction`; for a row menu, use the table's column builders. Check keyboard focus, the disabled explanation, and the loading state in both themes.
