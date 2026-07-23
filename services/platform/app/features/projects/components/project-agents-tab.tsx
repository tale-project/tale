'use client';

import { Row } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  useJsonConfigEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { useAgents } from '@/app/features/agents/hooks/queries';
import { useProviderCatalogs } from '@/app/features/settings/providers/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { structuralEqual } from '@/lib/utils/structural-equal';

import {
  useUpdateProjectAgentSettings,
  useUpdateProjectModelSettings,
} from '../hooks/mutations';
import { useProject } from '../hooks/queries';
import {
  ProjectModeRadio,
  type ProjectModeRadioValue,
} from './project-mode-radio';
import {
  ProjectSlugListAdd,
  ProjectSlugListEditor,
  type SlugOption,
} from './project-slug-list-editor';

interface ProjectAgentsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

/** Staged agent/model access settings — edited locally, persisted on Save. */
interface AgentsModelsForm {
  agentMode: 'recommended' | 'restricted';
  agentList: string[];
  modelMode: 'recommended' | 'restricted';
  modelList: string[];
}

/**
 * The project's "Agents & models" curation: which agents the project
 * recommends (pinned first in chat) or restricts to, and the same for model
 * refs (`connector:modelId`). Agents come from the org roster (slim YAML
 * personas — the viewer-visible listing); model options come from the shipped
 * provider catalogs, which are an admin/developer read — for other members
 * the option list stays empty while already-curated refs still render and
 * remain editable as plain entries.
 */
export function ProjectAgentsTab({
  organizationId,
  projectId,
}: ProjectAgentsTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { mutateAsync: updateAgents } = useUpdateProjectAgentSettings();
  const { mutateAsync: updateModels } = useUpdateProjectModelSettings();
  const agentsQuery = useAgents(organizationId);
  const catalogsQuery = useProviderCatalogs(organizationId);

  const agentOptions = useMemo<SlugOption[]>(() => {
    const agents = agentsQuery.data?.agents ?? [];
    const options: SlugOption[] = [];
    for (const agent of agents) {
      const option: SlugOption = {
        value: agent.slug,
        label: agent.displayName,
      };
      if (agent.description !== undefined) {
        option.description = agent.description;
      }
      options.push(option);
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    return options;
  }, [agentsQuery.data]);

  const modelOptions = useMemo<SlugOption[]>(() => {
    const catalogs = catalogsQuery.data ?? [];
    const out: SlugOption[] = [];
    for (const connector of catalogs) {
      for (const model of connector.models) {
        out.push({
          value: `${connector.name}:${model.id}`,
          label: model.id,
          description: connector.displayName,
        });
      }
    }
    return out;
  }, [catalogsQuery.data]);

  // Single source-of-truth list per category. In `restricted` mode the
  // canonical list lives in the allowed array (matches the legacy storage);
  // in `recommended` mode it lives in the recommended array. Legacy `'all'`
  // rows map to `'recommended'` (empty list = nothing pinned, same access).
  const data = useMemo<AgentsModelsForm | undefined>(() => {
    if (!project) return undefined;
    const agentMode: ProjectModeRadioValue =
      project.agentMode === 'restricted' ? 'restricted' : 'recommended';
    const modelMode: ProjectModeRadioValue =
      project.modelMode === 'restricted' ? 'restricted' : 'recommended';
    return {
      agentMode,
      agentList:
        agentMode === 'restricted'
          ? (project.allowedAgentSlugs ?? [])
          : (project.recommendedAgentSlugs ?? []),
      modelMode,
      modelList:
        modelMode === 'restricted'
          ? (project.allowedModels ?? [])
          : (project.recommendedModels ?? []),
    };
  }, [project]);

  // Last-saved baseline, used inside `save` to skip the mutation for the
  // category that didn't change (each mutation is a separate write).
  const baselineRef = useRef(data);

  const save = useCallback(
    async (next: AgentsModelsForm) => {
      const base = baselineRef.current;
      const agentChanged =
        !base ||
        base.agentMode !== next.agentMode ||
        !structuralEqual(base.agentList, next.agentList);
      const modelChanged =
        !base ||
        base.modelMode !== next.modelMode ||
        !structuralEqual(base.modelList, next.modelList);
      try {
        // Fire both writes together so the save is all-or-nothing from the
        // toast's perspective; each mutation is idempotent on retry.
        const writes: Promise<unknown>[] = [];
        if (agentChanged) {
          writes.push(
            updateAgents({
              projectId,
              agentMode: next.agentMode,
              recommendedAgentSlugs: next.agentList,
              // Mirror into the allowed slot only when restricted, so the
              // server-side gate sees the same set as the UI's single list.
              allowedAgentSlugs:
                next.agentMode === 'restricted' ? next.agentList : [],
            }),
          );
        }
        if (modelChanged) {
          writes.push(
            updateModels({
              projectId,
              modelMode: next.modelMode,
              recommendedModels: next.modelList,
              allowedModels:
                next.modelMode === 'restricted' ? next.modelList : [],
            }),
          );
        }
        await Promise.all(writes);
        toast({ title: t('agents.saveSuccess'), variant: 'success' });
      } catch (error) {
        console.error('updateProject agent/model settings failed', error);
        toast({ title: t('agents.saveError'), variant: 'destructive' });
        throw error;
      }
    },
    [projectId, t, updateAgents, updateModels],
  );

  const editor = useJsonConfigEditor<AgentsModelsForm>({ initial: data, save });

  // Keep the baseline pointed at the latest saved value for the diff above.
  useEffect(() => {
    baselineRef.current = editor.savedConfig;
  }, [editor.savedConfig]);

  // Surface this editor to the project layout's Save/Discard cluster.
  useRegisterActiveEditor(editor);

  const config = editor.config;
  if (!project || !config) return null;
  const canEdit = project.canEdit;
  const fieldsDisabled = !canEdit || editor.isSaving;

  const modeOptions = [
    {
      value: 'recommended' as const,
      label: t('agents.modeRecommended'),
      description: t('agents.modeRecommendedDescription'),
    },
    {
      value: 'restricted' as const,
      label: t('agents.modeRestricted'),
      description: t('agents.modeRestrictedDescription'),
    },
  ];

  const showLockoutWarning =
    (config.agentMode === 'restricted' && config.agentList.length === 0) ||
    (config.modelMode === 'restricted' && config.modelList.length === 0);

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.agentsHeading')}
        description={t('agents.sectionDescription')}
        action={
          <ProjectSlugListAdd
            value={config.agentList}
            onChange={(next) => editor.updateConfig({ agentList: next })}
            options={agentOptions}
            addLabel={t('agents.addAgent')}
            disabled={fieldsDisabled}
          />
        }
      />

      <FormSection>
        <ProjectModeRadio
          value={config.agentMode}
          onChange={(next) => editor.updateConfig({ agentMode: next })}
          options={modeOptions}
          disabled={fieldsDisabled}
          legend={t('agents.agentsHeading')}
        />

        <ProjectSlugListEditor
          value={config.agentList}
          onChange={(next) => editor.updateConfig({ agentList: next })}
          options={agentOptions}
          mode={config.agentMode}
          disabled={fieldsDisabled}
        />
      </FormSection>

      <PageSection
        title={t('agents.modelsHeading')}
        gap={6}
        className="mt-8 border-t pt-8"
        action={
          <ProjectSlugListAdd
            value={config.modelList}
            onChange={(next) => editor.updateConfig({ modelList: next })}
            options={modelOptions}
            addLabel={t('agents.addModel')}
            disabled={fieldsDisabled}
          />
        }
      >
        <FormSection>
          <ProjectModeRadio
            value={config.modelMode}
            onChange={(next) => editor.updateConfig({ modelMode: next })}
            options={modeOptions}
            disabled={fieldsDisabled}
            legend={t('agents.modelsHeading')}
          />

          <ProjectSlugListEditor
            value={config.modelList}
            onChange={(next) => editor.updateConfig({ modelList: next })}
            options={modelOptions}
            mode={config.modelMode}
            disabled={fieldsDisabled}
          />
        </FormSection>
      </PageSection>

      {showLockoutWarning ? (
        <Row
          role="note"
          gap={2}
          align="start"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <Text variant="caption" className="text-amber-700">
            {t('agents.lockoutWarning')}
          </Text>
        </Row>
      ) : null}
    </ContentArea>
  );
}
