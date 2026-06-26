'use client';

/**
 * Side panel for an installed app's per-install config — opened from the app's
 * ⋯ menu ("Configuration"). Hosts the `AppConfigForm`; saving closes the panel.
 * The form is keyed on `open` so each fresh open remounts it against the current
 * stored values (no reactive update can clobber an in-progress edit).
 */
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { Sheet } from '@/app/components/ui/overlays/sheet';
import { useT } from '@/lib/i18n/client';

import type { AppConfigField } from '../hooks/use-apps';
import { AppConfigForm } from './app-config-form';

export function AppConfigDrawer({
  open,
  onOpenChange,
  organizationId,
  appSlug,
  fields,
  config,
  resolveLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  appSlug: string;
  fields: AppConfigField[];
  config: Record<string, unknown>;
  resolveLabel: (labelKey: string) => string;
}) {
  const { t } = useT('apps');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('config.title')}
      description={t('config.description')}
      size="md"
    >
      {open && (
        <VStack gap={5} className="h-full overflow-y-auto p-6">
          <VStack gap={1}>
            <Text className="text-lg font-semibold">{t('config.title')}</Text>
            <Text variant="muted" className="text-sm">
              {t('config.description')}
            </Text>
          </VStack>
          <AppConfigForm
            organizationId={organizationId}
            appSlug={appSlug}
            fields={fields}
            config={config}
            resolveLabel={resolveLabel}
            onSaved={() => onOpenChange(false)}
          />
        </VStack>
      )}
    </Sheet>
  );
}
