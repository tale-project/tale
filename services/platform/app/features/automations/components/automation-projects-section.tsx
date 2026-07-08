'use client';

/**
 * The bound-projects picker for a PROJECT-SCOPED automation, rendered inside its
 * Configuration tab. Which project(s) an automation runs in is configuration, so
 * it lives with the automation's other settings. Purely presentational: the
 * selection is a LOCAL DRAFT owned by `useProjectBindingsEditor`, whose
 * controller is composed into the tab strip's single Save/Discard — so nothing
 * is bound or unbound until the operator saves. The same "bound X" MultiSelect
 * the agent form uses for its bindings.
 */
import { Text } from '@tale/ui/text';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { useT } from '@/lib/i18n/client';

export function AutomationProjectsSection({
  options,
  selection,
  onSelectionChange,
  hasProjects,
  disabled,
}: {
  options: Array<{ value: string; label: string }>;
  selection: string[];
  onSelectionChange: (next: string[]) => void;
  hasProjects: boolean;
  disabled?: boolean;
}) {
  const { t } = useT('automations');
  return (
    <FormSection
      label={t('membership.boundProjectsTitle')}
      description={t('membership.boundProjectsDescription')}
    >
      {hasProjects ? (
        <MultiSelect
          value={selection}
          onValueChange={onSelectionChange}
          options={options}
          placeholder={t('membership.boundProjectsPlaceholder')}
          searchPlaceholder={t('install.projectSearchPlaceholder')}
          emptyText={t('install.noProjects')}
          aria-label={t('membership.boundProjectsTitle')}
          disabled={disabled}
        />
      ) : (
        <Text variant="caption" className="italic">
          {t('membership.noProjectsAvailable')}
        </Text>
      )}
    </FormSection>
  );
}
