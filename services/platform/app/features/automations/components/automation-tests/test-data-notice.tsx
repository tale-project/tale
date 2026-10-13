import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

/** The lifetime and audience of run data deliberately authored into tests. */
export function TestDataNotice() {
  const { t } = useT('automations');
  return (
    <Text as="p" variant="muted" className="text-sm">
      {t('tests.fromRun.privacy')}
    </Text>
  );
}
