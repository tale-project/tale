---
title: Property list
description: Line up a record's properties beside their labels, and offer them as chips under a form.
---

Use a property list for the details panel of a record: each property's name in a fixed-width label column, its value or picker beside it, groups split by a hairline. Use property chips when the same properties belong under a form, where each value is the trigger of the picker that changes it.

```tsx
import { PropertyDivider, PropertyList, PropertyRow } from '@tale/ui/property-list';
import { PropertyChip } from '@tale/ui/property-chip';
```

## Show a record's properties

<Demo name="property-list/basic" />

Change the due date: the picker opens from its row and the label column stays aligned. Labels wrap inside their column instead of pushing the value off the panel, which matters for German and French field names.

`PropertyList` is a stack with 16px between rows; pass `as="aside"` when it is a details panel. `PropertyRow` takes the `label` and the value as children. Set `stacked` for a value that wraps, such as labels or dependencies, so its name sits above it; `stacked="md"` keeps it beside the label on a phone's full-width sheet and above it in a narrow dialog panel. `trailing` adds a small control for the property itself, such as a settings button. `PropertyDivider` separates groups and is hidden from assistive technology, which reads the rows' own names.

## Offer properties as chips

<Demo name="property-list/chips" />

Select **Due date**: the empty chip shows the property's name after a plus, and a set chip shows its glyph and value. In an application each chip opens the picker for its property.

`PropertyChip` is a button that forwards its ref and every prop, so a picker can use it as its trigger. Pass `empty` while the property has no value and its name as the children. When the visible value alone does not say which property it is, such as "Medium", give the chip an `aria-label` that starts with that value and names the property: "Medium priority".
