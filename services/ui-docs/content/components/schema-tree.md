---
title: Schema tree
description: Show the fields a value has, with each kind in words, whether it is required, and where it comes from.
---

`SchemaTree` lists the fields of a value the way a person reads a form: each field's name, what kind of value it holds in words, whether it is required, and a tag your host adds, such as where the value comes from. Use it for a run's input, what a step receives and returns, or a webhook's payload.

```tsx
import { SchemaTree, schemaKindLabel } from '@tale/ui/schema-tree';
```

## Show a value's fields

<Demo name="schema-tree/basic" />

Pass `schema`, a JSON Schema subset: `type` (one or several), `properties`, `required`, `items`, `enum`, `anyOf` and `description`. `density="compact"` lists the top-level fields one line each, for a summary or a node. The default, `comfortable`, also nests the fields of objects and of list items and shows each field's description. `maxRows` stops after that many top-level fields and says how many are left.

Descriptions are the author's words and show as written; everything else comes in the reader's language.

## Say more about a field

`tagOf(path)` returns a short tag shown after a field's kind. `path` holds the field names from the top: `['issues', 'title']` is a field of the items of the `issues` list. `maybeEmpty(path)` adds "may be empty". A field the schema lists in `required` says "required". In the comfortable density, the other fields of an object that names required fields say "optional".

`typeScript` adds **Show as TypeScript**: a disclosure with the same shape as highlighted TypeScript, for readers who think in types.

## Say a kind in a sentence

`schemaKindLabel(t, schema, locale)` returns the kind alone. Pass the `t` of the `schemaTree` namespace and the reader's locale, which picks the quotation marks and the word for "or".

| Schema | English | German | French |
| --- | --- | --- | --- |
| `{ type: 'string' }` | text | Text | texte |
| `{ type: 'array', items: { type: 'object' } }` | list of objects | Liste von Objekten | liste d'objets |
| `{ type: ['number', 'null'] }` | a number or empty | eine Zahl oder leer | un nombre ou vide |
| `{ enum: ['open', 'closed'] }` | one of “open” or “closed” | eines von „open“ oder „closed“ | l'un de « open » ou « closed » |

## Accessibility

The fields are a list named by `aria-label` (default "Fields"), with nested lists for nested fields. A required field says so in words, not by colour. The text keeps 4.5:1 on the page, a card and the code-block surface in both themes.
