'use client';

import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';

import { type CredentialExtraModule } from '../credentials/adapter';
import { type ConnectorSummary } from './hooks/backend';

/**
 * Just enough of the vendor to read its declared fields. Structural rather than
 * importing `ConnectorVendor`, which would make this module and the adapter that
 * installs it import each other.
 */
export interface ConnectorVendorLike {
  summary: ConnectorSummary;
}

/**
 * A connector's non-secret per-credential settings, as form fields.
 *
 * `createCredential` validates the submitted config against the connector's
 * declared `configFields` and refuses a missing required one, so a form that
 * cannot collect them cannot author a credential for any connector declaring
 * one — `imap-smtp` requires `imapHost` and `smtpHost`, and its dialog failed
 * with `needs "IMAP server"` while offering no field to supply it.
 *
 * Types come from the declaration rather than being guessed: `boolean` renders
 * a switch, a `string` with `enum` renders a select over exactly those values,
 * everything else an input. Numbers stay STRINGS in form state and are coerced
 * by the server's own `normalizeConfig`, so a half-typed "9" is not silently
 * read as the port.
 */
export type ConnectorConfigValue = Record<string, string | number | boolean>;

/** Declared fields for a vendor, or an empty list when it declares none. */
function fieldsOf(summary: ConnectorSummary): ConnectorSummary['configFields'] {
  return summary.configFields;
}

/** Whether a value counts as supplied. `false` is a real boolean answer, and 0
 * is a real port — only absence and the empty string are missing. */
function isSupplied(value: string | number | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function ConnectorConfigFields<V extends ConnectorVendorLike>({
  vendor,
  value,
  onChange,
  disabled,
}: {
  vendor: V;
  value: ConnectorConfigValue;
  onChange: (next: ConnectorConfigValue) => void;
  disabled?: boolean;
}) {
  const fields = fieldsOf(vendor.summary);
  if (fields.length === 0) return null;

  const set = (key: string, next: string | number | boolean) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <>
      {fields.map((field) => {
        const current = value[field.key];
        if (field.type === 'boolean') {
          return (
            <Switch
              key={field.key}
              label={field.label}
              description={field.description}
              checked={
                typeof current === 'boolean'
                  ? current
                  : typeof field.default === 'boolean'
                    ? field.default
                    : false
              }
              onCheckedChange={(next) => set(field.key, next)}
              disabled={disabled}
            />
          );
        }
        if (field.enum !== undefined && field.enum.length > 0) {
          return (
            <Select
              key={field.key}
              label={field.label}
              description={field.description}
              value={
                typeof current === 'string'
                  ? current
                  : typeof field.default === 'string'
                    ? field.default
                    : ''
              }
              onValueChange={(next) => set(field.key, next)}
              options={field.enum.map((option) => ({
                value: option,
                label: option,
              }))}
              disabled={disabled}
              required={field.required}
            />
          );
        }
        return (
          <Input
            key={field.key}
            label={field.label}
            description={field.description}
            // The declared default is a PLACEHOLDER, not a prefilled value: the
            // server applies it when the field is absent, so prefilling would
            // make an untouched field indistinguishable from a chosen one.
            placeholder={
              field.default !== undefined ? String(field.default) : undefined
            }
            value={current === undefined ? '' : String(current)}
            onChange={(e) => set(field.key, e.target.value)}
            inputMode={field.type === 'number' ? 'numeric' : undefined}
            disabled={disabled}
            required={field.required}
          />
        );
      })}
    </>
  );
}

/**
 * The extra module the connectors adapter installs in place of `noExtras()`.
 * Config travels as one `config` record, matching what `createCredential` and
 * `updateCredential` take.
 */
export function connectorConfigExtras<
  V extends ConnectorVendorLike,
  Cred extends { config?: ConnectorConfigValue },
>(): CredentialExtraModule<V, Cred, ConnectorConfigValue> {
  return {
    empty: () => ({}),
    // Spread rather than assign, so the form edits a copy and never mutates the
    // stored row. An absent config needs no fallback: spreading undefined adds
    // nothing.
    fromCredential: (credential) => ({ ...credential.config }),
    isDirty: (value, baseline) =>
      JSON.stringify(value) !== JSON.stringify(baseline),
    isComplete: (value, vendor) =>
      fieldsOf(vendor.summary).every(
        (field) =>
          !field.required ||
          isSupplied(value[field.key]) ||
          field.default !== undefined,
      ),
    // Blank entries are dropped rather than sent as '': the server applies the
    // declared default for an ABSENT field, and would reject '' for a number.
    createArgs: (value) => {
      const config = pruneBlank(value);
      return Object.keys(config).length > 0 ? { config } : {};
    },
    editArgs: (value) => ({ config: pruneBlank(value) }),
    Fields: ConnectorConfigFields,
  };
}

function pruneBlank(value: ConnectorConfigValue): ConnectorConfigValue {
  const out: ConnectorConfigValue = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSupplied(entry)) out[key] = entry;
  }
  return out;
}
