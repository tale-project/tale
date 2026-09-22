---
title: Settings page
description: Align configuration fields and connect Save, Discard, validation, and unsaved-change protection.
---

A settings page needs a clear distinction between the saved configuration and the current draft. Align related fields with `ContentArea variant="narrow"`, then make Save, Discard, and navigation behavior reflect that distinction.

## Try the draft and saved states

<Demo name="patterns/settings-page" />

Change **Workspace name**, then choose **Save**. The example adopts that value as its new saved baseline and disables the actions. Edit again and choose **Discard** to return to that baseline.

This example saves only in memory. Reloading restores the sample values. The region and digest controls demonstrate form layout; they do not change data residency or schedule emails. The bar stays visible while its status and button availability change.

## Align fields through the container

```tsx
import { ContentArea } from '@tale/ui/content-area';
import { Input } from '@tale/ui/input';

export function SettingsLayoutExample() {
  return (
    <ContentArea variant="narrow">
      <Input label="Workspace name" defaultValue="Northwind Trading" />
      <Input label="Support email" type="email" placeholder="help@example.com" />
    </ContentArea>
  );
}
```

This layout-only example has uncontrolled fields; use an editor controller for a persisted form. The narrow container caps content at `max-w-3xl` and declares the shared field layout. `FieldShell` stacks labels and controls on small screens and places them beside one another from `sm`, with a consistent control column.

If a field does not align, first check whether it uses `FieldShell`. Use `wideControl` deliberately for content that needs the available width. Group related settings with `FormSection`; reserve cards for distinct objects such as a connected account, rather than wrapping every input in a separate panel.

The surrounding page header supplies the `h1`. Do not repeat it in the settings body, and do not assume a navigation label replaces a page heading. Begin settings section headings at the appropriate level beneath the page title.

## Connect a real editor

`useFormEditor` adapts React Hook Form to the shared editor contract. It accepts server `data`, optional initial `defaultValues` and a validation schema, plus an asynchronous `save` callback. The returned controller exposes the form, status, `save`, `reset`, `submit`, and `dirtyKeys`.

| Integration | Why it matters |
| --- | --- |
| Keep server data separate from the draft | A failed request must not erase the person's edit. |
| Wire native form submission to `editor.submit` | This updates the saved baseline after success; calling the persistence callback directly bypasses that step. |
| Use `EditorActions` with the controller | Save/Discard availability follows dirty, valid, loading, and saving state. |
| Register related sections through `EditorGroup` | Their controllers contribute to one active-editor action area. The group does not draw a bar on its own. |
| Map server field errors where possible | Show repairable errors beside the relevant field rather than only in a disappearing toast. |
| Pass `onReset` for state kept outside the form | A reveal toggle or local mode switch is not a form field, so `reset` cannot restore it. `onReset` runs after every reset — the section's own Discard and a group header's alike — so that state returns to the saved baseline with the fields. |

For nested configuration objects that do not suit flat form paths, inspect `useJsonConfigEditor` before introducing another editor mechanism. Import controllers from `@tale/ui/editor/*`.

## Protect edits when leaving

Mount `DirtyBlockerProvider` within the router tree and register the editor's dirty state. `useFormEditor` performs its dirty-source registration; the provider supplies the navigation decision and before-unload handling. Without the surrounding provider, a controller cannot provide a complete leave-page warning.

For route-based settings tabs, use [`TabNavigation`](/docs/components/tabs-and-navigation). Pass the controller's `dirtyKeys` set and configure corresponding keys on the affected items. The dot indicates unsaved content; it is separate from the blocker that asks before leaving.

The form editor reports `hasRemoteUpdate` when upstream data changes while a draft is dirty. Give the person a visible way to understand and resolve that situation. Do not silently overwrite a local draft with a fresh server response.

## Verify a real save workflow

Test Save success, validation failure, server failure, Discard, and navigation away with a draft. After a successful save, reload and confirm the backend value persists. After a failed save, confirm the draft remains. The local example above demonstrates state transitions, but only your host integration can prove persistence, authorization, and unsaved-change protection.
