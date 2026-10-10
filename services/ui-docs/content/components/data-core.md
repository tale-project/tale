---
title: Data core
description: Summarize, shape and compare JSON values, and name a place in one with a JSON pointer — pure functions, no React.
---

The data core holds the functions the data components and the automation engine share to read values: a short summary of a value, its shape as a schema, what changed between two values, JSON pointers to name a place in one, and a short hash to tell two values apart. They are pure: no React, no DOM, no translations, so the same code runs in the browser and on the server, and a summary written while a run executes reads the same in the app.

```ts
import { summaryOf } from '@tale/ui/data/value-summary';
import { inferSchema } from '@tale/ui/data/infer-schema';
import { diffValues, diffShapes } from '@tale/ui/data/value-diff';
import { pointerOf, pathOf } from '@tale/ui/data/json-pointer';
import { valueHash } from '@tale/ui/data/hash';
import { stableStringify } from '@tale/ui/data/stable-stringify';
```

## Summarize a value

`summaryOf(value)` answers its kind and a short account: up to 80 characters of a string, a number or a boolean as text (`NaN` and `Infinity` included), a list's length and its first three items, an object's key count and its first eight names (each cut to 80 characters), and the value's size as UTF-8 JSON. A long string is cut on a character boundary and marked `cut`. The summary stays small however large the value is, so a list row or a chip can show it without reading the value.

`kindOf(value)` answers the kind alone: `string`, `number`, `boolean`, `null`, `undefined`, `array` or `object`.

## Read a value's shape

`inferSchema(value)` answers the JSON Schema subset [Schema tree](/docs/components/schema-tree) draws. Whole numbers read as `integer`, other numbers as `number`. A list's items are read together: a field only some objects carry is optional and says in how many it was present (`x-count`). `sampleItems` (100) bounds how many items of each list are read, and `maxDepth` (8) how deep the shape goes. Every value the shape was read from fits it.

Two more limits keep a shape small however wide the value is, and are unlimited unless set: `maxProperties` keeps the first fields of each object, in the order they were first seen, and counts the rest in `x-omitted`; `maxNodes` bounds the shapes in the whole tree, past which values read as any value.

## Compare two values

`diffValues(before, after)` lists each change with its JSON pointer and kind: `added`, `removed`, `changed`, `type-changed` (a string against a number, say), `reordered` or `unknown`. A value against `null` is `changed`. Values compare as their JSON, so a missing key and `undefined` are the same.

Lists pair their items by position, or, when every item of both lists carries a unique key such as `id`, by that key: an item that moved reads as `reordered` rather than as every later item changing. `arrays: 'index'` always pairs by position.

`mode: 'includes'` compares an expectation: keys the expectation leaves out are not compared, and `notChecked` counts them. Pointers in `unknownAt` were withheld on either side (a redacted secret, a value cut for size); their subtree reads `unknown`, never `changed`. `maxChanges` (500) bounds the list; the counts stay exact.

`diffShapes(before, after)` compares two shapes: fields added or removed, a type that changed, and a field that became optional or required.

`suggestDiffRoot(after, candidates)` picks which earlier value `after` most likely came from, such as the output of a previous step, by the values they share.

## Name a place in a value

`pointerOf(['items', 0, 'name'])` answers `/items/0/name` (RFC 6901: `~` is written `~0` and `/` is written `~1`). `pathOf` reads a pointer back; a segment written as a whole number reads as a list index.

## Tell two values apart

`valueHash(value)` answers a short name for a value — eleven or so characters — that is the same for equal values whatever order their keys were written in. `cyrb53(text)` hashes text the same way. A hash says two values differ without comparing them whole, and says which value a result belongs to; it is not a security boundary.

`stableStringify(value)` writes a value as JSON with its keys sorted, so equal values read alike; otherwise it follows `JSON.stringify`, and a bigint reads as its digits. `jsonNormalize(value)` answers the value as plain JSON data, keys in the order they were written.
