'use client';

import { useT } from '@tale/ui/i18n/client';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';

import { useLocalized } from '@/app/features/automations/components/settings-field-control';
import { looksLikeEmailAddress } from '@/lib/shared/utils/email-address';

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
 * a switch, a `string` with `enum` renders a select over exactly those values
 * (each shown by its declared label), everything else an input. Numbers stay
 * STRINGS in form state and are coerced by the server's own `normalizeConfig`,
 * so a half-typed "9" is not silently read as the port.
 */
export type ConnectorConfigValue = Record<string, string | number | boolean>;

/** Declared fields shown on the create/edit form. `fromAddress` is kept
 * server-side — mirrored from the IMAP login username, from the mailbox an
 * Outlook credential names, or learned from the provider — and must not
 * appear as a second input. */
const HIDDEN_CONFIG_KEYS = new Set(['fromAddress']);

function fieldsOf(summary: ConnectorSummary): ConnectorSummary['configFields'] {
  return summary.configFields.filter(
    (field) => !HIDDEN_CONFIG_KEYS.has(field.key),
  );
}

/** One option of a select field as its own text, for `useLocalized` to
 * resolve: a translation that names only some options leaves the rest to
 * the next language in the chain, then to the English label, then to the
 * stored value itself. */
function optionText(
  field: ConnectorSummary['configFields'][number],
  option: string,
): { label: string; i18n: Record<string, { label: string }> } {
  const i18n: Record<string, { label: string }> = {};
  for (const [locale, text] of Object.entries(field.i18n ?? {})) {
    const label = text.optionLabels?.[option];
    if (label !== undefined) i18n[locale] = { label };
  }
  return { label: field.optionLabels?.[option] ?? option, i18n };
}

/** Whether `field` must be filled in for a credential of `method`: always
 * when it is `required`, else when it is `requiredFor` that method. */
function isRequired(
  field: ConnectorSummary['configFields'][number],
  method: string | undefined,
): boolean {
  if (field.required) return true;
  return (
    method !== undefined &&
    (field.requiredFor ?? []).some((required) => required === method)
  );
}

/** Whether a value counts as supplied. `false` is a real boolean answer, and 0
 * is a real port — only absence and the empty string are missing. */
function isSupplied(value: string | number | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function isValidFieldValue(
  field: ConnectorSummary['configFields'][number],
  value: string | number | boolean | undefined,
): boolean {
  if (!isSupplied(value)) return true;
  // The server's own test: a mailbox named by an ID is refused there, for
  // good — the setting is fixed — so the form says so before Connect.
  if (field.format === 'email') {
    return typeof value === 'string' && looksLikeEmailAddress(value);
  }
  if (field.type !== 'number') return true;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return (
    Number.isFinite(numberValue) &&
    (field.integer !== true || Number.isInteger(numberValue)) &&
    (field.min === undefined || numberValue >= field.min) &&
    (field.max === undefined || numberValue <= field.max)
  );
}

/**
 * A connector's declared settings as form fields. `editing` is the edit
 * dialog: a setting the connector declares `fixed` (Outlook's mailbox) is
 * shown there but cannot be changed — the server refuses a change, and the
 * field says why instead of letting a save fail.
 */
export function ConnectorConfigFields({
  vendor,
  value,
  onChange,
  disabled,
  method,
  editing,
}: {
  vendor: ConnectorVendorLike;
  value: ConnectorConfigValue;
  onChange: (next: ConnectorConfigValue) => void;
  disabled?: boolean;
  method?: string;
  editing?: boolean;
}) {
  const { t } = useT('settings');
  const localized = useLocalized();
  const fields = fieldsOf(vendor.summary);
  if (fields.length === 0) return null;

  const set = (key: string, next: string | number | boolean) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <>
      {fields.map((declared) => {
        // The declaration's label and help in the reader's language.
        const field = localized(declared);
        const current = value[field.key];
        const invalid = !isValidFieldValue(field, current);
        const locked = editing === true && field.fixed === true;
        const lockedReason = locked
          ? t('connectors.dialog.fixedSettingReason')
          : undefined;
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
              disabled={disabled === true || locked}
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
                label: localized(optionText(declared, option)).label,
              }))}
              disabled={disabled === true || locked}
              required={isRequired(field, method)}
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
            inputMode={
              field.type === 'number'
                ? 'numeric'
                : field.format === 'email'
                  ? 'email'
                  : undefined
            }
            min={field.min}
            max={field.max}
            step={field.integer === true ? 1 : undefined}
            errorMessage={
              !invalid
                ? undefined
                : field.format === 'email'
                  ? t('connectors.invalidEmailAddress')
                  : t('connectors.invalidPort')
            }
            isInvalid={invalid}
            disabled={disabled === true || locked}
            disabledReason={lockedReason}
            required={isRequired(field, method)}
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
    isComplete: connectorConfigComplete,
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

/** Whether the declared settings are filled in enough for a credential of
 * `method`: every required one supplied (or defaulted), every supplied one
 * valid. */
export function connectorConfigComplete(
  value: ConnectorConfigValue,
  vendor: ConnectorVendorLike,
  method?: string,
): boolean {
  return fieldsOf(vendor.summary).every(
    (field) =>
      (isSupplied(value[field.key]) &&
        isValidFieldValue(field, value[field.key])) ||
      (!isSupplied(value[field.key]) &&
        (!isRequired(field, method) || field.default !== undefined)),
  );
}

/** The settings as they are sent: blank entries dropped. */
export function pruneBlank(value: ConnectorConfigValue): ConnectorConfigValue {
  const out: ConnectorConfigValue = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSupplied(entry)) out[key] = entry;
  }
  return out;
}
