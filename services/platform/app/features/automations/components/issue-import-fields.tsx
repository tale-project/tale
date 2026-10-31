'use client';

import { Input } from '@tale/ui/input';
import {
  SearchableSelect,
  type SearchableSelectProps,
} from '@tale/ui/searchable-select';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { ProjectSelect } from '@/app/features/projects/components/project-select';
import { useNamedProjects } from '@/app/features/projects/hooks/queries';
import { useT } from '@/lib/i18n/client';

import type { IssueSource } from '../lib/issue-import';

/** A run scoped to a project imports into that project alone: the field
 * offers it, read by id, and no other. */
function PinnedProjectSelect({
  organizationId,
  projectId,
  ...field
}: Omit<SearchableSelectProps, 'options'> & {
  organizationId: string;
  projectId: string;
}) {
  const { projects } = useNamedProjects(organizationId, [projectId]);
  const project = projects.get(projectId);
  const options = useMemo(
    () =>
      project === undefined
        ? []
        : [{ value: project._id, label: project.name }],
    [project],
  );
  return <SearchableSelect {...field} options={options} />;
}

/** Both importers use the same destination, source-filter, and batch controls.
 * Credentials stay in Connectors; run inputs never carry a secret. */
export function IssueImportFields({
  organizationId,
  source,
  value,
  pinnedProjectId,
  disabled = false,
  onChange,
}: {
  /** Whose projects the destination is picked from. */
  organizationId: string;
  source: IssueSource;
  value: Record<string, unknown>;
  /** The run's own project, when the run is scoped to one. */
  pinnedProjectId?: string;
  disabled?: boolean;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const { t } = useT('automations');
  const set = (key: string, next: unknown) => {
    const updated = { ...value };
    // A cursor belongs to one source filter and destination. Changing either
    // starts a new scan; changing only the batch size may keep its place.
    if (key !== 'limit') delete updated.cursor;
    if (next === '') delete updated[key];
    else updated[key] = next;
    onChange(updated);
  };
  const textField = (key: string, required = false) => (
    <Input
      key={key}
      label={t(`issueImport.fields.${key}`)}
      value={typeof value[key] === 'string' ? value[key] : ''}
      required={required}
      disabled={disabled}
      onChange={(event) => set(key, event.target.value)}
    />
  );
  return (
    <div className="mt-4 flex flex-col gap-4">
      <Text as="p" variant="muted" className="text-sm">
        {t('issueImport.description')}
      </Text>
      {typeof value.cursor === 'string' && (
        <Text as="p" variant="muted" className="text-sm">
          {t('issueImport.continuing')}
        </Text>
      )}
      {pinnedProjectId === undefined ? (
        // Home's page of projects, and past it what the server finds for
        // what is typed: never every project (#5204).
        <ProjectSelect
          organizationId={organizationId}
          required
          disabled={disabled}
          label={t('issueImport.fields.projectId')}
          placeholder={t('issueImport.chooseProject')}
          value={typeof value.projectId === 'string' ? value.projectId : null}
          onValueChange={(next) => set('projectId', next)}
          emptyText={t('issueImport.noProjects')}
          modal
        />
      ) : (
        <PinnedProjectSelect
          organizationId={organizationId}
          projectId={pinnedProjectId}
          required
          disabled={disabled}
          label={t('issueImport.fields.projectId')}
          placeholder={t('issueImport.chooseProject')}
          value={typeof value.projectId === 'string' ? value.projectId : ''}
          onValueChange={(next) => set('projectId', next)}
          emptyText={t('issueImport.noProjects')}
          modal
        />
      )}
      {source === 'github' ? (
        <>
          {textField('owner', true)}
          {textField('repo', true)}
          {textField('labels')}
        </>
      ) : (
        <>
          {textField('organization', true)}
          {textField('project', true)}
          {textField('query')}
        </>
      )}
      <Input
        disabled={disabled}
        type="number"
        label={t('issueImport.fields.limit')}
        description={t('issueImport.limitHint')}
        min={1}
        max={500}
        step={1}
        value={typeof value.limit === 'number' ? value.limit : ''}
        onChange={(event) =>
          set(
            'limit',
            event.target.value === '' ? '' : Number(event.target.value),
          )
        }
      />
    </div>
  );
}
