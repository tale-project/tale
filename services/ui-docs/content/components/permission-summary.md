---
title: Permission summary
description: Show what a choice lets someone do and what it does not, one line for each permission, with a check for what is allowed and a dash for what is not.
---

`PermissionSummary` lists what a connection, a role or a key can do and what it cannot. Each line is one permission: a check and its label when it is allowed, a dash and a muted label when it is not. Your app decides which permissions exist and which are allowed; the component only shows them. Use it where someone is about to grant access, so they can read the result of their choice before they confirm it.

```tsx
import {
  PermissionSummary,
  type PermissionSummaryItem,
} from '@tale/ui/permission-summary';
```

## List what is allowed

<Demo name="permission-summary/basic" />

Pass the permissions as `items`, in the order to read them. Each item has a `label` and `allowed`. Add a `detail` to say why something is not allowed, or what limits it, such as "Your role in Acme does not allow this." A `title` heads the list and names it for assistive technology, and a `footer` closes it with the rule behind the list, such as the role it is limited by.

| Prop     | Type                       | Purpose                                                   |
| -------- | -------------------------- | --------------------------------------------------------- |
| `items`  | `PermissionSummaryItem[]`  | The permissions: `label`, `allowed` and an optional `detail`. |
| `title`  | `ReactNode`                | A heading that also names the list.                       |
| `footer` | `ReactNode`                | A closing line under the list.                            |

The labels, details, title and footer are your words in the reader's language. The component supplies only the two words a screen reader hears, "Allowed:" and "Not allowed:", in the language of the app.

## Announce a list that changes

The summary does not announce its own changes. When the list changes as someone chooses, as in the example above, set `aria-live="polite"` on the component: a screen reader then reads the new state after the person stops choosing, without stealing the focus. Any other attribute you pass, such as `className` or `id`, goes to the outer element, and a `ref` points at it.

## Fit a narrow column

<Demo name="permission-summary/narrow" />

Labels, details and the footer wrap inside the column, even a single word wider than it, so a long German compound or a long name never pushes the box wider than its container. The check and the dash stay beside the first line of a label that wraps.

## Accessibility

The list is a `ul` named by the title when there is one. Each line reads as its state followed by its label: "Allowed: Read automations", "Not allowed: Edit automations". The check and the dash are decoration, hidden from assistive technology, and colour is never the only signal: the shape and the words differ. Text and glyphs keep their contrast against the surface in light and dark themes.
