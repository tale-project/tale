'use client';

/**
 * Per-install config editor for an app — one input per declared `requires.config`
 * key (e.g. a GitHub repository), prefilled from the stored values, saved via
 * `setAppConfig`. This is what lets a repo-agnostic app be pointed at the
 * operator's OWN target instead of a hardcoded one; the saved values feed the
 * app's views (via the `$config:` binding token) and its scheduled workflows.
 *
 * Rendered inside the config side panel (`AppConfigDrawer`) — it is just the
 * form body (fields + Save); the panel owns the heading and chrome.
 *
 * A field may declare a `derive` rule (one input → many stored keys, e.g. a
 * single "owner/repo or URL" that splits into `owner` + `repo`). The split runs
 * here via the shared `deriveConfigValues` before the save: the stored map holds
 * the raw input (read back into this form) plus the derived keys (bound by the
 * views). The derivation is non-secret first-party manifest data and the values
 * are the operator's own config, so doing it client-side crosses no boundary.
 */
import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Input } from '@tale/ui/input';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useEffect, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { deriveConfigValues } from '@/lib/shared/platform/derive_config';

import { useSetAppConfig } from '../hooks/use-app-config';
import type { AppConfigField } from '../hooks/use-apps';

function asString(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** Build the editor's local state from the stored config (each field's own key
 *  holds the raw value the user typed; derived sub-keys aren't edited here). */
function initValues(
  fields: AppConfigField[],
  config: Record<string, unknown>,
): Record<string, string | boolean> {
  const init: Record<string, string | boolean> = {};
  for (const f of fields) {
    init[f.key] =
      f.type === 'boolean' ? config[f.key] === true : asString(config[f.key]);
  }
  return init;
}

export function AppConfigForm({
  organizationId,
  appSlug,
  fields,
  config,
  resolveLabel,
  onSaved,
}: {
  organizationId: string;
  appSlug: string;
  fields: AppConfigField[];
  config: Record<string, unknown>;
  /** Resolve a field's `labelKey`/`placeholderKey` against the app's pack catalog. */
  resolveLabel: (labelKey: string) => string;
  /** Called after a successful save (e.g. to close the side panel). */
  onSaved?: () => void;
}) {
  const { t } = useT('apps');
  const setConfig = useSetAppConfig();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    initValues(fields, config),
  );
  /** Field keys whose entered value failed its `derive` rule, shown inline. */
  const [invalid, setInvalid] = useState<string[]>([]);

  // `config` is reactive and may arrive after the first paint. Re-seed local
  // state when the stored values change so the inputs show what's persisted — a
  // plain `useState` initializer runs once and would leave the form blank on a
  // value that loaded late. Keyed on the stored values, not identity, so an
  // unrelated re-render doesn't clobber an in-progress edit.
  const configSignature = JSON.stringify(
    fields.map((f) => config[f.key] ?? null),
  );
  useEffect(() => {
    setValues(initValues(fields, config));
    setInvalid([]);
    // configSignature captures the relevant stored values; fields is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configSignature]);

  if (fields.length === 0) return null;

  // "Dirty" only when an input differs from what's stored — keep Save disabled
  // otherwise so it never invites a no-op write of the already-saved values.
  const baseline = initValues(fields, config);
  const dirty = fields.some((f) => values[f.key] !== baseline[f.key]);

  const onSave = async (): Promise<void> => {
    const { values: out, invalid: bad } = deriveConfigValues(fields, values);
    if (bad.length > 0) {
      setInvalid(bad);
      return; // refuse to persist a value a view binding can't use
    }
    setInvalid([]);
    try {
      await setConfig.mutateAsync({ organizationId, appSlug, config: out });
      toast({ title: t('config.saved') });
      onSaved?.();
    } catch (err) {
      toast({
        title: t('config.saveError'),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <VStack gap={4}>
      <VStack gap={3}>
        {fields.map((f) => (
          <VStack key={f.key} gap={1}>
            <Text as="label" className="text-sm font-medium">
              {resolveLabel(f.labelKey)}
            </Text>
            {f.type === 'boolean' ? (
              <Checkbox
                checked={values[f.key] === true}
                disabled={setConfig.isPending}
                onCheckedChange={(c) =>
                  setValues((s) => ({ ...s, [f.key]: c === true }))
                }
              />
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : 'text'}
                value={asString(values[f.key])}
                placeholder={
                  f.placeholderKey ? resolveLabel(f.placeholderKey) : undefined
                }
                disabled={setConfig.isPending}
                aria-invalid={invalid.includes(f.key) || undefined}
                onChange={(e) =>
                  setValues((s) => ({ ...s, [f.key]: e.target.value }))
                }
              />
            )}
            {invalid.includes(f.key) && (
              <Text variant="error" className="text-sm">
                {t('config.invalidValue', { label: resolveLabel(f.labelKey) })}
              </Text>
            )}
          </VStack>
        ))}
      </VStack>
      <HStack className="justify-end">
        <Button
          onClick={() => void onSave()}
          disabled={setConfig.isPending || !dirty}
        >
          {setConfig.isPending ? t('config.saving') : t('config.save')}
        </Button>
      </HStack>
    </VStack>
  );
}
