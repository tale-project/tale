import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';

import type { HiddenModelsRule } from '@/app/lib/backend/contract/lib';
import { useT } from '@/lib/i18n/client';

/**
 * The line a model chooser shows under itself when the organization's
 * EU/EEA processing rule left models out of it (GOV-R22): only models whose
 * endpoint processes prompts there are offered, and none while the model
 * access policy cannot be read. Nothing when the chooser left none out.
 */
export function HiddenModelsNote({
  rule,
  className,
}: {
  rule: HiddenModelsRule | undefined;
  className?: string;
}) {
  const { t } = useT('common');
  if (rule === undefined) return null;
  return (
    <Text as="p" variant="muted" className={cn('text-xs', className)}>
      {t(`hiddenModels.${rule}`)}
    </Text>
  );
}
