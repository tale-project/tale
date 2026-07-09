'use client';

/**
 * The bound-projects picker for a PROJECT-SCOPED automation, rendered inside its
 * Configuration tab. Which project(s) an automation runs in is configuration, so
 * it lives with the automation's other settings. Purely presentational: the
 * selection is a LOCAL DRAFT owned by `useProjectBindingsEditor`, whose
 * controller is composed into the tab strip's single Save/Discard — so nothing
 * is bound or unbound until the operator saves. The same "bound X" MultiSelect
 * the agent form uses for its bindings. Currently selected projects also link
 * into the project-nested automation page as a quick entry point.
 */
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { useT } from '@/lib/i18n/client';

export function AutomationProjectsSection({
  organizationId,
  automationSlug,
  options,
  selection,
  onSelectionChange,
  hasProjects,
  disabled,
}: {
  organizationId: string;
  automationSlug: string;
  options: Array<{ value: string; label: string }>;
  selection: string[];
  onSelectionChange: (next: string[]) => void;
  hasProjects: boolean;
  disabled?: boolean;
}) {
  const { t } = useT('automations');
  const selectedLinks = selection
    .map((projectId) => {
      const option = options.find((o) => o.value === projectId);
      if (!option) return null;
      return { projectId, label: option.label };
    })
    .filter(
      (entry): entry is { projectId: string; label: string } => entry !== null,
    );

  return (
    <FormSection
      label={t('membership.boundProjectsTitle')}
      description={t('membership.boundProjectsDescription')}
    >
      {hasProjects ? (
        <>
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
          {selectedLinks.length > 0 && (
            <ul
              className="mt-2 flex flex-col gap-1"
              aria-label={t('membership.boundProjectLinksLabel')}
            >
              {selectedLinks.map(({ projectId, label }) => (
                <li key={projectId}>
                  <Link
                    to="/dashboard/$id/projects/$projectId/automations/$automationSlug"
                    params={{
                      id: organizationId,
                      projectId,
                      automationSlug,
                    }}
                    className="text-primary text-sm hover:underline"
                  >
                    {t('membership.openBoundProject', { name: label })}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Text variant="caption" className="italic">
          {t('membership.noProjectsAvailable')}
        </Text>
      )}
    </FormSection>
  );
}
