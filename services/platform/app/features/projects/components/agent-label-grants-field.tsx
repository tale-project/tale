'use client';

/**
 * Which of the project's labels the agent may add to and remove from tasks
 * with its `task_set_labels` tool: those and no others, and it never creates
 * a label. The dialog shows this field only while that tool is ticked, so
 * the project's labels are read only then. A granted label the project has
 * renamed or deleted since stays listed, so it can be removed.
 */

import { MultiSelect } from '@tale/ui/multi-select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useMemo } from 'react';

import { useTaskLabels } from '@/app/features/tasks/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { withStored } from '../lib/label-options';

interface AgentLabelGrantsFieldProps {
  projectId: string;
  /** The labels the agent may set, by name. */
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function AgentLabelGrantsField({
  projectId,
  selected,
  onChange,
  disabled,
}: AgentLabelGrantsFieldProps) {
  const { t } = useT('projects');
  const { labels, isLoading } = useTaskLabels(projectId);
  const labelOptions = useMemo(
    () => labels.map((label) => ({ value: label.name, label: label.name })),
    [labels],
  );
  const options = withStored(labelOptions, selected);
  // Nothing to choose: the project has no labels and the agent holds none.
  const empty = !isLoading && options.length === 0;

  return (
    <Skeletonize loading={isLoading}>
      <MultiSelect
        id="project-agent-label-grants"
        label={t('agents.labelGrants.label')}
        description={t(
          empty ? 'agents.labelGrants.empty' : 'agents.labelGrants.hint',
        )}
        placeholder={t('agents.labelGrants.placeholder')}
        searchPlaceholder={t('agents.labelGrants.search')}
        emptyText={t('agents.labelGrants.searchEmpty')}
        removeChipLabel={(option) =>
          t('agents.labelGrants.remove', { label: option.label })
        }
        options={options}
        value={selected}
        onValueChange={onChange}
        disabled={disabled === true || empty}
        // Inside a modal dialog the popover must register its own
        // scroll-lock shard, or the option list won't wheel-scroll.
        modal
      />
    </Skeletonize>
  );
}
