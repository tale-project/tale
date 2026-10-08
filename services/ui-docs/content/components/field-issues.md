---
title: Field issues
description: Show a check's problems under the field they belong to, take the reader there with the range selected, and say why Save is off.
---

A problem is easiest to fix where it is. `Field` takes the problems a check found with its value and shows them under the control. An issue focus registry lets anything on the same surface, such as an [issue list](/docs/components/issue-list), move focus to the field and select the offending text.

```tsx
import { Field } from '@tale/ui/field';
import { FieldIssueMessages, fieldIssueDescribedBy } from '@tale/ui/field-issue-messages';
import { IssueFocusProvider, useIssueFocusTarget, useRequestIssueFocus } from '@tale/ui/issue-focus';
```

## Go to the field and fix it

<Demo name="field-issues/go-to" />

The prompt reads a node that does not exist. Choose the problem in the list: focus moves into **Prompt** with `nodes.nope` selected. Replace it with `nodes.triage` and the problem, the field message and the reason on **Save** go away. The example runs its own one-rule check on every change; your host runs its real check and passes the results in.

## Show a field's problems

Pass `issues` to `Field`, each with an `id`, a `severity` of `error` or `warning`, and a translated `message`. Each problem gets its own line under the control, with the severity icon and a visually hidden "Error:" or "Warning:". Error text uses the destructive colour. Warning text stays in the foreground colour beside an amber icon.

Every line is added to the control's `aria-describedby`, after any `error` and before the description. An error among them sets `aria-invalid` and draws the control's border in the destructive colour, as `error` does; warnings alone do neither. The lines are never an alert, so a screen reader does not repeat them at every keystroke. Announce the check's result once with [`IssueAnnouncer`](/docs/components/issue-list#count-and-announce-the-result). Unlike `error`, `issues` leave the description in place.

`Field` passes these attributes to its single child element. In a custom layout built on `FieldShell`, render `FieldIssueMessages` with an `idPrefix` and join `fieldIssueDescribedBy(idPrefix, issues)` into the control's `aria-describedby` yourself.

## Take the reader to a problem

Wrap the surface in `IssueFocusProvider`. Two editors on one page each need their own provider. Inside it:

- `useIssueFocusTarget(anchor, ref)` registers a control as the place to fix problems at `anchor`, a `/`-separated path such as a JSON pointer.
- `useRequestIssueFocus()` returns `request(anchor, range?)`, which focuses the target with the longest registered anchor that names `anchor` or a part of it.

For an element target, the registry opens any closed `<details>` around it, focuses it, selects `range` in an `input` or `textarea`, and scrolls it into view. A range is offsets into the text the control shows, start inclusive, end exclusive, and is clamped to that text. It applies only when the request names the target's own anchor. A request for `/nodes/0/input/to` that lands on `/nodes/0/input` focuses the input without a selection, because the offsets point into the `to` value rather than into that control. Register a target with a range only when the control shows the anchored string exactly as stored.

If no target has registered yet, for example because selecting a part opens the panel that holds the field, the request waits up to two seconds for one to mount. A newer request replaces it. When the target is behind a tab or a collapsed section that is not a `<details>`, pass `{ reveal }`: it runs first, and focus follows once the revealed content has rendered. A custom target can be any object with `focus(range?)`.

A dialog that closes after the request returns focus to the control that opened it. When choosing a problem closes the dialog, pass `preventCloseAutoFocus` to the `Dialog` or `ResponsiveDialogContent`, so focus stays on the field the request moved it to.

## Say why Save is off

While a check reports errors, the host sets its editor controller's `isValid` to `false` and its `invalidReason` to a sentence such as "Fix 1 error to save". `EditorActions` keeps **Save** focusable and shows the reason as its tooltip on hover and keyboard focus. In a sheet or on a phone, where nothing hovers, pass `inlineReason`: the reason becomes a visible line before the buttons, and **Save** is described by it. The reason appears only when the edits are unsaved and no save or load is running, so it is never shown for an unchanged form.
