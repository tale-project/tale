'use client';

/**
 * The ONE per-field input renderer for a declared form field
 * (`formFieldSchema` in `lib/shared/schemas/automation_views.ts` — the connected
 * `Form` block's `fields` grammar). Renders the control matching the field's
 * declared shape: `boolean` → Checkbox, `select` → the house Select,
 * `multiline` string → Textarea, `string`/`number` → Input.
 *
 * Label/error LAYOUT stays with the caller (the `Form` block wraps this in the
 * `@tale/ui` Field) — this module owns only the control itself. There is no
 * install-time automation config editor any more (an automation declares only what it
 * REQUIRES); this file previously also fed that editor, which is why it's
 * factored out rather than inlined into `form.tsx`.
 */
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';

import type { ConfigFieldText } from '../hooks/use-automation-text';

/** Coerce a stored value into the string an input renders. */
export function asFieldString(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/**
 * Build a form's local state from the stored/initial values — each field's own
 * key holds the raw value the user edits; derived sub-keys aren't edited
 * directly (see `deriveConfigValues`).
 */
export function initFieldValues(
  fields: AutomationConfigField[],
  stored: Record<string, unknown>,
): Record<string, string | boolean> {
  const init: Record<string, string | boolean> = {};
  for (const f of fields) {
    init[f.key] =
      f.type === 'boolean'
        ? stored[f.key] === true
        : asFieldString(stored[f.key]);
  }
  return init;
}

export interface ConfigFieldInputProps {
  field: AutomationConfigField;
  value: string | boolean | undefined;
  onChange: (next: string | boolean) => void;
  disabled?: boolean;
  /** Marks the control invalid (inline error text is the caller's). */
  invalid?: boolean;
  /** Field display text (placeholder/options) — see `useConfigFieldText`. */
  text: ConfigFieldText;
  /** Id for the control, so an external `<label htmlFor>` can target it. */
  id?: string;
  /** Forwarded so `@tale/ui` Field's describedby/invalid injection lands on
   *  the real control (Field clones its single child with these). */
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function ConfigFieldInput({
  field,
  value,
  onChange,
  disabled,
  invalid,
  text,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ConfigFieldInputProps) {
  const isInvalid = (ariaInvalid ?? invalid) || undefined;
  const placeholder = text.placeholder(field);

  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={id}
        checked={value === true}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid}
        onCheckedChange={(c) => onChange(c === true)}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <Select
        id={id}
        options={(field.options ?? []).map((o) => ({
          value: o.value,
          label: text.option(o),
        }))}
        value={asFieldString(value) || undefined}
        placeholder={placeholder}
        disabled={disabled}
        error={isInvalid}
        onValueChange={(v) => onChange(v)}
      />
    );
  }
  if (field.multiline) {
    return (
      <Textarea
        id={id}
        value={asFieldString(value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid}
        rows={4}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <Input
      id={id}
      type={field.type === 'number' ? 'number' : 'text'}
      value={asFieldString(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-describedby={ariaDescribedBy}
      aria-invalid={isInvalid}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
