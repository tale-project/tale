'use client';

/**
 * Per-install config editor for an app — renders one input per declared
 * `requires.config` key (e.g. a GitHub owner/repo), prefilled from the stored
 * values, and saves via `setAppConfig`. This is what lets a repo-agnostic app be
 * pointed at the operator's OWN target instead of a hardcoded one; the saved
 * values feed the app's views (via the `$config:` binding token) and its
 * scheduled workflows (synced into their variables by the mutation).
 */
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { Checkbox } from '@tale/ui/checkbox';
import { Input } from '@tale/ui/input';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSetAppConfig } from '../hooks/use-app-config';
import type { AppConfigField } from '../hooks/use-apps';

function asString(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

export function AppConfigForm({
  organizationId,
  appSlug,
  fields,
  config,
  resolveLabel,
}: {
  organizationId: string;
  appSlug: string;
  fields: AppConfigField[];
  config: Record<string, unknown>;
  /** Resolve a field's `labelKey` against the app's pack catalog. */
  resolveLabel: (labelKey: string) => string;
}) {
  const { t } = useT('apps');
  const setConfig = useSetAppConfig();
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const f of fields) {
      init[f.key] =
        f.type === 'boolean' ? config[f.key] === true : asString(config[f.key]);
    }
    return init;
  });

  if (fields.length === 0) return null;

  const onSave = async (): Promise<void> => {
    const out: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'number') {
        const n = Number(v);
        out[f.key] = Number.isFinite(n) ? n : 0;
      } else if (f.type === 'boolean') {
        out[f.key] = v === true;
      } else {
        out[f.key] = typeof v === 'string' ? v.trim() : '';
      }
    }
    try {
      await setConfig.mutateAsync({ organizationId, appSlug, config: out });
      toast({ title: t('config.saved') });
    } catch (err) {
      toast({
        title: t('config.saveError'),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Card>
      <VStack gap={4}>
        <VStack gap={1}>
          <Text className="font-medium">{t('config.title')}</Text>
          <Text variant="muted" className="text-sm">
            {t('config.description')}
          </Text>
        </VStack>
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
                  disabled={setConfig.isPending}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [f.key]: e.target.value }))
                  }
                />
              )}
            </VStack>
          ))}
        </VStack>
        <HStack className="justify-end">
          <Button onClick={() => void onSave()} disabled={setConfig.isPending}>
            {setConfig.isPending ? t('config.saving') : t('config.save')}
          </Button>
        </HStack>
      </VStack>
    </Card>
  );
}
