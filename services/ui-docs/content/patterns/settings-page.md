---
title: Settings page
description: Label-left fields on one measure, and a save bar that only appears when something changed.
---

A settings page is a column of fields and a way to commit them. Two decisions
carry the whole pattern: the page declares its field layout once instead of per
field, and the save affordance is driven by dirty state rather than always
sitting there.

By the end of this page you will be able to build a settings surface where
every control lines up and the reader can never lose an edit silently.

## The whole thing

<Demo name="patterns/settings-page" />

Change a value and watch the bar wake up.

## One measure, declared once

```tsx
<ContentArea variant="narrow">
  <Input label="Workspace name" description="…" value={name} onChange={…} />
  <Select label="Data region" options={regions} value={region} onValueChange={…} />
  <Switch label="Weekly digest" description="…" checked={digest} onCheckedChange={…} />
</ContentArea>
```

`ContentArea variant="narrow"` does two things at once: it caps the column at
`max-w-3xl`, the settings measure, and it declares the **row field layout**.
`FieldShell` — which `Input`, `Select`, `Switch` and the rest render through —
reads that from the container and switches to label-left, control-right from
`sm` up, pinning every control to the same 20rem column.

You never set that per field. If one control is misaligned, it is because it
bypassed `FieldShell`, not because it needs its own class.

**Settings pages carry no page title.** The rail or the tab already named the
page; a title inside the body would be a second `h1` and a wasted row.

## Group with section headers, not with cards

A settings page is a list of fields, not a grid of panels. Group related fields
under a `FormSection` heading and separate groups with the section rhythm
(`gap-8`). Reach for a `Card` only when a group genuinely is a separate object —
a connected provider, a key, a device.

Keep a group's heading at the right depth: the page has no `h1` of its own, so
section headings start at `h2`.

## The save bar

The bar belongs to the editor, and it appears because something is dirty. That
is the contract `EditorGroup` implements for real screens:

```tsx
import { EditorGroup } from '@tale/ui/editor/editor-group';
import { useFormEditor } from '@tale/ui/editor/use-form-editor';
```

An editor controller (`useFormEditor`, `useJsonConfigEditor`) owns the draft,
reports whether it is dirty, and exposes `save` and `cancel`. `EditorGroup`
composes several controllers into one bar, so a page with three independent
sections still has a single Save.

Three rules hold whichever controller you use:

1. **Save is disabled until something changed.** An always-enabled Save teaches
   the reader that pressing it is free, which is wrong the one time it is not.
2. **Discard is as reachable as Save.** They are a pair.
3. **Leaving with unsaved changes is blocked.** The dirty blocker is what turns
   an accidental navigation into a question instead of a loss.

Surface success with a [toast](/docs/components/toast), and a field-level
failure with the field's own `errorMessage` — not with a toast that disappears
before the reader finds which field it meant.

## Tabs on a settings page

When a settings area has several pages, the strip is
[`TabNavigation`](/docs/components/tabs-and-navigation), not `Tabs` — each tab
is a route, so a deep link and the back button keep working. Pass the editor's
`dirtyKeys` to it and an unsaved tab grows a dot, which is how a reader finds
the edit they left behind.

## What to avoid

- Per-field layout classes. The container already decided.
- A page title inside the body.
- A Save button that is always enabled.
- A card around every single field, which turns a column of settings into a
  wall of boxes.

## Where to go next

[App shell](/docs/components/app-shell) covers the chrome these pages sit in,
and [Input](/docs/components/input) covers the fields themselves.
